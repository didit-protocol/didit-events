import type { GuestRegistrationView } from "@didit-events/core/contracts/event-model";
/**
 * View models for the guest account surfaces (U5): sign-in (U-01…U-13, DA-01…DA-05, R-04…R-07, R-33), registration
 * (R-01…R-09, U-14…U-19, U-39/U-40), the per-event status pages (R-10, R-19…R-34, U-41, U-42), cancellation
 * (U-26…U-31) and the account area (U-20…U-22, U-32…U-38). Routes read them through their own `data.ts`, which
 * returns fixtures today and maps the F1/B1/B2 services (accounts, registrations, evidence, OTP) into these shapes.
 */
import type { GuestPillStatus } from "@didit-events/ui";
import type { PublicEvent } from "../public/types";

/** Didit evidence the guest area shows (C1): name + email come from the full workflow, face from liveness. */
export type EvidenceKind = "name" | "email" | "selfie" | "document" | "age" | "phone";

export type Verification =
  | { state: "none" }
  | ({ state: "verified"; verifiedAt: string; selfieValidUntil: string } & NameProof)
  /** Identity still valid, face evidence stale (U-42, C1 renewal). */
  | ({ state: "selfie_expired"; verifiedAt: string; selfieExpiredAt: string } & NameProof);
/** True when an ID document Didit read carries the profile name (the `name_from_id` check). A face check alone never sets it. */
interface NameProof {
  nameFromId?: boolean;
}

export interface ProfileLink {
  label: string;
  href: string;
}

export interface GuestAccount {
  staffRole?: "owner" | "admin" | "staff";
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  company?: string;
  role?: string;
  /** "Head of Risk · Globex · Barcelona" */
  headline?: string;
  bio?: string;
  links: ProfileLink[];
  photoUrl?: string;
  /** Linked Google identity (C5: linked only when Google's verified email equals the account email). */
  google?: { email: string };
  verification: Verification;
  marketingOptIn: boolean;
  eventsAttended: number;
}

/**
 * The name is "verified" only when an ID document proved it. A liveness / face check proves a real person, not what
 * they are called: that account is "Human verified", and its name stays editable.
 */
export const nameVerified = (a: Pick<GuestAccount, "verification">) => a.verification.state !== "none" && a.verification.nameFromId === true;

/** Trimmed "First Last"; "" when the account has no names yet (never a lone space). */
export const fullName = (a: Pick<GuestAccount, "firstName" | "lastName">) => [a.firstName?.trim(), a.lastName?.trim()].filter(Boolean).join(" ");

/** Profile step defaults (U-04): the name from trimmed parts, "" for a new email-code guest. */
export const profileDefaults = (a: Pick<GuestAccount, "firstName" | "lastName" | "company" | "role">): ProfileFormState => ({ values: { fullName: fullName(a), company: a.company, role: a.role } });

/* ── Sign-in (Didit email code or Google via Didit) ─────────────────────────────────────────────────────────── */

export type SignInStep =
  /** U-01 / DA-01: Google or email. `inapp`: sent back from the Google start inside an in-app browser (the note opens). */
  | { step: "choose"; email?: string; error?: string; banner?: "google_cancelled" | "google_failed" | "session_expired" | "inapp" }
  /** U-06 / U-07: email entry (mobile). */
  | { step: "email"; email?: string; error?: string }
  /** U-08, U-10…U-12, DA-03, DA-05: code entry and its states. */
  | { step: "code"; email: string; status: CodeStatus; attemptsLeft?: number; resendInSeconds: number; sentAt?: string }
  /** U-09 (codes paused for this email after 3 wrong codes) and R-33 (send limit for this browser/IP, 15 min). */
  | { step: "locked"; email: string; retryAt: string; minutes: number; scope: "email" | "ip" }
  /** U-13: code accepted, session being created. */
  | { step: "signing_in" };

/** sent = fresh code; wrong = last attempt failed; expired = the code timed out (a new one was not sent yet); resent = new code on its way. */
export type CodeStatus = "sent" | "wrong" | "expired" | "resent";

/** What a code check returns (B2: Didit `/v3/email/check`, the result is in `status`, not the HTTP code). */
export type CodeCheck = { ok: true; isNew: boolean; linkedGoogle: boolean } | { ok: false; reason: "wrong"; attemptsLeft: number } | { ok: false; reason: "expired" | "locked" };

/* ── Registration ───────────────────────────────────────────────────────────────────────────────────────────── */

export interface RegisterInput {
  fullName: string;
  email: string;
  company: string;
  role: string;
  consent: boolean;
}

export type RegisterField = keyof RegisterInput;

/** R-01…R-09 (signed-out request: details → Didit email code → request sent). */
export type RegisterState =
  | { step: "form"; values: Partial<RegisterInput>; errors?: Partial<Record<RegisterField, string>> }
  | { step: "code"; values: RegisterInput; status: CodeStatus; attemptsLeft?: number; resendInSeconds: number; sentAt?: string }
  | { step: "locked"; values: RegisterInput; minutes: number; scope: "email" | "ip" }
  | { step: "sent"; firstName: string; email: string; replyBy: string }
  | { step: "already"; email: string; requestedAt: string; status: string };

/** U-14…U-16: the one-time profile after a first sign-in. */
export interface ProfileInput {
  fullName: string;
  company: string;
  role: string;
  why: string;
  consent: boolean;
}

export type ProfileFormState = { values: Partial<ProfileInput>; errors?: Partial<Record<keyof ProfileInput, string>> };

/** One requirement row (U-39, U-40, U-42). */
export interface RequirementRow {
  kind: EvidenceKind;
  label: string;
  detail: string;
  met: boolean;
}

/* ── Per-event status for a signed-in guest ─────────────────────────────────────────────────────────────────── */

export type GuestEventStatus = (
  | { kind: "pending"; requestedAt: string; replyBy: string; justRequested: boolean; via: "google" | "email" }
  | { kind: "approved"; linkExpiresAt: string }
  | { kind: "going"; verifiedAt: string; reused: boolean }
  | { kind: "in_review" }
  | { kind: "requirements_unmet" | "verifying" | "invited" | "revoked" | "cancelled_by_host" | "event_cancelled" | "deleted" }
  | { kind: "declined"; attemptsLeft: number }
  | { kind: "waitlisted"; position: number }
  | { kind: "not_approved" }
  | { kind: "link_expired" }
  | { kind: "cancelled"; reason?: string; justCancelled: boolean }
  | { kind: "withdrawn" }
  | { kind: "full"; capacity: number }
  | { kind: "closed"; closedAt: string }
  | { kind: "checked_in"; at: string; door: string; wifi?: string; next?: string }
  | { kind: "ended"; attended: number; audience: string; attendance?: "attended" | "no_show" | "none" }
  | { kind: "email_mismatch"; verifiedEmail: string; invitedEmail: string }
  | { kind: "link_other_account" }
  | { kind: "selfie_expired"; expiredAt: string }
  | {kind:"checks_required"; missing:GuestRegistrationView["missing"]}
) & {registration?:GuestRegistrationView};

export type GuestEventStatusKind = GuestEventStatus["kind"];

/** A row of My events (U-20): the pill of the ui kit's guest statuses (going, pending, waitlist, attended, …). */
export type MyEventBadge = GuestPillStatus | "approved" | "in-review" | "declined" | "checked-in";

export interface MyEvent {
  event: PublicEvent;
  badge: MyEventBadge;
  /** "Thu 8 Oct · Didit HQ", "3 Jun · attended", "12 Feb · cancelled by you" */
  detail: string;
  /** v5: a withdrawn / cancelled / declined registration this guest may request again (opens the join modal). */
  again?: { label: string; href: string };
}

/* ── Cancellation ───────────────────────────────────────────────────────────────────────────────────────────── */

export const CANCEL_REASONS = ["Schedule conflict", "Travel plans changed", "Feeling unwell", "A colleague is going instead", "Not interested anymore", "Other"] as const;
export const WITHDRAW_REASONS = ["Schedule conflict", "Changed my mind", "Other"] as const;

export type CancelMode =
  /** U-26…U-28: an approved/going place (reason required; late = under 24 h before the start). */
  | { mode: "cancel"; /** Whole hours, rounded on the server (0 = under half an hour). */ hoursToStart: number; late: boolean }
  /** U-30: a pending request (reason optional). */
  | { mode: "withdraw" }
  /** R-23 "Leave waitlist". */
  | { mode: "leave_waitlist" }
  /** U-31: doors are open. */
  | { mode: "started" };

export interface CancelFormState {
  reason?: string;
  note?: string;
  error?: string;
}

/* ── Invites (U-24, U-25) ───────────────────────────────────────────────────────────────────────────────────── */

export type InviteView =
  | { state: "signed_out"; event: PublicEvent; invitedBy: string; message?: string; email: string; skipApproval?: boolean }
  | { state: "wrong_account"; event: PublicEvent; email: string; signedInAs: string }
  /** Signed in with the invited email: accept (U-24 signed in). */
  | { state: "accepted"; event: PublicEvent; invitedBy: string; message?: string; skipApproval?: boolean }
  | { state: "expired"; event: PublicEvent }
  | { state: "not_found" };
