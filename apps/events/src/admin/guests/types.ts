import type { PersonSummary, PersonView } from "../person/types";

/**
 * Guests tab view models (A-05 table, A-06 drawer, A-07 add guests, A-14/A-15 check-in, A-16 email mismatch).
 * `app/admin/(events)/events/[id]/(tabs)/guests/data.ts` returns these; it is the swap point for the F1 services.
 */

/** Registration status as the guests table shows it (the StatusPill keys of C-00). */
export type GuestStatus = "approved" | "link-sent" | "verifying" | "verified" | "in-review" | "declined" | "revoked" | "checked-in";

export type GuestSource = "Request form" | "Added by staff" | "CSV";

/** The "Checked in" column: a door time, "Not checked in" (verified, doors open, not in yet) or "—" (before doors open / not eligible). */
export type CheckedIn = { kind: "time"; time: string } | { kind: "missing" } | { kind: "none" };

/** One row of the guests table (A-05). */
export interface GuestRow {
  id: string;
  name: string;
  /** Photo + verified badge. */
  person?: PersonSummary;
  /** Name the guest registered with at Didit when it differs ("Maria Garcia Lopez"). */
  registeredAs?: string;
  email: string;
  /** Didit verified this email (the green check after the address). */
  emailVerified: boolean;
  status: GuestStatus;
  /** Verification column ("Verified · 21 Oct", "Not started", …). */
  verification: string;
  /** The invite email bounced: the row turns red and the verification cell offers "Edit email". */
  bounced?: boolean;
  checkedIn: CheckedIn;
  source: GuestSource;
  /** A link email is being sent right now (outbox job pending): the status cell shows "Sending…". */
  sending?: boolean;
  /** The guest's personal Didit verification link. */
  verifyUrl: string;
  /** The Didit console session, when there is one. */
  diditUrl?: string;
}

/** Status chips (A-05). `verified-any` is the phone chip "Verified" (verified or checked in). */
export type StatusFilter = "all" | "checked-in" | "verified" | "link-sent" | "verifying" | "in-review" | "declined" | "revoked" | "verified-any";

export type GuestSortKey = "name" | "email" | "status" | "checkedIn";
export type SortDir = "asc" | "desc";
export type Density = "comfortable" | "compact";

/** Search params of /admin/events/[id]/guests, parsed and bounded. */
export interface GuestQuery {
  q: string;
  status: StatusFilter;
  /** Explicit sort from the URL; without one the service order applies (the table header shows Name ↑). */
  sort?: { key: GuestSortKey; dir: SortDir };
  density: Density;
  page: number;
  /** Drawer (A-06): `?guest=<id>`. */
  guest?: string;
  /** Drawer sub-dialogs: A-14 manual check-in, A-15 undo, revoke. */
  dialog?: "checkin" | "undo" | "revoke";
  /** Add guests modal (A-07): `?add=1` (one guest) or `?add=paste`. */
  add?: "one" | "paste";
}

export type GuestCounts = Record<Exclude<StatusFilter, "all">, number> & { all: number };

export interface GuestPage {
  rows: GuestRow[];
  /** Rows matching the filters (all pages). */
  total: number;
  page: number;
  pageSize: number;
}

/* ── Drawer (A-06, A-14…A-16) ─────────────────────────────────────── */

export type VerificationState = "not-started" | "in-progress" | "in-review" | "declined" | "approved" | "email-mismatch";

export interface GuestDetail {
  id: string;
  name: string;
  /** The invited email. */
  email: string;
  status: GuestStatus;
  /** The latest Didit attempt: drives the review / mismatch callouts (the shown facts live in `person`). */
  verification: { session: string; state: VerificationState };
  /** A pre-v2 personal verification link; empty url → no invite section. */
  invite: { sent: string; url: string; display: string };
  /** Didit's reason when declined (A-06e banner). */
  declineReason?: string;
  /** A-16: Didit verified a different email than the invited one. */
  mismatch?: { invited: string; verified: string };
  /** Profile, request, verification, check-in and timeline, shared with the Requests drawer. */
  person: PersonView;
}

/* ── Add guests (A-07) ───────────────────────────────────────────── */

export type PasteRowStatus = "ready" | "invalid-email" | "missing-name" | "duplicate" | "duplicate-in-list";

export interface PasteRow {
  /** 1-based line in the pasted text. */
  line: number;
  first: string;
  last: string;
  email: string;
  status: PasteRowStatus;
}

export interface PasteResult {
  rows: PasteRow[];
  header: boolean;
  ready: number;
  invalidEmail: number;
  missingName: number;
  duplicate: number;
  /** Set when the paste cannot be read at all (too many rows). */
  error?: string;
}

export interface NewGuest {
  first: string;
  last: string;
  email: string;
}

/* ── Server action results ───────────────────────────────────────── */

export type GuestActionError = "session_expired" | "invalid" | "not_found" | "conflict";
export type GuestActionResult<T extends object = object> = ({ ok: true } & T) | { error: GuestActionError; message?: string };
