/**
 * Guest flow v3: one modal on the event page (bottom sheet on phones). Everything the modal shows is derived from the
 * server's view on every read — signed out → account (Google or email code) → only the missing profile fields → the
 * face (only when the account has no valid face) → event extras / answers → the request, sent automatically once
 * nothing is left to ask. This module is the pure part: which step shows, what the face step is doing, when the
 * request may go out on its own, and the final copy. Browser-safe (type-only imports).
 */
import type { Admission, MissingCheck, MissingReason, OnboardingView, RequestContext, VerificationLaunch } from "@didit-events/core/contracts/event-model";
import { askPhone, questionsToAsk } from "../request-join";

export type JoinStage = "sign_in" | "profile" | "face" | "extras" | "answers" | "submit" | "done" | "unavailable";

/** What the event page hands the modal (server-rendered, re-read after sign-in). */
export type JoinInitial =
  | { kind: "signed_out"; requestsOpen: boolean }
  | { kind: "signed_in"; ctx: RequestContext }
  /** Staff or an unavailable account: no guest request from this session. */
  | { kind: "unavailable"; reason: "staff" | "account" }
  /** v5: this browser's account is in its deletion grace period: "Keep my account" first, then the flow continues. */
  | { kind: "deleting"; graceUntil: string };

export function joinStage(initial: JoinInitial): JoinStage {
  if (initial.kind === "unavailable" || initial.kind === "deleting") return "unavailable";
  if (initial.kind === "signed_out") return initial.requestsOpen ? "sign_in" : "unavailable";
  switch (initial.ctx.nextAction) {
    case "profile":
      return "profile";
    case "face":
      return "face";
    case "extras":
      return "extras";
    case "answers":
      return "answers";
    case "submit":
      return "submit";
    case "status":
      return "done";
    case "unavailable":
      return "unavailable";
  }
}

/**
 * The request goes out on its own only when nothing is left to ask (no questions, no phone, no host consent text) and
 * the guest asked for it in this tab (they tapped Request to join, then went through the steps). A shared link with
 * ?join=1 opens the modal but still waits for one tap.
 */
export function canAutoSubmit(ctx: RequestContext, intent: boolean): boolean {
  return intent && ctx.nextAction === "submit" && ctx.canSubmit && questionsToAsk(ctx).length === 0 && !askPhone(ctx) && !ctx.consent.eventConsentText;
}

/* ── Final state ───────────────────────────────────────────────────────────────────────────────────────────── */

export function resultCopy(admission: Admission, eventName: string): { title: string; body: string; tone: "ok" | "wait" | "neutral" } {
  switch (admission) {
    case "approved":
      return { title: "You're in", body: `See you at ${eventName}. At the door, just look at the screen: your face is your ticket.`, tone: "ok" };
    case "pending":
      return { title: "Request sent", body: "The hosts review every request. We email you as soon as they decide.", tone: "wait" };
    case "waitlisted":
      return { title: "You're on the waitlist", body: "If a place opens up, the hosts can offer it to you and we email you straight away.", tone: "wait" };
    default:
      return { title: "Your registration", body: "Your request for this event is already on file.", tone: "neutral" };
  }
}

/** The result's status icon: "You're in" draws the success check; a request or waitlist place is pending. */
export function resultStatus(admission: Admission): "success" | "pending" | "info" {
  return admission === "approved" ? "success" : admission === "pending" || admission === "waitlisted" ? "pending" : "info";
}

/* ── Face step ─────────────────────────────────────────────────────────────────────────────────────────────── */

export type FacePhase =
  | { phase: "starting" }
  | { phase: "preparing"; retryAfterMs: number }
  | { phase: "embedded"; url: string; opId: string }
  | { phase: "checking"; opId: string | null }
  /** `opId`: the operation under review (a later terminal decision for it still lands). */
  | { phase: "review"; opId?: string | null }
  | { phase: "declined" }
  | { phase: "not_eligible"; check: MissingCheck["check"]; reason: MissingReason; minimum?: number; retry: boolean }
  | { phase: "expired" }
  | { phase: "cancelled" }
  | { phase: "camera" }
  | { phase: "blocked"; code: Extract<VerificationLaunch, { state: "blocked" }>["code"] }
  | { phase: "error" }
  | { phase: "done" };

/** Where the face step starts for a server view (before this tab launched anything). */
export function initialFacePhase(view: OnboardingView): FacePhase {
  switch (view.step) {
    case "complete":
      return { phase: "done" };
    case "face_in_review":
      return { phase: "review" };
    case "face_failed":
      return view.operation?.state === "expired" || view.operation?.state === "stale" ? { phase: "expired" } : { phase: "declined" };
    default:
      // face_required / face_expired / face_creating / face_in_progress: start (or resume) the embedded check at once.
      return { phase: "starting" };
  }
}

/** A launch answer from POST /api/me/onboarding/face (or the extras checks). */
export function launchPhase(launch: VerificationLaunch): FacePhase | "refresh" {
  switch (launch.state) {
    case "ready":
      return { phase: "embedded", url: launch.url, opId: launch.opId };
    case "creating":
      return { phase: "preparing", retryAfterMs: Math.min(Math.max(launch.retryAfterMs, 1000), 10_000) };
    case "not_needed":
      return "refresh";
    case "blocked":
      return { phase: "blocked", code: launch.code };
  }
}

/** The SDK's completion callback (a hint only: the decision comes from the server). */
export type SdkResult = { type: "completed" | "cancelled" | "failed"; session?: { sessionId: string; status: string }; error?: { type: string; message: string } };

export function sdkPhase(current: FacePhase, result: SdkResult): FacePhase {
  const opId = current.phase === "embedded" ? current.opId : null;
  if (result.type === "completed") return { phase: "checking", opId };
  if (result.type === "cancelled") return { phase: "cancelled" };
  switch (result.error?.type) {
    case "cameraAccessDenied":
      return { phase: "camera" };
    case "sessionExpired":
      return { phase: "expired" };
    default:
      return { phase: "error" };
  }
}

/**
 * A fresh server view while the guest is in the check or waiting for its result (pushed by the stream). Only the
 * operation this tab launched can turn the step into a failure; an older failure never overrides a new attempt.
 */
export function viewPhase(current: FacePhase, view: OnboardingView): FacePhase {
  if (view.step === "complete") return { phase: "done" };
  if (current.phase === "review") {
    // Under review: only a terminal failure of the same operation moves on (approval arrives as "complete").
    if (!current.opId || view.step !== "face_failed" || view.operation?.id !== current.opId) return current;
    return view.operation?.state === "expired" || view.operation?.state === "stale" ? { phase: "expired" } : { phase: "declined" };
  }
  if (current.phase !== "embedded" && current.phase !== "checking") return current;
  const mine = !current.opId || view.operation?.id === current.opId;
  if (view.step === "face_in_review" && mine) return { phase: "review", opId: view.operation?.id ?? current.opId };
  if (view.step === "face_failed" && mine) return view.operation?.state === "expired" || view.operation?.state === "stale" ? { phase: "expired" } : { phase: "declined" };
  return current;
}

/** Phases that wait for the server: the page listens to the verification stream while in them. */
export const watchesDecision = (p: FacePhase) => p.phase === "embedded" || p.phase === "checking" || p.phase === "review" || p.phase === "preparing";

/**
 * How the stream runs: "decision" (the guest is waiting on a result, the server reads Didit every few seconds) or
 * "passive" (the guest is still in the camera UI: webhook push, plus a rare read so a check finished on a phone lands).
 * Passive keeps the per-account read budget for the moment the guest actually waits.
 */
export const streamMode = (p: FacePhase): "decision" | "passive" => (p.phase === "embedded" ? "passive" : "decision");

/* ── Extras checks (phone / ID / age) ──────────────────────────────────────────────────────────────────────── */

/**
 * A settled extras check that did not pass (the request context's operation for the workflow this event needs).
 * `not_eligible`: Didit completed the check but the event's requirement is still not met (under the minimum age, the
 * ID name differs from the profile, or no usable proof came back).
 */
export type CheckDecision =
  | { opId: string; outcome: "review" | "declined" | "expired" }
  | { opId: string; outcome: "not_eligible"; check: MissingCheck["check"]; reason: MissingReason; minimum?: number; retry: boolean };

const EXPIRED_STATUSES = new Set(["Expired", "Kyc Expired", "Abandoned"]);
const REVIEW_REASONS = new Set<MissingReason>(["in_review", "continuity_required"]);

export function checksDecision(ctx: RequestContext): CheckDecision | null {
  const op = ctx.checksOperation;
  if (!op || ctx.nextAction !== "extras") return null;
  if (op.state === "expired" || op.state === "stale") return { opId: op.id, outcome: "expired" };
  const extras = ctx.missing.filter((m) => m.check !== "face");
  if (op.providerStatus === "In Review" || extras.some((m) => REVIEW_REASONS.has(m.reason))) return { opId: op.id, outcome: "review" };
  if (op.state === "failed") return { opId: op.id, outcome: EXPIRED_STATUSES.has(op.providerStatus ?? "") ? "expired" : "declined" };
  if (op.state === "completed" && extras.length) {
    // A new check cannot change a result below the minimum age, and a name mismatch is fixed on the profile (the server
    // blocks a new check for it); anything else (an unreadable photo, a proof that did not come back) is worth another try.
    const shown = extras.find((m) => m.reason === "below_minimum") ?? extras.find((m) => m.reason === "name_mismatch") ?? extras[0]!;
    return { opId: op.id, outcome: "not_eligible", check: shown.check, reason: shown.reason, ...(shown.minimum !== undefined ? { minimum: shown.minimum } : {}), retry: shown.reason !== "below_minimum" && shown.reason !== "name_mismatch" };
  }
  return null;
}

/** The id of the request context's extras operation once it has settled (completed, failed, expired). */
export function settledCheckOp(ctx: RequestContext): string | null {
  const op = ctx.checksOperation;
  return op && op.state !== "active" && op.state !== "creating" ? op.id : null;
}

/** How long "Checking your result…" may wait after its operation settled before offering Check again. */
export const SETTLED_STUCK_MS = 20_000;

/**
 * Same rule as `viewPhase`: only the operation this tab launched (or the one it resumed) can fail the step. A check
 * under review keeps its operation, so a later terminal decision for it (declined, expired, not eligible) still lands.
 */
export function decisionPhase(current: FacePhase, decision: CheckDecision | null): FacePhase {
  if (!decision) return current;
  if (current.phase === "review") {
    if (!current.opId || current.opId !== decision.opId || decision.outcome === "review") return current;
  } else if (current.phase !== "embedded" && current.phase !== "checking") return current;
  else if (current.opId && current.opId !== decision.opId) return current;
  if (decision.outcome === "not_eligible") return { phase: "not_eligible", check: decision.check, reason: decision.reason, retry: decision.retry, ...(decision.minimum !== undefined ? { minimum: decision.minimum } : {}) };
  if (decision.outcome === "review") return { phase: "review", opId: decision.opId };
  return { phase: decision.outcome };
}
