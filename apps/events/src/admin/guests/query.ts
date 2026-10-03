/**
 * Pure helpers of the guests tab: search params ⇄ query, filtering, counts, sorting, pagination and empty-state copy.
 * The fixtures data layer uses them today; the F1 service will do the filtering in SQL, the rest stays.
 */
import { adminLinks } from "../links";
import type { CheckedIn, Density, GuestCounts, GuestQuery, GuestRow, GuestSortKey, GuestStatus, SortDir, StatusFilter } from "./types";

export const PAGE_SIZE = 15;

/** Which statuses each chip matches. "Link sent" also holds approved guests whose link is on its way. */
export const STATUS_GROUPS: Record<Exclude<StatusFilter, "all">, GuestStatus[]> = {
  "checked-in": ["checked-in"],
  verified: ["verified"],
  "link-sent": ["approved", "link-sent"],
  verifying: ["verifying"],
  "in-review": ["in-review"],
  declined: ["declined"],
  revoked: ["revoked"],
  "verified-any": ["verified", "checked-in"],
};

/** Desktop chips, in design order (A-05 `gchips`). */
export const DESKTOP_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "checked-in", label: "Checked in" },
  { key: "verified", label: "Verified" },
  { key: "link-sent", label: "Link sent" },
  { key: "verifying", label: "Verifying" },
  { key: "in-review", label: "In review" },
  { key: "declined", label: "Declined" },
  { key: "revoked", label: "Revoked" },
];

/** Phone chips (A-05 390): "Verified" counts everyone verified, in or not. The row scrolls sideways. */
export const PHONE_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "verified-any", label: "Verified" },
  { key: "link-sent", label: "Link sent" },
  { key: "checked-in", label: "Checked in" },
  { key: "verifying", label: "Verifying" },
  { key: "in-review", label: "In review" },
  { key: "declined", label: "Declined" },
  { key: "revoked", label: "Revoked" },
];

const FILTERS = new Set<StatusFilter>(["all", ...(Object.keys(STATUS_GROUPS) as StatusFilter[])]);
const SORT_KEYS = new Set<GuestSortKey>(["name", "email", "status", "checkedIn"]);

type RawParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Parses (and bounds) the guests tab search params. Unknown values fall back to the defaults. */
export function parseGuestQuery(params: RawParams): GuestQuery {
  const q = (one(params.q) ?? "").trim().slice(0, 100);
  const statusRaw = one(params.status) as StatusFilter | undefined;
  const status = statusRaw && FILTERS.has(statusRaw) ? statusRaw : "all";
  const sortRaw = one(params.sort) as GuestSortKey | undefined;
  const dir: SortDir = one(params.dir) === "desc" ? "desc" : "asc";
  const sort = sortRaw && SORT_KEYS.has(sortRaw) ? { key: sortRaw, dir } : undefined;
  const density: Density = one(params.density) === "compact" ? "compact" : "comfortable";
  const pageNum = Number.parseInt(one(params.page) ?? "1", 10);
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.min(pageNum, 10_000) : 1;
  const guestRaw = one(params.guest);
  const guest = guestRaw && /^[A-Za-z0-9_-]{1,64}$/.test(guestRaw) ? guestRaw : undefined;
  const dialogRaw = one(params.checkin) ? "checkin" : one(params.undo) ? "undo" : one(params.revoke) ? "revoke" : undefined;
  const addRaw = one(params.add);
  const add = addRaw === "paste" ? "paste" : addRaw ? "one" : undefined;
  return { q, status, sort, density, page, guest, dialog: guest ? dialogRaw : undefined, add };
}

/** The URL of the guests tab for a query (defaults are left out, so the plain tab URL stays clean). */
export function guestsHref(eventId: string, query: Partial<GuestQuery>): string {
  const p = new URLSearchParams();
  if (query.q) p.set("q", query.q);
  if (query.status && query.status !== "all") p.set("status", query.status);
  if (query.sort) {
    p.set("sort", query.sort.key);
    if (query.sort.dir === "desc") p.set("dir", "desc");
  }
  if (query.density === "compact") p.set("density", "compact");
  if (query.page && query.page > 1) p.set("page", String(query.page));
  if (query.guest) p.set("guest", query.guest);
  if (query.guest && query.dialog) p.set(query.dialog, "1");
  if (query.add) p.set("add", query.add === "paste" ? "paste" : "1");
  const qs = p.toString();
  return `${adminLinks.tab(eventId, "guests")}${qs ? `?${qs}` : ""}`;
}

/** The list state of a query (search, chip, sort, density, page) without the overlays. */
export const listState = ({ q, status, sort, density, page }: GuestQuery): Partial<GuestQuery> => ({ q, status, sort, density, page });

/** Lower-case and strip accents, so "garcia" finds "García". */
export const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function matchesSearch(row: GuestRow, q: string): boolean {
  const needle = fold(q.trim());
  if (!needle) return true;
  return [row.name, row.email, row.registeredAs ?? ""].some((v) => fold(v).includes(needle));
}

export function matchesStatus(row: GuestRow, status: StatusFilter): boolean {
  return status === "all" || STATUS_GROUPS[status].includes(row.status);
}

export function filterGuests(rows: GuestRow[], query: Pick<GuestQuery, "q" | "status">): GuestRow[] {
  return rows.filter((r) => matchesSearch(r, query.q) && matchesStatus(r, query.status));
}

/** Chip counts over the whole guest list (the design keeps them while a search is typed, A-05d). */
export function countGuests(rows: GuestRow[]): GuestCounts {
  const counts = { all: rows.length } as GuestCounts;
  for (const key of Object.keys(STATUS_GROUPS) as Exclude<StatusFilter, "all">[]) counts[key] = rows.filter((r) => STATUS_GROUPS[key].includes(r.status)).length;
  return counts;
}

const STATUS_ORDER: GuestStatus[] = ["checked-in", "verified", "in-review", "verifying", "link-sent", "approved", "declined", "revoked"];
const ciRank = (c: CheckedIn) => (c.kind === "time" ? `0${c.time}` : c.kind === "missing" ? "1" : "2");

export function sortGuests(rows: GuestRow[], sort: { key: GuestSortKey; dir: SortDir }): GuestRow[] {
  const collator = new Intl.Collator("en", { sensitivity: "base" });
  const key = (r: GuestRow): string =>
    sort.key === "email" ? r.email : sort.key === "status" ? String(STATUS_ORDER.indexOf(r.status)).padStart(2, "0") : sort.key === "checkedIn" ? ciRank(r.checkedIn) : r.name;
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * collator.compare(key(a), key(b)) || collator.compare(a.name, b.name));
}

export function paginate<T>(rows: T[], page: number, pageSize = PAGE_SIZE): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((p - 1) * pageSize, p * pageSize), page: p, pages };
}

/** Pager items: first, last, the current page ±1 (and the first/last three at the ends), "…" for gaps. */
export function pageItems(page: number, pages: number): (number | "…")[] {
  if (pages <= 5) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 2) [1, 2, 3].forEach((n) => keep.add(n));
  if (page >= pages - 1) [pages - 2, pages - 1, pages].forEach((n) => keep.add(n));
  const nums = [...keep].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  nums.forEach((n, i) => {
    const prev = nums[i - 1];
    if (prev !== undefined && n - prev === 2) out.push(prev + 1);
    else if (prev !== undefined && n - prev > 2) out.push("…");
    out.push(n);
  });
  return out;
}

/** "1–15 of 124". */
export function rangeLabel(page: number, pageSize: number, total: number): string {
  if (total === 0) return "0 of 0";
  return `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} of ${total}`;
}

const STATUS_PHRASE: Record<Exclude<StatusFilter, "all">, string> = {
  "checked-in": "checked in",
  verified: "verified",
  "link-sent": "waiting to verify",
  verifying: "verifying",
  "in-review": "in review",
  declined: "declined",
  revoked: "revoked",
  "verified-any": "verified",
};

export interface EmptyCopy {
  kind: "none" | "filtered";
  title: string;
  help: string;
  cta: string;
}

/** A-05c / A-05d copy. `total` is the event's guest count before filters. */
export function emptyCopy(total: number, query: Pick<GuestQuery, "q" | "status">): EmptyCopy {
  if (total === 0) return { kind: "none", title: "No guests yet.", help: "Add people one by one, paste a list, or share the request link.", cta: "Add guests" };
  const phrase = query.status === "all" ? undefined : STATUS_PHRASE[query.status];
  const help = query.q
    ? `Nobody named “${query.q}” is ${phrase ?? "on the guest list"}.`
    : `Nobody is ${phrase ?? "on the guest list"} yet.`;
  return { kind: "filtered", title: "No guests match these filters.", help, cta: "Clear filters" };
}

/** Phone rows: the line under the name ("Checked in 19:42", "Verified · not in yet", or the verification). */
export function phoneSubline(row: GuestRow): string {
  if (row.checkedIn.kind === "time") return `Checked in ${row.checkedIn.time}`;
  if (row.checkedIn.kind === "missing") return "Verified · not in yet";
  return row.bounced ? "Email bounced · Edit email" : row.verification;
}

/** Initials for the phone avatar: first letters of the first two words ("YE" for Youssef El Amrani). */
export const guestInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export const checkedInLabel = (c: CheckedIn) => (c.kind === "time" ? c.time : c.kind === "missing" ? "Not checked in" : "—");
