/** A-02 search (`?q=`) and status chips (`?status=`): pure helpers the page and the tests share. */
import type { FilterChipItem } from "@didit-events/ui";
import { adminLinks } from "../links";
import type { AdminEventRow, StatusCounts, StatusFilter } from "./types";

export const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "open", label: "Open" },
  { key: "live", label: "Live" },
  { key: "ended", label: "Ended" },
];

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);

export function parseStatus(value: unknown): StatusFilter {
  const v = first(value);
  return STATUS_FILTERS.some((f) => f.key === v) ? (v as StatusFilter) : "all";
}

/** Trimmed, whitespace-collapsed, at most 100 characters. */
export function parseQuery(value: unknown): string {
  const v = first(value);
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 100) : "";
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Case- and accent-insensitive match on the name and the venue/address. */
export function matchesQuery(event: AdminEventRow, q: string): boolean {
  if (!q) return true;
  const hay = fold(`${event.name} ${event.where}`);
  return fold(q)
    .split(" ")
    .every((word) => hay.includes(word));
}

/** The chip an event is counted and listed under: a cancelled one sits with the ended events. */
const chipOf = (e: AdminEventRow): Exclude<StatusFilter, "all"> => (e.status === "cancelled" ? "ended" : e.status);

export function filterEvents(events: AdminEventRow[], { q, status }: { q: string; status: StatusFilter }): AdminEventRow[] {
  return events.filter((e) => (status === "all" || chipOf(e) === status) && matchesQuery(e, q));
}

/** Chip counts over every event (the design keeps "All 6" while a search is active). */
export function statusCounts(events: AdminEventRow[]): StatusCounts {
  const counts: StatusCounts = { all: events.length, draft: 0, open: 0, live: 0, ended: 0 };
  for (const e of events) counts[chipOf(e)] += 1;
  return counts;
}

export function eventsHref({ q, status }: { q?: string; status?: StatusFilter }): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status && status !== "all") params.set("status", status);
  const qs = params.toString();
  return qs ? `${adminLinks.home()}?${qs}` : adminLinks.home();
}

/** The status chips; `counts` is omitted while loading (labels only). Changing the status keeps the search. */
export function statusChips(current: StatusFilter, q: string, counts?: StatusCounts): FilterChipItem[] {
  return STATUS_FILTERS.map((f) => ({
    key: f.key,
    label: counts ? `${f.label} ${counts[f.key]}` : f.label,
    href: eventsHref({ q, status: f.key }),
    current: f.key === current,
  }));
}

/** "124 invited · 98 verified · 42 in" (the 390 cards). */
export const countsLine = (e: AdminEventRow) => `${e.invited} invited · ${e.verified} verified · ${e.checkedIn} in`;
