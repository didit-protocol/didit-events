/**
 * One person as staff see them in the Guests and Requests drawers (and the badge in both tables). Every field is
 * built from the source of truth (account, evidence, verification, registration, history) by `person/build.ts`;
 * dates are ISO strings, formatted in the event's zone at render time.
 */

/** The human (face) check is approved and current: the blue badge. */
export interface PersonVerified {
  /** When Didit approved the selfie liveness (evidence established_at). */
  verifiedAt: string;
  /** "Selfie liveness" (or "Imported verification" for legacy proof). */
  method: string;
  emailVerifiedAt: string | null;
  /** Account (profile) creation. */
  createdAt: string | null;
}

export interface PersonLink {
  /** "LinkedIn" | "Website" | "X" | "Link". */
  kind: string;
  label: string;
  href: string;
}

export type PersonTone = "ok" | "warn" | "danger" | "review" | "muted";

/** One accepted check (email, face, phone, age, document) with its outcome. */
export interface PersonCheck {
  check: string;
  label: string;
  state: "verified" | "missing" | "expired" | "in_review" | "revoked";
  verifiedAt: string | null;
  validUntil: string | null;
  minimum?: number;
}

export interface PersonAnswer {
  id: string;
  label: string;
  value: string;
  required: boolean;
  /** An answer from a pre-v2 form. */
  legacy?: boolean;
}

/** A request extra (contact phone…) with whether Didit verified it. */
export interface PersonExtra {
  label: string;
  value: string;
  verified: boolean;
  verifiedAt: string | null;
}

export interface PersonConsent {
  acceptedAt: string;
  /** "Human / face", "Phone"… as accepted with the request. */
  checks: string[];
  eventConsent: boolean;
  policyVersion: number | null;
}

export type PersonVerificationState = "verified" | "expired" | "in_review" | "declined" | "in_progress" | "not_started";

export interface PersonVerification {
  state: PersonVerificationState;
  method: string | null;
  verifiedAt: string | null;
  validUntil: string | null;
  /** The Didit session behind the current face proof (or the latest attempt). */
  sessionId: string | null;
  diditUrl: string | null;
  /** Staff-only selfie route; null when there is no approved face proof to show. */
  selfieUrl: string | null;
  /** Didit's decline reason, when declined. */
  reason?: string;
  checks: PersonCheck[];
  readiness?: { text: string; tone: PersonTone };
}

export interface PersonCheckIn {
  at: string;
  door: string;
  by?: string;
  note?: string;
  /** Face match confidence (percent). */
  match?: number;
}

/** A timeline line. The four standard steps always show (pending without a date); audit lines follow. */
export interface PersonTimelineItem {
  key: string;
  label: string;
  at: string | null;
  who?: string;
  reason?: string;
  tone?: "review" | "danger";
  done: boolean;
}

export interface PersonView {
  /** The account is deleted or being deleted: the drawer shows "Account deleted", the check-in and the timeline only. */
  accountDeleted?: boolean;
  timeZone: string;
  name: string;
  email: string;
  /** Versioned staff photo route (or an https URL); null → initials. */
  photoUrl: string | null;
  headline: string;
  company: string;
  role: string;
  bio: string;
  links: PersonLink[];
  emailVerifiedAt: string | null;
  createdAt: string | null;
  verified: PersonVerified | null;
  /** The profile changed after the request (versions). */
  updatedSinceRequest: { from: number | null; to: number } | null;
  request: {
    requestedAt: string | null;
    answers: PersonAnswer[];
    extras: PersonExtra[];
    consent: PersonConsent | null;
    /** Answers were removed under the retention policy. */
    purged?: boolean;
  };
  verification: PersonVerification;
  checkIn: PersonCheckIn | null;
  /** Doors are open (the event started): "Not checked in" instead of "Doors not open yet". */
  started: boolean;
  timeline: PersonTimelineItem[];
}

/** What the tables need for the avatar + badge. */
export interface PersonSummary {
  photoUrl?: string;
  verified?: PersonVerified;
  /** The event's zone for the badge tooltip dates (default UTC). */
  timeZone?: string;
}
