/**
 * Applicant review view models (design/05 AP-01…AP-27). `app/admin/(events)/events/[id]/(tabs)/applicants/data.ts`
 * returns these; it is the single swap point for the F1/B4 services (`admissionService`, `inviteService`,
 * `eventService`). Admission names follow `@didit-events/core/domain` (`pending | approved | waitlisted | rejected |
 * cancelled_by_guest | …`); the tabs group them the way the design does.
 */

import type { ApplicantDrawerView } from "../model/contract";
import type { PersonSummary, PersonView } from "../person/types";

/** The five segments of the applicants toolbar. */
export type ApplicantTab = "pending" | "waitlist" | "approved" | "rejected" | "cancelled";
export const APPLICANT_TABS: { key: ApplicantTab; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "waitlist", label: "Waitlist" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
];

/** How the applicant signs in (Google via Didit, or the Didit email code the design calls "Email code"). */
export type SignIn = "google" | "email";
export type SignInFilter = "all" | SignIn;
/** The "Signals ▾" filter. */
export type SignalFilter = "all" | "verified-before" | "returning" | "duplicate" | "new";

export type TagToneKey = "ok" | "warn" | "bad" | "brand" | "neu" | "feat";
export interface SignalTag {
  label: string;
  tone: TagToneKey;
}

/** Verification state of an approved guest (AP-13 STATUS column). */
export type ApprovedStatus = "going" | "link-sent" | "in-review" | "verifying" | "declined" | "expired" | "invited";

/** One applicant (a registration + its account) as the review list shows it. */
export interface ApplicantRow {
  id: string;
  name: string;
  email: string;
  /** Photo + verified badge. */
  person?: PersonSummary;
  signIn: SignIn;
  company: string;
  role: string;
  /** "Why they want to come" answer; "—" when empty. */
  why: string;
  tab: ApplicantTab;
  signals: SignalTag[];
  /** Already verified with Didit and meets the event requirements: approval goes straight to Going (M-06). */
  verified: boolean;
  /** Relative request time as the design shows it ("2h ago", "Yesterday", "28 Sep"). */
  requested: string;
  /** Waitlist position (1-based, FIFO by applied_at). */
  position?: number;
  /** Approved tab: verification line + status. */
  approval?: { line: string; status: ApprovedStatus };
  /** Rejected tab: the internal reason and whether M-10 went out. */
  rejection?: { reason: string; emailed: boolean };
  /** Cancelled tab: the guest's reason, when, and the late flag (<24 h). */
  cancellation?: { reason: string; when: string; late: boolean };
}

/** Search params of /admin/events/[id]/applicants, parsed and bounded. */
export interface ApplicantQuery {
  tab: ApplicantTab;
  q: string;
  signIn: SignInFilter;
  signal: SignalFilter;
  /** Drawer: `?applicant=<id>`. */
  applicant?: string;
  /** Invite modal: `?invite=email` (AP-16) or `?invite=link` (AP-20). */
  invite?: "email" | "link";
}

export type ApplicantCounts = Record<ApplicantTab, number>;

/** Capacity meter (approved of capacity) and the registration state that drives the AP-24 / AP-25 banners. */
export interface ApplicantsEvent {
  id: string;
  approved: number;
  capacity: number;
  /** open = taking requests; full = at capacity (auto-waitlist); closed = registration closed. */
  registration: "open" | "full" | "closed";
  /**
   * Why registration is closed (AP-25 banner). Only "date" (the closing date passed, the event has not started) can be
   * reopened; absent = "date".
   */
  closed?: "date" | "started" | "ended" | "cancelled" | "draft";
  /** "Tue 6 Oct" (AP-25 banner): the closing date, when one is set. */
  closedOn?: string;
  /** Guests who never verify are released on this day (AP-06 body). */
  releaseOn: string;
  /** Auto-promote from the waitlist (AP-12 banner). */
  autoPromote: boolean;
  /** Public request link without scheme ("events.didit.me/ai-era"). */
  requestLink: string;
  /** Optimistic edit version "Reopen requests" is sent with. */
  editVersion?: number;
}

export interface ApplicantList {
  rows: ApplicantRow[];
  counts: ApplicantCounts;
  event: ApplicantsEvent;
}

/* ── Drawer (AP-03, AP-04, AP-05, AP-26) ───────────────────────────── */

export type KvTone = "ok" | "warn" | "muted" | "link";
export interface DrawerKv {
  k: string;
  v: string;
  tone?: KvTone;
  href?: string;
}
export interface DrawerSection {
  title: string;
  rows: DrawerKv[];
  /** Staff note box (the private note, saved on blur). */
  note?: { value: string; placeholder: string };
}

export interface ApplicantDetail {
  id: string;
  name: string;
  email: string;
  initials: string;
  tab: ApplicantTab;
  /** The banner under the name: returning guest (ok), possible duplicate (warn), meets all requirements (ok). */
  flag?: { text: string; tone: "ok" | "warn" };
  sections: DrawerSection[];
  /**
   * Event model v2 drawer (lane A's ApplicantDrawer DTO): full profile, photo, links, badges, every answer and
   * history. When present the drawer renders it above `sections` (which then carry only the staff note).
   */
  v2?: ApplicantDrawerView;
  /** The shared person view (profile, request, verification, check-in, timeline) built by the loader; frame fixtures derive it from `v2`. */
  person?: PersonView;
  /** The event's IANA zone for drawer dates (default UTC). */
  timeZone?: string;
}

/* ── Invites (AP-16…AP-20) ──────────────────────────────────────────── */

export type InviteCheck = "ready" | "invalid" | "existing" | "duplicate";
export interface InviteEmailCheck {
  email: string;
  check: InviteCheck;
}
export interface InviteSummary {
  alreadyRequested?: number;
  invited: number;
  approvedExisting: number;
  /** Skip approval on a full event: new invitees and pending requests joined the waitlist instead (AP-25). */
  waitlisted: number;
  skippedInvalid: number;
}
export interface ShareLinks {
  publicLink: string;
  privateLink: string;
  /** "Skips approval. 20 uses left · expires Tue 6 Oct. Revoke anytime." */
  privateHint: string;
}

/* ── Requirements (AP-27) ───────────────────────────────────────────── */

export interface RequirementSettings {
  name: boolean;
  email: boolean;
  liveness: boolean;
  document: boolean;
  age18: boolean;
  /** Reuse verifications newer than this many months. */
  reuseMonths: 3 | 6 | 12 | 24;
  /** The event edit version these were read at; the save is refused (conflict) if the event changed since. */
  editVersion: number;
}

/* ── Server action results ─────────────────────────────────────────── */

export type Decision = "approve" | "waitlist" | "reject" | "promote" | "remove" | "revoke" | "reconsider" | "reapprove" | "resend";

export type ApplicantActionError = "session_expired" | "invalid" | "not_found" | "conflict" | "capacity" | "forbidden";
export type ApplicantActionResult<T extends object = object> = ({ ok: true } & T) | { error: ApplicantActionError; message?: string };

export interface RejectInput {
  reason: RejectReason;
  note: string;
  email: boolean;
  block: boolean;
}
export const REJECT_REASONS = ["Not a fit for this audience", "At capacity", "Duplicate", "Incomplete answers", "Other"] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];
