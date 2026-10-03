// Door DTOs returned by the Events door API (/api/door/{event}/…), shared with the door screen.

export type DoorMode = "supervised" | "strict";

/** Read-only threshold display on K-13; only staff in Events may change it. */
export const STRICTNESS = [
  { value: 70, label: "Relaxed 70" },
  { value: 80, label: "Standard 80" },
  { value: 90, label: "Strict 90" },
] as const;
export type Threshold = (typeof STRICTNESS)[number]["value"];

/** `scans.result` (plan §2) plus `liveness_failed` for strict mode (K-18), which §2 does not list yet. */
export type ScanResult =
  | "welcomed"
  | "welcome_back"
  | "unknown"
  | "ambiguous"
  | "not_on_list"
  | "not_admitted"
  | "not_verified"
  | "liveness_failed"
  | "no_face"
  | "inconclusive"
  | "paused"
  | "budget_exhausted"
  | "error"
  /** Strict door, face too far for the face check: nothing was sent to Didit and no scan row exists. */
  | "liveness_needed";

export type NotAdmittedReason = "pending" | "waitlisted" | "rejected" | "withdrawn" | "cancelled" | "revoked";
export type VerificationState = "not_started" | "in_progress" | "in_review" | "declined" | "requirements_unmet";
export type OutageReason = "service" | "credits" | "network";

/** `test`: the scan ran in Test mode and admitted nobody (it shows what WOULD happen). */
type Scan<T> = T & { test?: boolean };
/** Result of one door scan, as the Events door API returns it (plan §6.3 cases). `checkedInAt` is null in Test mode before a real check-in. */
export type ScanOutcome =
  | Scan<{ result: "welcomed"; fullName: string; firstName: string; checkedInAt: string | null; /** Stable per guest (the operator's test Arrived count). */ registrationId?: string }>
  | Scan<{ result: "welcome_back"; firstName: string; checkedInAt: string | null }>
  | Scan<{ result: "unknown"; threshold: number; bestScore: number | null }>
  | Scan<{ result: "ambiguous" }>
  | Scan<{ result: "inconclusive" }>
  | Scan<{ result: "not_on_list"; firstName: string }>
  | Scan<{ result: "not_admitted"; firstName: string; admission: NotAdmittedReason }>
  | Scan<{ result: "not_verified"; firstName: string; verification: VerificationState }>
  | Scan<{ result: "liveness_failed" }>
  | Scan<{ result: "no_face" }>
  | Scan<{ result: "paused" }>
  | Scan<{ result: "budget_exhausted" }>
  | Scan<{ result: "liveness_needed" }>
  /** `requestId`: shown on screen so staff can quote it; the server logs the same id. */
  | Scan<{ result: "error"; reason: OutageReason; retryInS: number; requestId?: string }>;

/** What the AR tag shows for one scan (v5 compact result). */
export type DoorOutcome = "welcome" | "welcome_back" | "not_on_list" | "not_approved" | "unknown" | "liveness_needed" | "liveness_failed" | "test"
  | "paused" | "budget_exhausted" | "error";

/** The compact fields the scan API adds to every result (never a photo). */
export interface ScanCompact {
  outcome: DoorOutcome;
  firstName: string | null;
  /** First + last name. */
  displayName: string | null;
  /** Blue badge: the person's human (face) check is current. */
  verified: boolean;
  verifiedAt: string | null;
  photo?: "none";
  trackId?: number | null;
}

/** A scan reply: the legacy result, plus the compact fields when the server answered. */
export type FaceScan = ScanOutcome & Partial<ScanCompact>;

export interface RecentScan {
  id: string;
  /** ISO timestamp. */
  at: string;
  /** Guest name; null when nobody matched. */
  name: string | null;
  result: ScanResult;
  /** A Test mode scan: nobody was checked in. */
  test?: boolean;
}

/** Why the door does (not) admit right now. Test mode works in every state except `face_off`. */
export type DoorOpenState = "live" | "not_started" | "ended" | "cancelled" | "draft" | "face_off";

/** Everything the door screen needs from Events for this door session (GET /api/door/{event}/context). */
export interface KioskContext {
  /** The station this device scans as ("Main door"); shown in the check-in log. */
  station: { id: string; name: string };
  session: { id: string; expiresAt: string; startedBy: string };
  event: {
    id: string;
    slug: string;
    name: string;
    /** IANA zone the door clock is shown in. */
    timeZone: string;
    capacity: number;
    startsAt: string;
    endsAt: string;
    /** Admin check-in log (K-21 QR). */
    logUrl: string;
  };
  state: DoorOpenState;
  doorMode: DoorMode;
  threshold: number;
  arrived: number;
  /** The daily scan budget is spent (K-19): the door stops scanning until Events reports it available again. */
  budgetExhausted: boolean;
  /** Newest first, at most 5. */
  recentScans: RecentScan[];
  /** A staff-set PIN can end door mode on this device. */
  pinSet: boolean;
  /** ISO time on the server when this was built (seeds the client clock). */
  serverTime: string;
  /** Deployed build; a different one than the page's means the door should reload (version skew). */
  build?: string;
}

/** Why the door cannot scan right now. `budget` is the daily scan limit (K-19). */
export type Connection =
  | { state: "online" }
  | { state: "offline"; reason: OutageReason | "budget"; retryAt: number; lastOnline: number | null };

/** Why this device's door session stopped: it needs the member to sign in again (or the event was removed). */
export type SessionEnd = "expired" | "ended" | "revoked";
