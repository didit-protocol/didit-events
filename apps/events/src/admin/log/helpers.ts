/** Pure helpers of the A-09 check-in log: search params, chip counts, filtering, row formatting, empty copy. */
import type { FilterChipItem, TagTone } from "@didit-events/ui";
import { adminLinks } from "../links";
import { BASE_CHIPS, RESULTS, SCAN_RESULTS, isScanResult, type ScanResult } from "./results";
import type { PersonSummary } from "../person/types";
import type { DoorRef, LogFilters, LogResultFilter, LogSummary, MissingGuest, Scan } from "./types";

type Params = Record<string, string | string[] | undefined>;

const last = (v: string | string[] | undefined) => (Array.isArray(v) ? v[v.length - 1] : v);

export const DEFAULT_FILTERS: LogFilters = { view: "all", result: null, door: null, people: true };

const isResultFilter = (v: unknown): v is LogResultFilter => v === "test" || isScanResult(v);

/** `?view=missing&result=welcomed&door=terrace&people=0` (`result=test`: Test mode scans). Unknown values fall back to the defaults. */
export function parseLogFilters(sp: Params): LogFilters {
  const view = last(sp.view) === "missing" ? "missing" : "all";
  const result = last(sp.result);
  const door = last(sp.door);
  return {
    view,
    result: isResultFilter(result) ? result : null,
    door: door && door !== "all" ? door : null,
    people: last(sp.people) !== "0",
  };
}

/** The log URL for a filter set; defaults are left out so the plain tab URL stays clean. `open` adds the drawer param. */
export function logHref(eventId: string, f: Partial<LogFilters> = {}, open?: { guest: string } | { scan: string }): string {
  const q = new URLSearchParams();
  const full = { ...DEFAULT_FILTERS, ...f };
  if (full.view === "missing") q.set("view", "missing");
  if (full.result) q.set("result", full.result);
  if (full.door) q.set("door", full.door);
  if (!full.people) q.set("people", "0");
  if (open) q.set("guest" in open ? "guest" : "scan", "guest" in open ? open.guest : open.scan);
  const qs = q.toString();
  return adminLinks.tab(eventId, "log") + (qs ? `?${qs}` : "");
}

/** Counts per result (for adapters that read raw scans). */
export function countByResult(scans: Pick<Scan, "result">[]): Partial<Record<ScanResult, number>> {
  const out: Partial<Record<ScanResult, number>> = {};
  for (const s of scans) out[s.result] = (out[s.result] ?? 0) + 1;
  return out;
}

const epoch = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? -Infinity : t;
};

/** A result chip's rule: "test" = every Test mode scan; a result = the real (non-test) scans with it. */
const matchesResult = (s: Scan, r: LogResultFilter | null) => (r === null ? true : r === "test" ? !!s.test : !s.test && s.result === r);

/** Scans matching the filters (door, people, result), newest first by instant (ISO strings may carry any offset). */
export function filterScans(scans: Scan[], f: LogFilters): Scan[] {
  return scans
    .filter((s) => (!f.door || s.doorId === f.door) && (!f.people || RESULTS[s.result].person) && matchesResult(s, f.result))
    .sort((a, b) => epoch(b.at) - epoch(a.at));
}

/**
 * The chip counts for the current door + people filters: each chip counts exactly the rows its filter lists
 * ("All" = every row, Test mode included; a result = its real scans; "Test" = the Test mode scans).
 */
export function summarizeScans(scans: Scan[], f: LogFilters): Pick<LogSummary, "total" | "byResult" | "test"> {
  const rows = filterScans(scans, { ...f, view: "all", result: null });
  return { total: rows.length, byResult: countByResult(rows.filter((s) => !s.test)), test: rows.filter((s) => s.test).length };
}

/**
 * The result chips: "All N", the five drawn results (always, even at 0), then any other result that has scans
 * (system outcomes only when "Show only people" is off), then "Test N" when Test mode scans exist. Each chip keeps
 * the door/people filters.
 */
export function logChips(eventId: string, summary: Pick<LogSummary, "total" | "byResult"> & { test?: number }, f: LogFilters): FilterChipItem[] {
  const extra = SCAN_RESULTS.filter(
    (r) => !BASE_CHIPS.includes(r) && (f.result === r || ((summary.byResult[r] ?? 0) > 0 && (!f.people || RESULTS[r].person))),
  );
  const keep = { door: f.door, people: f.people };
  return [
    { key: "all", label: `All ${summary.total}`, href: logHref(eventId, keep), current: f.result === null },
    ...[...BASE_CHIPS, ...extra].map((r) => ({
      key: r,
      label: `${RESULTS[r].chip} ${summary.byResult[r] ?? 0}`,
      href: logHref(eventId, { ...keep, result: r }),
      current: f.result === r,
    })),
    ...((summary.test ?? 0) > 0 || f.result === "test"
      ? [{ key: "test", label: `Test ${summary.test ?? 0}`, href: logHref(eventId, { ...keep, result: "test" }), current: f.result === "test" }]
      : []),
  ];
}

const timeFmt = (tz: string, seconds: boolean) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: seconds ? "2-digit" : undefined, hourCycle: "h23", timeZone: tz });

export const clock = (iso: string, tz: string, seconds = false) => timeFmt(tz, seconds).format(new Date(iso));
export const dayMonth = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: tz }).format(new Date(iso));

export interface LogRowView {
  id: string;
  time: string;
  /** "23 Oct": the scan panel's date line. */
  date: string;
  result: string;
  tone: TagTone;
  /** A Test mode scan (the TEST tag). */
  test: boolean;
  guest: string;
  /** No guest resolved (shown muted). */
  anonymous: boolean;
  /** A person stood at the kiosk but matched nobody on the list: the neutral face avatar. */
  faceOnly: boolean;
  email: string;
  person?: PersonSummary;
  /** The drawer this row opens: the guest drawer (`?guest=`) or the scan panel (`?scan=`). */
  href: string;
  match: string;
  /** Below the default 80% threshold (shown red). */
  lowMatch: boolean;
  door: string;
  latency: string;
}

/** The guest column for a scan without a registration. */
const anonymousGuest = (s: Scan) => (s.result === "unknown" ? "Unknown face" : s.result === "not_on_list" ? "Not on list" : RESULTS[s.result].person ? "No match" : "—");

export function toLogRow(s: Scan, doors: DoorRef[], tz: string, eventId = "", filters: LogFilters = DEFAULT_FILTERS): LogRowView {
  const def = RESULTS[s.result];
  const guest = !!s.registrationId && !!s.guestName;
  return {
    id: s.id,
    time: clock(s.at, tz, true),
    date: dayMonth(s.at, tz),
    // Test mode rows admitted nobody: a TEST tag says so, and the result stays neutral.
    result: def.label,
    tone: s.test ? "neutral" : def.tone,
    test: !!s.test,
    guest: s.guestName ?? anonymousGuest(s),
    anonymous: !s.guestName,
    faceOnly: !s.guestName && def.person,
    email: s.guestEmail ?? "",
    ...(s.person ? { person: s.person } : {}),
    href: logHref(eventId, filters, guest ? { guest: s.registrationId! } : { scan: s.id }),
    match: s.similarity === null ? "—" : `${Math.round(s.similarity)}%`,
    lowMatch: s.similarity !== null && s.similarity < 80,
    door: doors.find((d) => d.id === s.doorId)?.name ?? "—",
    latency: `${(s.latencyMs / 1000).toFixed(1)}s`,
  };
}

export interface MissingRowView {
  id: string;
  name: string;
  email: string;
  emailHref: string;
  phone: string;
  phoneHref: string | null;
  verified: string;
  /** Opens the guest drawer's manual check-in (A-14, guests tab). */
  checkInHref: string;
}

export const manualCheckInHref = (eventId: string, guestId: string) =>
  `${adminLinks.tab(eventId, "guests")}?guest=${encodeURIComponent(guestId)}&checkin=1`;

export function toMissingRow(g: MissingGuest, eventId: string, tz: string): MissingRowView {
  return {
    id: g.id,
    name: g.name,
    email: g.email,
    emailHref: `mailto:${g.email}`,
    phone: g.phone ?? "—",
    phoneHref: g.phone ? `tel:${g.phone.replace(/[^\d+]/g, "")}` : null,
    verified: `Verified ${dayMonth(g.verifiedAt, tz)}`,
    checkInHref: manualCheckInHref(eventId, g.id),
  };
}

/** "Main door is running." / "3 doors are running." / "No door is running yet." (door sessions seen in the last 10 minutes). */
export function pairedSentence(names: string[]): string {
  if (names.length === 0) return "No door is running yet. Start one from the Door tab.";
  if (names.length === 1) return `${names[0]} is running.`;
  return `${names.length} doors are running.`;
}

export interface EmptyCopy {
  title: string;
  help: string;
}

/**
 * The empty table copy: nothing scanned yet (A-09c), or nothing matching the filters (A-09d). Null when there are
 * rows to show.
 */
export function logEmptyCopy(summary: LogSummary, f: LogFilters, rows: number): EmptyCopy | null {
  if (rows > 0) return null;
  if (f.view === "missing") return { title: "Everyone verified is in.", help: "Verified guests who haven’t checked in show up here." };
  const door = f.door ? summary.doors.find((d) => d.id === f.door)?.name : undefined;
  const at = door ? ` at ${door}` : "";
  if (summary.total === 0 && !f.result && !f.door) {
    const doors = clock(summary.startsAt, summary.timeZone);
    const lead = summary.status === "open" || summary.status === "draft" ? `Doors open at ${doors}.` : `Doors opened at ${doors}.`;
    return { title: "Scans will appear here once the door is running.", help: `${lead} ${pairedSentence(summary.pairedKiosks)}` };
  }
  let help: string;
  if (f.result === "not_on_list") help = `Nobody outside the list has been scanned${at}.`;
  else if (f.result === "test") help = `No Test mode scans${at} yet.`;
  else if (f.result) help = `No “${RESULTS[f.result].label}” scans${at} yet.`;
  else help = `No scans${at} yet.`;
  return { title: "No scans match these filters.", help };
}
