/** A-09 check-in log view models. Rows arrive already filtered by `LogFilters`; the page formats them. */
import type { AdminEventStatus } from "../types";
import type { PersonSummary } from "../person/types";
import type { ScanResult } from "./results";

export interface DoorRef {
  id: string;
  name: string;
}

/** One door scan (plan §2 `scans`; never an image). */
export interface Scan {
  id: string;
  /** ISO instant. */
  at: string;
  result: ScanResult;
  guestName: string | null;
  /** The matched registration: the row opens the guest drawer (`?guest=`). Null → the scan panel (`?scan=`). */
  registrationId?: string | null;
  guestEmail?: string;
  /** Avatar + badge, as in the Guests table (photo only with guests.photo). */
  person?: PersonSummary;
  doorId: string;
  /** Best match score 0–100, when the face search returned one. */
  similarity: number | null;
  latencyMs: number;
  /** A Test mode scan: listed and counted on the "Test" chip, never as an arrival; nobody admitted. */
  test?: boolean;
}

/** A verified guest who is not checked in yet (the "Missing" view). */
export interface MissingGuest {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  /** ISO instant of the approved verification. */
  verifiedAt: string;
}

export type LogView = "all" | "missing";

/** A result chip: one scan result (real scans only), or "test" (every Test mode scan). */
export type LogResultFilter = ScanResult | "test";

/** The A-09 search params: `?view=missing`, `?result=<ScanResult|test>`, `?door=<kioskId>`, `?people=0|1`. */
export interface LogFilters {
  view: LogView;
  result: LogResultFilter | null;
  door: string | null;
  /** "Show only people" (on by default): hides system outcomes (no face, paused, limit, error). */
  people: boolean;
}

/** Counts for the filter bar (for the current door + people filters, ignoring the result filter). */
export interface LogSummary {
  status: AdminEventStatus;
  timeZone: string;
  /** ISO start of the event (doors). */
  startsAt: string;
  doors: DoorRef[];
  /** Names of the door stations running now, for the before-doors empty state. */
  pairedKiosks: string[];
  /** Every listed scan, Test mode included ("All N" = the rows of "All scans"). */
  total: number;
  /** Real (non-test) scans per result. */
  byResult: Partial<Record<ScanResult, number>>;
  /** Test mode scans (the "Test" chip). */
  test: number;
  /** Verified, not checked in ("Missing · 56"). */
  missing: number;
}

export type LogPage = { view: "all"; scans: Scan[] } | { view: "missing"; guests: MissingGuest[] };
