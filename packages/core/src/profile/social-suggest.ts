import { createHash } from "node:crypto";
import { consume } from "../counters.ts";
import { getDb, type Db } from "../db/index.ts";
import { queryable } from "../db/tx.ts";
import { log as defaultLog } from "../log.ts";
import { responseJson, ResponseTooLarge } from "../http/response-json.ts";

/**
 * "Is this you?" on the profile step: the guest's public LinkedIn and X, found with Firecrawl search from the name and
 * company they typed. Raw search hits are often other people (or posts, company pages), so a hit survives only when
 * its URL is a profile URL and its title carries every token of the name. Never throws: any failure is an empty list
 * and one log line with the reason (never the name).
 */
export interface Suggestion { url: string; label: string }
export interface SocialSuggestions { linkedin: Suggestion[]; x: Suggestion[] }
export interface SocialSuggestStore {
  get(accountId: string, key: string): Promise<SocialSuggestions | null>;
  put(accountId: string, key: string, value: SocialSuggestions): Promise<void>;
  /** One lookup against the account's daily allowance; false when it is spent. */
  allow(accountId: string): Promise<boolean>;
}
export interface SocialSuggestDeps {
  accountId: string;
  apiKey?: string;
  store: SocialSuggestStore;
  fetch?: typeof fetch;
  /** The caller's abort (the HTTP request); the total budget applies on top. */
  signal?: AbortSignal;
  timeoutMs?: number;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

export const SEARCH_URL = "https://api.firecrawl.dev/v2/search";
/** End to end, both networks in parallel; a slower network is dropped, never waited for past this. */
export const SUGGEST_BUDGET_MS = 1500;
export const SUGGEST_DAILY_LIMIT = 10;
export const SUGGEST_CACHE_HOURS = 24;
const PER_NETWORK = 2;
const EMPTY: SocialSuggestions = { linkedin: [], x: [] };

/** Lowercase, no diacritics, letters/digits only: the shape both the name and the result title are compared in. */
const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
const tokens = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** The name's tokens that count: two letters or more ("Mª" or a lone initial never decides a match). */
export const nameTokens = (fullName: string) => [...new Set(tokens(fullName).filter((t) => t.length >= 2))];
const clean = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

const LINKEDIN = /^https:\/\/(?:[a-z]{2}\.|www\.)?linkedin\.com\/in\/([A-Za-z0-9\-_%]{3,100})\/?(?:[?#].*)?$/;
const X = /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/;
/** First path segments of x.com that are product pages, never a person. */
const X_RESERVED = new Set(["i", "home", "search", "explore", "hashtag", "intent", "share", "settings", "messages", "notifications", "login", "signup", "tos", "privacy", "compose", "about", "jobs", "download", "account"]);

export function linkedinProfile(url: string): Suggestion | null {
  const slug = LINKEDIN.exec(url)?.[1]?.toLowerCase();
  return slug ? { url: `https://www.linkedin.com/in/${slug}`, label: `linkedin.com/in/${slug}` } : null;
}
export function xProfile(url: string): Suggestion | null {
  const handle = X.exec(url)?.[1];
  if (!handle || X_RESERVED.has(handle.toLowerCase())) return null;
  return { url: `https://x.com/${handle}`, label: `x.com/${handle}` };
}
/** Every name token appears as a whole word of the title ("Alberto Rosas - Didit | LinkedIn" matches "Alberto Rosas"). */
export function titleMatches(title: string, fullName: string): boolean {
  const want = nameTokens(fullName);
  const have = new Set(tokens(title));
  return want.length > 0 && want.every((t) => have.has(t));
}

interface Hit { url: string; title: string; description: string }
type Network = keyof SocialSuggestions;
class SearchFailure extends Error { readonly reason: string; constructor(reason: string) { super(reason); this.reason = reason; } }

/** The company's own words (two letters or more) that are not also name words ("Donal Greene" at "Greene" proves nothing). */
export const companyTokens = (company: string, fullName: string) => {
  const name = new Set(nameTokens(fullName));
  return [...new Set(tokens(company).filter((t) => t.length >= 2 && !name.has(t)))];
};

/**
 * Profiles whose title names the person (every name word) AND whose title or description names the company. Namesakes
 * are the risk, so there is no fallback: a profile that doesn't mention the company (e.g. an old LinkedIn headline) is
 * not suggested. At most 2.
 */
function pick(hits: Hit[], fullName: string, company: string, profile: (url: string) => Suggestion | null): Suggestion[] {
  const named: { s: Suggestion; text: Set<string> }[] = [];
  for (const hit of hits) {
    const s = profile(hit.url);
    if (!s || !titleMatches(hit.title, fullName) || named.some((o) => o.s.url.toLowerCase() === s.url.toLowerCase())) continue;
    named.push({ s, text: new Set(tokens(`${hit.title} ${hit.description}`)) });
  }
  const want = companyTokens(company, fullName);
  const confirmed = want.length ? named.filter((n) => want.every((t) => n.text.has(t))) : [];
  return confirmed.slice(0, PER_NETWORK).map((n) => n.s);
}

function parseHits(body: unknown): Hit[] {
  const web = (body as { success?: unknown; data?: { web?: unknown } } | null)?.data?.web;
  if ((body as { success?: unknown } | null)?.success !== true || !Array.isArray(web)) throw new SearchFailure("schema");
  return web.flatMap((h: unknown) => {
    const { url, title, description } = (h ?? {}) as { url?: unknown; title?: unknown; description?: unknown };
    return typeof url === "string" && typeof title === "string" ? [{ url, title, description: typeof description === "string" ? description : "" }] : [];
  });
}

async function search(query: string, apiKey: string, doFetch: typeof fetch, signal: AbortSignal): Promise<Hit[]> {
  let res: Response;
  try {
    res = await doFetch(SEARCH_URL, { method: "POST", redirect: "error", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ query, limit: 5 }), signal });
  } catch {
    throw new SearchFailure(signal.aborted ? "timeout" : "network");
  }
  if (!res.ok) throw new SearchFailure(res.status === 402 ? "credits" : res.status === 429 ? "rate_limited" : `http_${res.status}`);
  let body: unknown;
  try {
    body = await responseJson(res);
  } catch (error) {
    throw new SearchFailure(signal.aborted ? "timeout" : error instanceof ResponseTooLarge ? "body_too_large" : "invalid_json");
  }
  return parseHits(body);
}

/** The cache key: the account's normalized (name, company), hashed so the cache never stores what they typed. */
export function suggestionKey(fullName: string, company: string): string {
  return createHash("sha256").update(`${tokens(fullName).join(" ")}\n${tokens(company).join(" ")}`).digest("hex");
}

export async function suggestSocialProfiles(input: { fullName: string; company: string }, deps: SocialSuggestDeps): Promise<SocialSuggestions> {
  const report = deps.log ?? defaultLog;
  const fail = (reason: string, network?: Network) => report("profile.social_suggest.failed", { reason, ...(network ? { network } : {}) });
  const fullName = clean(input.fullName), company = clean(input.company);
  if (nameTokens(fullName).length < 2 || !company) return EMPTY;
  if (!deps.apiKey) return EMPTY;
  const key = suggestionKey(fullName, company);
  // One deadline for everything: the cache/limit reads and both searches.
  const budget = AbortSignal.timeout(deps.timeoutMs ?? SUGGEST_BUDGET_MS);
  const signal = deps.signal ? AbortSignal.any([budget, deps.signal]) : budget;
  const inBudget = <T,>(p: Promise<T>) => new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new SearchFailure("timeout"));
    signal.addEventListener("abort", () => reject(new SearchFailure("timeout")), { once: true });
    p.then(resolve, reject);
  });
  try {
    const cached = await inBudget(deps.store.get(deps.accountId, key));
    if (cached) return cached;
    if (!(await inBudget(deps.store.allow(deps.accountId)))) {
      fail("daily_limit");
      return EMPTY;
    }
  } catch (error) {
    fail(error instanceof SearchFailure ? error.reason : "store");
    return EMPTY;
  }
  const doFetch = deps.fetch ?? fetch;
  const q = `${fullName} ${company}`;
  const run = async (network: Network, query: string, profile: (url: string) => Suggestion | null): Promise<Suggestion[] | null> => {
    try {
      return pick(await search(query, deps.apiKey!, doFetch, signal), fullName, company, profile);
    } catch (error) {
      fail(error instanceof SearchFailure ? error.reason : "unexpected", network);
      return null;
    }
  };
  const [linkedin, x] = await Promise.all([run("linkedin", `${q} site:linkedin.com/in`, linkedinProfile), run("x", `${q} (site:x.com OR site:twitter.com)`, xProfile)]);
  const result = { linkedin: linkedin ?? [], x: x ?? [] };
  // Only a full answer is kept: a failed network retries on the next lookup instead of staying empty for a day.
  if (linkedin && x) await deps.store.put(deps.accountId, key, result).catch(() => fail("store"));
  return result;
}

const isSuggestions = (v: unknown): v is SocialSuggestions => {
  const ok = (l: unknown) => Array.isArray(l) && l.every((s: Partial<Suggestion> | null) => typeof s?.url === "string" && typeof s?.label === "string");
  return typeof v === "object" && v !== null && ok((v as SocialSuggestions).linkedin) && ok((v as SocialSuggestions).x);
};

/** Postgres store: `social_suggestions` (24 h per account and query) and the shared counters for the daily limit. */
export function dbSocialSuggestStore(db: Db = getDb()): SocialSuggestStore {
  const q = () => queryable(db);
  return {
    async get(accountId, key) {
      const [row] = await q().query<{ result: unknown }>("select result from social_suggestions where account_id=$1 and query_hash=$2 and expires_at>clock_timestamp()", [accountId, key]);
      return row && isSuggestions(row.result) ? row.result : null;
    },
    async put(accountId, key, value) {
      await q().query("delete from social_suggestions where account_id=$1 and expires_at<=clock_timestamp()", [accountId]);
      await q().query(
        `insert into social_suggestions (account_id,query_hash,result,expires_at) values ($1,$2,$3::jsonb,clock_timestamp()+$4 * interval '1 hour')
         on conflict (account_id,query_hash) do update set result=excluded.result,expires_at=excluded.expires_at`,
        [accountId, key, JSON.stringify(value), SUGGEST_CACHE_HOURS],
      );
    },
    async allow(accountId) {
      return (await consume(`social-suggest:${accountId}`, SUGGEST_DAILY_LIMIT, 86400, db)).allowed;
    },
  };
}
