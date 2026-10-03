/**
 * RequestContext fixtures (event model v2) for the /_frames gallery and the request tests: the one-tap path, missing
 * profile fields, face missing/expired, extras, questions and a waitlist. In-memory API, no network.
 */
import type { GuestRegistrationView, RequestContext, SubmitResult, VerificationLaunch } from "@didit-events/core/contracts/event-model";
import { rejoin, type RejoinFacts } from "@didit-events/core/admission/rejoin";
import type { RequestApi } from "./request-join";
import { MARIA_PROFILE, ONBOARDING_VIEWS } from "./onboarding-fixtures";

const Q_WHY = "7d0f3a52-1c7e-4c2a-9a55-0c1d2f3a4b01";
const Q_TRACK = "7d0f3a52-1c7e-4c2a-9a55-0c1d2f3a4b02";
const O_RISK = "7d0f3a52-1c7e-4c2a-9a55-0c1d2f3a4c01";
const O_PRODUCT = "7d0f3a52-1c7e-4c2a-9a55-0c1d2f3a4c02";
const Q_DIET = "7d0f3a52-1c7e-4c2a-9a55-0c1d2f3a4b03";
export const QUESTION_IDS = { why: Q_WHY, track: Q_TRACK, diet: Q_DIET, risk: O_RISK, product: O_PRODUCT } as const;

const FACE = { check: "face" as const, label: "Face check", state: "verified" as const, verifiedAt: "2026-09-30T10:02:00Z", validUntil: "2027-03-29T10:02:00Z", source: "liveness" as const };
const EMAIL = { check: "email" as const, label: "Email", state: "verified" as const, verifiedAt: "2026-09-30T10:00:00Z", validUntil: null, source: "sign_in" as const };

const base: RequestContext = {
  event: {
    id: "0b7e4b9c-5f7a-4a57-8f8e-2d7c1a9b3e10",
    slug: "ai-era",
    name: "Building, Raising & Scaling in the AI Era",
    policyVersion: 1,
    formVersion: 1,
    checks: { version: 1, required: [], max_age: {} },
    form: { version: 1, mode: "request", closes_at: null, waitlist: true, fields: { phone_number: "off" }, questions: [], consent_text: null },
    door: { kiosk: true, mode: "supervised", match_threshold: 80 },
  },
  onboarding: ONBOARDING_VIEWS.complete,
  draft: null,
  prefill: { fields: {}, answers: {} },
  missingQuestions: [],
  missing: [],
  badges: [EMAIL, FACE],
  consent: { disclosureVersion: "events-profile-v2", text: "The hosts see your profile (name, role, company, bio, links, photo) with your request. Never your selfie.", checksToAccept: ["face"], eventConsentText: null },
  canSubmit: true,
  submitLabel: "Request to join",
  nextAction: "submit",
  availability: "open",
  registration: null,
};

const QUESTIONS: RequestContext["event"]["form"]["questions"] = [
  { id: Q_WHY, kind: "long", label: "What do you want to get out of the evening?", required: true },
  { id: Q_TRACK, kind: "single", label: "Which panel interests you most?", required: true, options: [{ id: O_RISK, label: "Fraud and risk" }, { id: O_PRODUCT, label: "Scaling product" }] },
  { id: Q_DIET, kind: "yes_no", label: "Any dietary requirements?", required: false },
];

export const REQUEST_CONTEXTS = {
  /** Everything done: one tap. */
  oneTap: base,
  /** The event asks two questions and a phone number; the profile covers the rest. */
  questions: { ...base, nextAction: "answers", canSubmit: false, missingQuestions: [Q_WHY, Q_TRACK, Q_DIET], event: { ...base.event, form: { ...base.event.form, fields: { phone_number: "required" }, questions: QUESTIONS, consent_text: "I agree to be photographed at the event." } }, consent: { ...base.consent, eventConsentText: "I agree to be photographed at the event." } },
  /** A legacy profile without a link. */
  profile: { ...base, nextAction: "profile", canSubmit: false, onboarding: { ...ONBOARDING_VIEWS.complete, step: "profile_required", profile: { ...MARIA_PROFILE, bio: "", links: [] }, missingProfileFields: ["links"] } },
  face: { ...base, nextAction: "face", canSubmit: false, onboarding: ONBOARDING_VIEWS.faceRequired, badges: [EMAIL] },
  faceExpired: { ...base, nextAction: "face", canSubmit: false, onboarding: ONBOARDING_VIEWS.faceExpired, badges: [EMAIL, { ...FACE, state: "expired" }] },
  /** This event requires phone and age 18+. */
  extras: { ...base, nextAction: "extras", canSubmit: false, event: { ...base.event, checks: { version: 1, required: ["phone"], age_min: 18, max_age: {} } }, missing: [{ check: "phone", reason: "absent" }, { check: "age", reason: "absent", minimum: 18 }], consent: { ...base.consent, checksToAccept: ["face", "phone", "age"], text: "Didit verifies your phone number and confirms you are 18 or older. The hosts only see that the checks passed." } },
  extrasBelowMinimum: { ...base, nextAction: "extras", canSubmit: false, missing: [{ check: "age", reason: "below_minimum", minimum: 21 }] },
  waitlist: { ...base, submitLabel: "Join waitlist" },
} satisfies Record<string, RequestContext>;

/** What POST …/request/submit returns for a request awaiting the hosts. */
export const PENDING_REGISTRATION: NonNullable<RequestContext["registration"]> = {
  id: "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d", eventId: base.event.id, slug: "ai-era", admission: "pending", readiness: "ready",
  policyVersion: 1, formVersion: 1, missing: [], badges: [EMAIL, FACE], nextExpiryAt: null, checkedInAt: null,
  withdrawal: { allowed: true, label: "Withdraw request", late: false, unavailableReason: null }, canReapply: false, waitlistPosition: null,
  rejoin: { kind: "pending", canRequest: false, outcome: null, rule: null, blockedBy: null },
};

/* ── v5 re-join: a registration on file, decided by the same core rule the server uses ───────────────────────── */

const OPEN_EVENT: RejoinFacts["event"] = { mode: "request", waitlist: true, full: false, requests: "open", invited: "open" };
export function rejoinFacts(f: Partial<Omit<RejoinFacts, "event">> & { event?: Partial<RejoinFacts["event"]> } = {}): RejoinFacts {
  return { admission: "cancelled_by_guest", cancelledFrom: "pending", reapplicationCount: 0, blocked: false, checkedIn: false, invite: null, ...f, event: { ...OPEN_EVENT, ...f.event } };
}
/** The registration view for a set of re-join facts. */
export function registrationWith(f: RejoinFacts, extra: Partial<GuestRegistrationView> = {}): GuestRegistrationView {
  const r = rejoin(f);
  const active = ["pending", "waitlisted", "approved"].includes(f.admission) && !f.checkedIn;
  return {
    ...PENDING_REGISTRATION, admission: f.admission, rejoin: r, canReapply: r.canRequest,
    withdrawal: { allowed: active, label: f.admission === "approved" ? "Cancel place" : "Withdraw request", late: false, unavailableReason: active ? null : "Cancellation is closed" },
    checkedInAt: f.checkedIn ? "2026-10-08T18:05:00+02:00" : null, waitlistPosition: f.admission === "waitlisted" ? 3 : null, ...extra,
  };
}
/** The request context the server returns for a registration on file (status, or a request again). */
export function rejoinContext(f: RejoinFacts, over: Partial<RequestContext> = {}): RequestContext {
  const registration = registrationWith(f);
  return { ...base, registration, canSubmit: registration.rejoin.canRequest, nextAction: registration.rejoin.canRequest ? "submit" : "status", submitLabel: f.event.full ? "Join waitlist" : "Request to join", ...over };
}

export const REJOIN_CONTEXTS = {
  withdrew: rejoinContext(rejoinFacts()),
  cancelled: rejoinContext(rejoinFacts({ cancelledFrom: "approved" })),
  invited: rejoinContext(rejoinFacts({ cancelledFrom: "approved", invite: { valid: true, skipApproval: true } })),
  inviteExpired: rejoinContext(rejoinFacts({ cancelledFrom: "approved", invite: { valid: false, skipApproval: true } })),
  rejected: rejoinContext(rejoinFacts({ admission: "rejected", cancelledFrom: null })),
  rejectedBlocked: rejoinContext(rejoinFacts({ admission: "rejected", cancelledFrom: null, blocked: true })),
  once: rejoinContext(rejoinFacts({ reapplicationCount: 1 })),
  waitlisted: rejoinContext(rejoinFacts({ admission: "waitlisted", cancelledFrom: null })),
  approved: rejoinContext(rejoinFacts({ admission: "approved", cancelledFrom: null })),
  checkedIn: rejoinContext(rejoinFacts({ admission: "approved", cancelledFrom: null, checkedIn: true })),
  hostCancelled: rejoinContext(rejoinFacts({ admission: "cancelled_by_host", cancelledFrom: null })),
  revoked: rejoinContext(rejoinFacts({ admission: "revoked", cancelledFrom: null })),
  fullWaitlist: rejoinContext(rejoinFacts({ cancelledFrom: "approved", event: { full: true } })),
  closed: rejoinContext(rejoinFacts({ event: { requests: "closed" } })),
  faceExpired: rejoinContext(rejoinFacts({ cancelledFrom: "approved" }), { nextAction: "face", canSubmit: false, onboarding: ONBOARDING_VIEWS.faceExpired, badges: [EMAIL, { ...FACE, state: "expired" }] }),
} satisfies Record<string, RequestContext>;

export function fixtureRequestApi(opts: { contexts?: RequestContext[]; launch?: VerificationLaunch; submit?: SubmitResult } = {}): RequestApi & { calls: string[]; bodies: unknown[]; pins: (string | undefined)[] } {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  /** The extras operation each refresh pinned. */
  const pins: (string | undefined)[] = [];
  const contexts = opts.contexts ?? [REQUEST_CONTEXTS.oneTap];
  let i = 0;
  return {
    calls,
    bodies,
    pins,
    async refresh(checksOp) {
      calls.push("refresh");
      pins.push(checksOp);
      return { ok: true, data: contexts[Math.min(i++, contexts.length - 1)]! };
    },
    async saveDraft(body) {
      calls.push("saveDraft");
      bodies.push(body);
      const c = contexts[0]!;
      return { ok: true, data: { ...c, draft: { id: "5c0c3f4e-2f7b-4f7e-9b1e-6d2c1a0b9f01", version: 1, expiresAt: "2026-10-30T10:00:00Z", application: body.application } } };
    },
    async startChecks(body) {
      calls.push("startChecks");
      bodies.push(body);
      return { ok: true, data: opts.launch ?? { state: "ready", opId: "op", url: "https://verify.didit.me/session/extras", expiresAt: "2026-10-01T10:00:00Z" } };
    },
    async submit(body) {
      calls.push("submit");
      bodies.push(body);
      return { ok: true, data: opts.submit ?? { replayed: false, redirectTo: "/me/events/ai-era?requested=1", registration: PENDING_REGISTRATION } };
    },
  };
}
