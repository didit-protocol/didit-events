/** People list: search params ⇄ query, chips, labels and empty-state copy. Filtering, sorting and paging run in SQL. */
import { adminLinks } from "../links";
import type { PersonVerificationState } from "../person/types";
import type { Density, PeopleFilter, PeopleQuery, PeopleSortKey, RegistrationStatus, SortDir } from "./types";

export const PAGE_SIZE = 25;
/** Didit HQ (Barcelona): account-level dates; event dates use the event's own zone. */
export const PEOPLE_TZ = "Europe/Madrid";

export const PEOPLE_CHIPS: { key: PeopleFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "verified", label: "Verified" },
  { key: "unverified", label: "Not verified" },
  { key: "attended", label: "Attended any" },
  { key: "team", label: "Staff / members" },
  { key: "deleted", label: "Deleted / deleting" },
];

const FILTERS = new Set<PeopleFilter>(PEOPLE_CHIPS.map((c) => c.key));
const SORT_KEYS = new Set<PeopleSortKey>(["name", "email", "registered", "attended", "lastActive", "createdAt"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Parses (and bounds) the People search params. Unknown values fall back to the defaults; `person` must be a UUID. */
export function parsePeopleQuery(params: RawParams): PeopleQuery {
  const q = (one(params.q) ?? "").trim().slice(0, 100);
  const filterRaw = one(params.filter) as PeopleFilter | undefined;
  const filter = filterRaw && FILTERS.has(filterRaw) ? filterRaw : "all";
  const sortRaw = one(params.sort) as PeopleSortKey | undefined;
  const dir: SortDir = one(params.dir) === "asc" ? "asc" : "desc";
  const sort = sortRaw && SORT_KEYS.has(sortRaw) ? { key: sortRaw, dir } : undefined;
  const density: Density = one(params.density) === "compact" ? "compact" : "comfortable";
  const pageNum = Number.parseInt(one(params.page) ?? "1", 10);
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.min(pageNum, 10_000) : 1;
  const personRaw = one(params.person);
  const person = personRaw && UUID.test(personRaw) ? personRaw.toLowerCase() : undefined;
  return { q, filter, sort, density, page, person };
}

/** The People URL for a query (defaults left out). Sort direction defaults to descending (newest, most first). */
export function peopleHref(query: Partial<PeopleQuery>): string {
  const p = new URLSearchParams();
  if (query.q) p.set("q", query.q);
  if (query.filter && query.filter !== "all") p.set("filter", query.filter);
  if (query.sort) {
    p.set("sort", query.sort.key);
    if (query.sort.dir === "asc") p.set("dir", "asc");
  }
  if (query.density === "compact") p.set("density", "compact");
  if (query.page && query.page > 1) p.set("page", String(query.page));
  if (query.person) p.set("person", query.person);
  const qs = p.toString();
  return `${adminLinks.people()}${qs ? `?${qs}` : ""}`;
}

/** The list state (search, chip, sort, density, page) without the drawer. */
export const listState = ({ q, filter, sort, density, page }: PeopleQuery): Partial<PeopleQuery> => ({ q, filter, sort, density, page });

export function emptyCopy(total: number, query: Pick<PeopleQuery, "q" | "filter">): { kind: "none" | "filtered"; title: string; help: string; cta?: string } {
  if (total === 0) return { kind: "none", title: "No one has signed up yet.", help: "Everyone who creates an account shows up here." };
  if (query.q) return { kind: "filtered", title: `No one matches “${query.q}”.`, help: "Search looks at names, emails and companies.", cta: "Clear search" };
  return { kind: "filtered", title: "No one here yet.", help: "Nobody matches this filter.", cta: "Show everyone" };
}

export const VERIFICATION_LABEL: Record<PersonVerificationState, string> = {
  verified: "Verified",
  expired: "Expired",
  in_review: "In review",
  declined: "Declined",
  in_progress: "In progress",
  not_started: "Not verified",
};

export const REGISTRATION_LABEL: Record<RegistrationStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  waitlisted: "Waitlisted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
  revoked: "Revoked",
};

/** "3 min ago" / "5 h ago" / "12 Sep 2026" (older than a week). */
export function relativeWhen(iso: string | null, now: Date, timeZone = PEOPLE_TZ): string {
  if (!iso) return "—";
  const at = new Date(iso), diff = now.getTime() - at.getTime();
  if (Number.isNaN(at.getTime())) return "—";
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} d ago`;
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(at);
}
