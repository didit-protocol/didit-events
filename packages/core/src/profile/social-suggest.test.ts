import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../db/index.ts";
import { queryable } from "../db/tx.ts";
import { testDatabase } from "../testing/database.ts";
import { dbSocialSuggestStore, linkedinProfile, SEARCH_URL, suggestionKey, suggestSocialProfiles, titleMatches, xProfile, type SocialSuggestDeps, type SocialSuggestions, type SocialSuggestStore } from "./social-suggest.ts";

type Hit = { url: string; title: string; description?: string };
const ok = (web: Hit[]) => new Response(JSON.stringify({ success: true, data: { web: web.map((h, i) => ({ description: "", position: i + 1, ...h })) } }), { status: 200 });

function memoryStore(allowed = Infinity): SocialSuggestStore & { puts: number; lookups: number } {
  const map = new Map<string, SocialSuggestions>();
  return {
    puts: 0,
    lookups: 0,
    async get(a, k) { return map.get(`${a}:${k}`) ?? null; },
    async put(a, k, v) { this.puts++; map.set(`${a}:${k}`, v); },
    async allow() { return ++this.lookups <= allowed; },
  };
}

/** A fake Firecrawl: one reply per network, chosen from the query. */
function firecrawl(linkedin: () => Response | Promise<Response>, x: () => Response | Promise<Response>) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe(SEARCH_URL);
    const { query, limit } = JSON.parse(String(init?.body)) as { query: string; limit: number };
    expect(limit).toBe(5);
    expect(init?.redirect).toBe("error");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer fc-key");
    return query.includes("site:linkedin.com/in") ? linkedin() : x();
  });
}

const deps = (over: Partial<SocialSuggestDeps> = {}): SocialSuggestDeps & { logs: [string, Record<string, unknown> | undefined][] } => {
  const logs: [string, Record<string, unknown> | undefined][] = [];
  return { accountId: "acc-1", apiKey: "fc-key", store: memoryStore(), log: (e, f) => logs.push([e, f]), logs, ...over };
};
const alberto = { fullName: "Alberto Rosas", company: "Didit" };

describe("profile URL filters", () => {
  it.each([
    ["https://www.linkedin.com/in/albertorosas", "https://www.linkedin.com/in/albertorosas"],
    ["https://es.linkedin.com/in/Alberto-Rosas-123/", "https://www.linkedin.com/in/alberto-rosas-123"],
    ["https://linkedin.com/in/ana-garc%C3%ADa?trk=x", "https://www.linkedin.com/in/ana-garc%c3%ada"],
  ])("keeps the LinkedIn profile %s", (url, normalized) => expect(linkedinProfile(url)?.url).toBe(normalized));
  it.each(["https://www.linkedin.com/posts/alberto_activity-1", "https://www.linkedin.com/pulse/some-article", "https://www.linkedin.com/company/didit", "https://www.linkedin.com/in/albertorosas/details/experience", "http://www.linkedin.com/in/albertorosas", "https://evil.com/linkedin.com/in/x", "https://www.linkedin.com.evil.com/in/xyz"])(
    "drops %s",
    (url) => expect(linkedinProfile(url)).toBeNull(),
  );
  it.each([
    ["https://x.com/albertorosas", "https://x.com/albertorosas"],
    ["https://twitter.com/Alberto_R/", "https://x.com/Alberto_R"],
    ["https://mobile.twitter.com/alberto?lang=es", "https://x.com/alberto"],
  ])("keeps the X profile %s", (url, normalized) => expect(xProfile(url)?.url).toBe(normalized));
  it.each(["https://x.com/albertorosas/status/1234", "https://x.com/i/communities/1", "https://x.com/search?q=alberto", "https://x.com/hashtag/didit", "https://x.com/way_too_long_handle_123", "https://x.com/alberto/media"])(
    "drops %s",
    (url) => expect(xProfile(url)).toBeNull(),
  );
  it("matches every name token, ignoring case, diacritics and punctuation", () => {
    expect(titleMatches("Alberto Rosas - Didit | LinkedIn", "Alberto Rosas")).toBe(true);
    expect(titleMatches("José María Núñez – CTO", "jose maria nunez")).toBe(true);
    expect(titleMatches("Chus Sanchez - MEDITER", "Albert Salgueda")).toBe(false);
    expect(titleMatches("Albert Salgueda (@asal) / X", "Albert Salgueda")).toBe(true);
    // "Albert" is a whole word: "Alberto" does not count.
    expect(titleMatches("Alberto Salgueda | LinkedIn", "Albert Salgueda")).toBe(false);
  });
});

describe("suggestSocialProfiles", () => {
  it("rejects redirects without caching an answer", async () => {
    const fetch = vi.fn(async (_url, init) => {
      expect(init?.redirect).toBe("error");
      throw new TypeError("redirect disallowed");
    }) as unknown as typeof globalThis.fetch;
    const d = deps({ fetch });
    expect(await suggestSocialProfiles(alberto, d)).toEqual({ linkedin: [], x: [] });
    expect(d.logs).toHaveLength(2);
    expect(d.logs.every(([, fields]) => fields?.reason === "network")).toBe(true);
    expect((d.store as ReturnType<typeof memoryStore>).puts).toBe(0);
  });
  it.each([undefined, "1", "524289"])("cancels oversized Firecrawl streams with length %j and does not cache them", async length => {
    const cancel = vi.fn();
    const response = () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(64 * 1024)); }, cancel }),
      { headers: length ? { "content-length": length } : {} });
    const d = deps({ fetch: firecrawl(response, response) });
    expect(await suggestSocialProfiles(alberto, d)).toEqual({ linkedin: [], x: [] });
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(d.logs.every(([, fields]) => fields?.reason === "body_too_large")).toBe(true);
    expect((d.store as ReturnType<typeof memoryStore>).puts).toBe(0);
  });
  it("keeps only the guest's own profiles, normalized, deduped, at most 2 per network", async () => {
    const fetch = firecrawl(
      () => ok([
        { url: "https://es.linkedin.com/in/albertorosas", title: "Alberto Rosas - Didit | LinkedIn" },
        { url: "https://www.linkedin.com/in/AlbertoRosas/", title: "Alberto Rosas – Didit" },
        { url: "https://www.linkedin.com/in/chus-sanchez", title: "Chus Sanchez - MEDITER" },
        { url: "https://www.linkedin.com/posts/alberto-rosas_launch", title: "Alberto Rosas on LinkedIn: launch" },
        { url: "https://www.linkedin.com/company/didit", title: "Didit | Alberto Rosas" },
        { url: "https://www.linkedin.com/in/alberto-rosas-2", title: "Alberto Rosas - Founder" },
        { url: "https://www.linkedin.com/in/alberto-rosas-3", title: "Alberto Rosas - Engineer" },
      ]),
      () => ok([
        { url: "https://x.com/albertorosas/status/1", title: "Alberto Rosas on X: \"hello\"" },
        { url: "https://x.com/someone_else", title: "Someone Else (@someone_else) / X" },
        { url: "https://twitter.com/albertorosas", title: "Alberto Rosas (@albertorosas) / X" },
        { url: "https://x.com/albertorosas", title: "Alberto Rosas (@albertorosas) / X" },
      ]),
    );
    const d = deps({ fetch });
    expect(await suggestSocialProfiles(alberto, d)).toEqual({
      // Namesakes without the company (alberto-rosas-2/3) are dropped once a company-confirmed profile exists.
      linkedin: [{ url: "https://www.linkedin.com/in/albertorosas", label: "linkedin.com/in/albertorosas" }],
      // The X profile does not mention Didit: not suggested (no namesake fallback).
      x: [],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const queries = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).query);
    expect(queries).toEqual(["Alberto Rosas Didit site:linkedin.com/in", "Alberto Rosas Didit (site:x.com OR site:twitter.com)"]);
    expect(d.logs).toEqual([]);
  });

  it("drops the measured wrong person", async () => {
    const fetch = firecrawl(() => ok([{ url: "https://es.linkedin.com/in/chus-sanchez", title: "Chus Sanchez - MEDITER" }]), () => ok([]));
    expect(await suggestSocialProfiles({ fullName: "Albert Salgueda", company: "Melso" }, deps({ fetch }))).toEqual({ linkedin: [], x: [] });
  });

  it("runs both searches in parallel", async () => {
    let inFlight = 0, peak = 0;
    const slow = async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 20)); inFlight--; return ok([]); };
    await suggestSocialProfiles(alberto, deps({ fetch: firecrawl(slow, slow) }));
    expect(peak).toBe(2);
  });

  it.each([
    ["no key", { apiKey: undefined }, alberto],
    ["one-word name", {}, { fullName: "Alberto", company: "Didit" }],
    ["initial only", {}, { fullName: "Alberto R.", company: "Didit" }],
    ["empty company", {}, { fullName: "Alberto Rosas", company: "  " }],
  ] as const)("makes no call with %s", async (_label, over, input) => {
    const fetch = vi.fn();
    const store = memoryStore();
    expect(await suggestSocialProfiles(input, deps({ ...over, fetch, store }))).toEqual({ linkedin: [], x: [] });
    expect(fetch).not.toHaveBeenCalled();
    expect(store.lookups).toBe(0);
  });

  it.each([
    ["network", () => Promise.reject(new TypeError("fetch failed")), "network"],
    ["402 credits", () => new Response("{}", { status: 402 }), "credits"],
    ["429 rate", () => new Response("{}", { status: 429 }), "rate_limited"],
    ["500", () => new Response("oops", { status: 500 }), "http_500"],
    ["invalid JSON", () => new Response("<html>", { status: 200 }), "invalid_json"],
    ["schema mismatch", () => new Response(JSON.stringify({ success: false, error: "x" }), { status: 200 }), "schema"],
    ["web not a list", () => new Response(JSON.stringify({ success: true, data: { web: "nope" } }), { status: 200 }), "schema"],
  ] as const)("%s → empty, one log line per network with the reason, nothing cached", async (_label, reply, reason) => {
    const store = memoryStore();
    const d = deps({ fetch: firecrawl(reply, reply), store });
    await expect(suggestSocialProfiles(alberto, d)).resolves.toEqual({ linkedin: [], x: [] });
    expect(d.logs).toEqual([["profile.social_suggest.failed", { reason, network: "linkedin" }], ["profile.social_suggest.failed", { reason, network: "x" }]]);
    expect(JSON.stringify(d.logs)).not.toMatch(/alberto|rosas|didit/i);
    expect(store.puts).toBe(0);
  });

  it("keeps the network that answered when the other fails", async () => {
    const d = deps({ fetch: firecrawl(() => ok([{ url: "https://www.linkedin.com/in/albertorosas", title: "Alberto Rosas - Didit | LinkedIn" }]), () => new Response("", { status: 503 })) });
    expect(await suggestSocialProfiles(alberto, d)).toEqual({ linkedin: [{ url: "https://www.linkedin.com/in/albertorosas", label: "linkedin.com/in/albertorosas" }], x: [] });
  });

  it("gives up within the budget (timeout → empty)", async () => {
    const hang = (_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const d = deps({ fetch: vi.fn(hang) as unknown as typeof fetch, timeoutMs: 50 });
    const started = Date.now();
    expect(await suggestSocialProfiles(alberto, d)).toEqual({ linkedin: [], x: [] });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(d.logs.map(([, f]) => f?.reason)).toEqual(["timeout", "timeout"]);
  });

  it("answers a repeated lookup from the cache, without spending the allowance", async () => {
    const store = memoryStore();
    const fetch = firecrawl(() => ok([{ url: "https://www.linkedin.com/in/albertorosas", title: "Alberto Rosas | LinkedIn" }]), () => ok([]));
    const first = await suggestSocialProfiles(alberto, deps({ fetch, store }));
    const again = await suggestSocialProfiles({ fullName: " alberto  ROSAS ", company: "didit" }, deps({ fetch, store }));
    expect(again).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(store.lookups).toBe(1);
  });

  it("stops at the daily limit", async () => {
    const store = memoryStore(1);
    const fetch = firecrawl(() => ok([]), () => ok([]));
    await suggestSocialProfiles(alberto, deps({ fetch, store }));
    const d = deps({ fetch, store });
    expect(await suggestSocialProfiles({ fullName: "Alberto Rosas", company: "Melso" }, d)).toEqual({ linkedin: [], x: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(d.logs).toEqual([["profile.social_suggest.failed", { reason: "daily_limit" }]]);
  });

  it("a broken store is a silent miss, never a throw", async () => {
    const store: SocialSuggestStore = { get: () => Promise.reject(new Error("db down")), put: vi.fn(), allow: vi.fn() };
    const d = deps({ store, fetch: vi.fn() });
    expect(await suggestSocialProfiles(alberto, d)).toEqual({ linkedin: [], x: [] });
    expect(d.logs).toEqual([["profile.social_suggest.failed", { reason: "store" }]]);
  });
});

describe("dbSocialSuggestStore (PGlite)", () => {
  let db: Db, close: () => Promise<void>, accountId: string;
  beforeAll(async () => {
    ({ db, close } = await testDatabase("pglite"));
    accountId = randomUUID();
    await queryable(db).query("insert into accounts (id,email) values ($1,$2)", [accountId, `${accountId}@example.test`]);
  }, 60_000);
  afterAll(async () => close?.());

  it("caches per account and query for 24 h, and the key hides the name", async () => {
    const store = dbSocialSuggestStore(db);
    const key = suggestionKey("Alberto Rosas", "Didit");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(suggestionKey("ALBERTO   rosas", "didit")).toBe(key);
    expect(await store.get(accountId, key)).toBeNull();
    const value = { linkedin: [{ url: "https://www.linkedin.com/in/a", label: "linkedin.com/in/a" }], x: [] };
    await store.put(accountId, key, value);
    expect(await store.get(accountId, key)).toEqual(value);
    expect(await store.get(randomUUID(), key)).toBeNull();
    const [row] = await queryable(db).query<{ hours: number }>("select extract(epoch from expires_at-created_at)/3600 as hours from social_suggestions where account_id=$1", [accountId]);
    expect(Math.round(Number(row!.hours))).toBe(24);
    await queryable(db).query("update social_suggestions set expires_at=clock_timestamp()-interval '1 second' where account_id=$1", [accountId]);
    expect(await store.get(accountId, key)).toBeNull();
  });

  it("allows 10 lookups per account per day", async () => {
    const store = dbSocialSuggestStore(db);
    const results = [];
    for (let i = 0; i < 11; i++) results.push(await store.allow(accountId));
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(results.at(-1)).toBe(false);
  });

  it("is deleted with the account", async () => {
    await queryable(db).query("delete from accounts where id=$1", [accountId]);
    expect(await queryable(db).query("select 1 from social_suggestions where account_id=$1", [accountId])).toHaveLength(0);
  });

  it("namesakes: a profile is suggested only when it names the company; a company equal to the surname confirms nothing", async () => {
    const namesakes = [
      { url: "https://ie.linkedin.com/in/donal-greene", title: "Donal Greene - Community Organiser", description: "Web, MarTech" },
      { url: "https://ie.linkedin.com/in/donal-greene-a0a50421", title: "Donal Greene - Managing Director at Snap Citywest", description: "Greene family business" },
    ];
    const none = deps({ fetch: firecrawl(() => ok(namesakes), () => ok([])) });
    expect(await suggestSocialProfiles({ fullName: "Donal Greene", company: "Greene" }, none)).toEqual({ linkedin: [], x: [] });
    const one = deps({ fetch: firecrawl(() => ok([{ url: "https://www.linkedin.com/in/uma-bramwell-000000000", title: "Uma Bramwell - PM | CX - LinkedIn", description: "Strong focus on ecommerce" }]), () => ok([])) });
    // A lone name match that doesn't mention the company is not suggested either (it could be a namesake).
    expect((await suggestSocialProfiles({ fullName: "Uma Bramwell", company: "Didit" }, one)).linkedin).toEqual([]);
    const viaDescription = deps({ fetch: firecrawl(() => ok([...namesakes, { url: "https://sk.linkedin.com/in/donalgreene", title: "Donal Greene | LinkedIn", description: "Founder at Authologic" }]), () => ok([])) });
    expect((await suggestSocialProfiles({ fullName: "Donal Greene", company: "Authologic" }, viaDescription)).linkedin).toEqual([{ url: "https://www.linkedin.com/in/donalgreene", label: "linkedin.com/in/donalgreene" }]);
  });
  it("the cache and daily-limit reads count against the same deadline", async () => {
    const slowStore = { get: () => new Promise<never>(() => {}), put: async () => {}, allow: async () => true };
    const logs: unknown[] = [];
    const d = { ...deps({ fetch: firecrawl(() => ok([]), () => ok([])) }), store: slowStore, timeoutMs: 50, log: (_e: string, f?: Record<string, unknown>) => { logs.push(f); } };
    const t = performance.now();
    expect(await suggestSocialProfiles(alberto, d)).toEqual({ linkedin: [], x: [] });
    expect(performance.now() - t).toBeLessThan(1000);
    expect(logs).toContainEqual({ reason: "timeout" });
  });
});
