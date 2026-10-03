/**
 * Pure helpers of the applicants tab: search params ⇄ query, filtering, counts, the invite email checks and the
 * keyboard map. The fixtures data layer uses them today; B4 does the filtering in SQL, the rest stays.
 */
import { adminLinks } from "../links";
import { APPLICANT_TABS, type ApplicantCounts, type ApplicantQuery, type ApplicantRow, type ApplicantTab, type InviteEmailCheck, type SignalFilter, type SignInFilter } from "./types";

type RawParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

const TABS = new Set<ApplicantTab>(APPLICANT_TABS.map((t) => t.key));
const SIGN_INS = new Set<SignInFilter>(["all", "google", "email"]);
const SIGNALS = new Set<SignalFilter>(["all", "verified-before", "returning", "duplicate", "new"]);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Parses (and bounds) the applicants search params. Unknown values fall back to the defaults. */
export function parseApplicantQuery(params: RawParams): ApplicantQuery {
  const tab = one(params.tab) as ApplicantTab | undefined;
  const signIn = one(params.signin) as SignInFilter | undefined;
  const signal = one(params.signal) as SignalFilter | undefined;
  const applicant = one(params.applicant);
  const invite = one(params.invite);
  return {
    tab: tab && TABS.has(tab) ? tab : "pending",
    q: (one(params.q) ?? "").trim().slice(0, 100),
    signIn: signIn && SIGN_INS.has(signIn) ? signIn : "all",
    signal: signal && SIGNALS.has(signal) ? signal : "all",
    applicant: applicant && ID_RE.test(applicant) ? applicant : undefined,
    invite: invite === "email" || invite === "link" ? invite : undefined,
  };
}

/** The list part of a query (what "close" returns to). */
export const listState = (q: ApplicantQuery): ApplicantQuery => ({ tab: q.tab, q: q.q, signIn: q.signIn, signal: q.signal });

/** /admin/events/[id]/applicants with only the non-default params. */
export function applicantsHref(eventId: string, q: Partial<ApplicantQuery>): string {
  const p = new URLSearchParams();
  if (q.tab && q.tab !== "pending") p.set("tab", q.tab);
  if (q.q) p.set("q", q.q);
  if (q.signIn && q.signIn !== "all") p.set("signin", q.signIn);
  if (q.signal && q.signal !== "all") p.set("signal", q.signal);
  if (q.applicant) p.set("applicant", q.applicant);
  if (q.invite) p.set("invite", q.invite);
  const s = p.toString();
  return `${adminLinks.tab(eventId, "applicants")}${s ? `?${s}` : ""}`;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

function hasSignal(r: ApplicantRow, signal: SignalFilter): boolean {
  const labels = r.signals.map((s) => s.label);
  switch (signal) {
    case "all":
      return true;
    case "verified-before":
      return labels.includes("Verified before");
    case "returning":
      return labels.some((l) => l.startsWith("Attended"));
    case "duplicate":
      return labels.includes("Possible duplicate");
    case "new":
      return labels.includes("New account");
  }
}

/** Search covers name, email, company and answers (AP-22 hint). */
/** The rows of one tab matching the filters; the waitlist in place order (FIFO, AP-12). */
export function filterApplicants(rows: ApplicantRow[], q: ApplicantQuery): ApplicantRow[] {
  const needle = norm(q.q);
  const list = rows.filter(
    (r) =>
      r.tab === q.tab &&
      (q.signIn === "all" || r.signIn === q.signIn) &&
      hasSignal(r, q.signal) &&
      (!needle || [r.name, r.email, r.company, r.role, r.why].some((f) => norm(f).includes(needle))),
  );
  return q.tab === "waitlist" ? list.sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER)) : list;
}

export function countApplicants(rows: ApplicantRow[], extra: Partial<ApplicantCounts> = {}): ApplicantCounts {
  const c: ApplicantCounts = { pending: 0, waitlist: 0, approved: 0, rejected: 0, cancelled: 0 };
  for (const r of rows) c[r.tab]++;
  for (const k of Object.keys(extra) as ApplicantTab[]) c[k] += extra[k] ?? 0;
  return c;
}

/* ── Invite emails (AP-17) ─────────────────────────────────────── */

/** A pragmatic address check: local@domain.tld, no spaces. `pau@proseware` fails (no TLD). */
export const isEmail = (s: string) => /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i.test(s);

/** Splits pasted text on commas, semicolons, whitespace and new lines; keeps order, drops empties. */
export function splitEmails(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);
}

/** Classifies each email: invalid, already requested (will be approved), repeated in the list, or ready. */
export function checkInviteEmails(emails: string[], existing: string[]): InviteEmailCheck[] {
  const known = new Set(existing.map((e) => e.toLowerCase()));
  const seen = new Set<string>();
  return emails.map((email) => {
    const lower = email.toLowerCase();
    const check = !isEmail(email) ? "invalid" : seen.has(lower) ? "duplicate" : known.has(lower) ? "existing" : "ready";
    seen.add(lower);
    return { email, check };
  });
}

/* ── Keyboard review (AP-03 note: ‹ › or J/K move, A approve, W waitlist, R reject) ── */

export type ReviewKey = "next" | "prev" | "approve" | "waitlist" | "reject";

/** Maps a keydown to a review command; ignores typing in fields and any modifier chord. */
export function reviewKey(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; target?: EventTarget | null }): ReviewKey | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const el = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName ?? ""))) return null;
  switch (e.key) {
    case "j":
    case "J":
      return "next";
    case "k":
    case "K":
      return "prev";
    case "a":
    case "A":
      return "approve";
    case "w":
    case "W":
      return "waitlist";
    case "r":
    case "R":
      return "reject";
    default:
      return null;
  }
}
