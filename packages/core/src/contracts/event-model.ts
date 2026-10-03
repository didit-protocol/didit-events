/** Browser-safe serialized v2 transport contract. Dates are UTC ISO strings. */
import type { z } from "zod";
import type {
Application,
ConsentInput,
EventChecks,EventDoor,EventForm,EventWrite,
Profile,
ProofCheck,
emailOverride,
eventEmailCodeSchema,
profileDraftSchema,questionSchema
} from "../domain/event-model.ts";
import type { Admission } from "../domain/transitions.ts";
import type { Rejoin,RejoinKind } from "../admission/rejoin.ts";
export type { Rejoin,RejoinKind };
export type { Admission,Application,ConsentInput,EventChecks,EventDoor,EventForm,EventWrite,Profile,ProofCheck };

export type FacePurpose = "onboarding" | "face_renewal" | "re_enrolment";
export type OnboardingStep = "email_required" | "profile_required" | "face_required" |
  "face_creating" | "face_in_progress" | "face_in_review" | "face_failed" |
  "face_expired" | "complete" | "unavailable";
export type VerificationLaunch =
  | { state: "ready"; opId: string; url: string; expiresAt: string }
  | { state: "creating"; opId: string; retryAfterMs: number }
  | { state: "not_needed" }
  | { state: "blocked"; code: "budget" | "provider_unavailable" | "review_required" | "consent_required" };

export type MissingReason = "absent" | "expired" | "revoked" | "in_review" | "continuity_required" |
  "below_minimum" | "name_mismatch" | "provider_unavailable";
export interface MissingCheck { check: ProofCheck; reason: MissingReason; minimum?: number }
export interface ConsentReceipt extends ConsentInput { acceptedAt: string }
export interface RequestReceipt {
  version: 1; evaluatedAt: string; emailVerifiedAt: string; profileVersion: number;
  evidenceIds: Partial<Record<ProofCheck, string>> & { face: string };
  consent: ConsentReceipt;
}
export interface VerificationBadge {
  check: "email" | ProofCheck; label: string;
  state: "verified" | "missing" | "expired" | "in_review" | "revoked";
  verifiedAt: string | null; validUntil: string | null;
  source: "sign_in" | "liveness" | "phone" | "document" | "age_estimation" | "legacy";
  minimum?: number;
}
export interface ApplicantDrawer {
  registrationId: string; eventId: string; accountId: string;
  admission: Admission; readiness: "ready" | "renewal_required" | "review_required" | "legacy_completion";
  profile: z.infer<typeof profileDraftSchema> & { email: string; photoUrl: string | null; version: number };
  profileVersionAtRequest: number | null; updatedSinceRequest: boolean;
  acceptedPolicyVersion: number; formVersion: number; badges: VerificationBadge[];
  answers: { id: string; label: string; kind: z.infer<typeof questionSchema>["kind"] | "legacy";
    value: string | boolean | string[] | null; displayValue: string; required: boolean }[];
  history: { id: string; at: string; kind: "submission" | "admission" | "checkin" | "verification";
    label: string; actorLabel: string; reason: string | null }[];
  staffNote: string | null; lateCancellation: boolean;
  /** The account is deleted or being deleted: no profile, photo, answers or checks, only the decisions (history, note). */
  accountDeleted?: boolean;
  actions: { approve: boolean; waitlist: boolean; reject: boolean; revoke: boolean;
    resendRenewal: boolean; blockedReason: string | null };
}
export type ApiErrorCode = "unauthenticated" | "forbidden" | "not_found" | "invalid" |
  "context_changed" | "idempotency_conflict" | "checks_required" | "onboarding_required" |
  "capacity" | "closed" | "invite_required" | "invite_invalid" | "rate_limited" |
  "provider_unavailable" | "budget" | "review_required" | "retained_data_expired";
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: {
  code: ApiErrorCode; message: string; fields?: Record<string, string>;
  retryAfterMs?: number; context?: RequestContext;
} };
export interface OnboardingView {
  step: OnboardingStep; onboardedAt: string | null;
  email: { address: string; verified: boolean };
  profile: Partial<Profile>; profileVersion: number; missingProfileFields: string[];
  photoUrl: string | null; face: VerificationBadge | null;
  operation: { id: string; state: "creating" | "active" | "completed" | "failed" | "expired" | "stale";
    expiresAt: string; canResume: boolean } | null;
  returnTo: string; canRequest: boolean;
}
export interface RequestContext {
  event: { id: string; slug: string; name: string; policyVersion: number; formVersion: number;
    checks: EventChecks; form: EventForm; door: EventDoor };
  onboarding: OnboardingView;
  draft: { id: string; version: number; expiresAt: string; application: Application } | null;
  prefill: Application; missingQuestions: string[]; missing: MissingCheck[];
  badges: VerificationBadge[]; consent: { disclosureVersion: "events-profile-v2";
    text: string; checksToAccept: ProofCheck[]; eventConsentText: string | null };
  canSubmit: boolean; submitLabel: "Request to join" | "Join event" | "Join waitlist" | "Accept invitation";
  nextAction: "profile" | "face" | "extras" | "answers" | "submit" | "status" | "unavailable";
  /** Whether a request can go out now: open, only to the waitlist, or why not (the modal's closed screen names it). */
  availability: "open" | "waitlist" | "full" | "closed" | "started" | "ended" | "cancelled" | "invite_only";
  registration: GuestRegistrationView | null;
  /** The latest extras check (phone / ID / age) this account started for this event, with Didit's last status. */
  checksOperation?: { id: string; state: NonNullable<OnboardingView["operation"]>["state"]; providerStatus: string | null } | null;
}
export interface GuestRegistrationView {
  id: string; eventId: string; slug: string; admission: Admission;
  readiness: "ready" | "renewal_required" | "review_required" | "legacy_completion";
  policyVersion: number; formVersion: number; missing: MissingCheck[]; badges: VerificationBadge[];
  nextExpiryAt: string | null; checkedInAt: string | null;
  withdrawal: { allowed: boolean; label: "Withdraw request" | "Cancel place";
    late: boolean; unavailableReason: string | null };
  canReapply: boolean; waitlistPosition: number | null;
  /** v5 re-join: what this registration allows next (request again, rejoin an invitation, status only) and the rule. */
  rejoin: Rejoin;
}
export type SubmitResult = { registration: GuestRegistrationView; replayed: boolean; redirectTo: string };
export interface EventEditorView {
  eventId: string; editVersion: number; policyVersion: number; formVersion: number;
  status: "draft" | "published" | "live" | "ended" | "cancelled";
  values: Omit<EventWrite, "expectedVersion">;
  coverUrl: string | null; descriptionHtml: string;
  capabilities: { phone: boolean; document: boolean; age: boolean; reason: string | null };
  acceptedPolicyCounts: { policyVersion: number; registrations: number }[];
  actions: { save: boolean; publish: boolean; unpublish: boolean; cancel: boolean; end: boolean;
    publishBlockedReasons: string[] };
  emails: EmailTemplateView[];
}
export interface EmailTemplateView {
  code: z.infer<typeof eventEmailCodeSchema>; title: string; trigger: string;
  enabled: boolean; canDisable: boolean; canEdit: boolean;
  from: string; replyTo: string; override: z.infer<typeof emailOverride> | null;
}
export interface EmailPreview { subject: string; html: string; text: string; from: string;
  replyTo: string; rendererVersion: string }
export interface EmailTestResult { testId: string; status: "queued" | "sent" | "delivered" | "failed";
  errorCode: string | null }
export interface CoverUploadResult { version: string; url: string; width: number; height: number;
  contentType: "image/jpeg" | "image/png" | "image/webp"; editVersion: number }
