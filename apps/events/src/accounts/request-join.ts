/**
 * Request to join (event model v2, "Request-time flow"): a signed-in guest never signs in or verifies their email
 * again. The screen asks only for what is missing — profile fields, unanswered event questions, the event's extras
 * (phone / ID / age) — and then it is one tap. `RequestContext` from lane A decides `nextAction`; this module
 * turns it into the step to show, validates answers like `validateApplication`, and builds the submit body.
 */
import type {
  ApiResult,
  Application,
  ConsentInput,
  EventForm,
  MissingCheck,
  MissingReason,
  ProofCheck,
  RequestContext,
  SubmitResult,
  VerificationLaunch,
} from "@didit-events/core/contracts/event-model";
import { apiCall as call } from "./api-client";
import { codePoints, normalizeUrl } from "./onboarding";

export type { RequestContext, SubmitResult };
export type Question = EventForm["questions"][number];
export type Answer = Application["answers"][string];

export type RequestStep = "profile" | "face" | "extras" | "form" | "status" | "unavailable";

/** One screen per `nextAction`; answers and the final tap share the form screen (one tap when nothing is missing). */
export function requestStep(ctx: RequestContext): RequestStep {
  switch (ctx.nextAction) {
    case "profile":
      return "profile";
    case "face":
      return "face";
    case "extras":
      return "extras";
    case "answers":
    case "submit":
      return "form";
    case "status":
      return "status";
    case "unavailable":
      return "unavailable";
  }
}

/**
 * Questions still to answer: the required ones the server lists and the optional ones with no answer yet, so an
 * optional question is offered once (prefilled/draft answers are not asked again).
 */
export function questionsToAsk(ctx: RequestContext): Question[] {
  const missing = new Set(ctx.missingQuestions);
  return ctx.event.form.questions.filter((q) => missing.has(q.id) || (!q.required && ctx.prefill.answers[q.id] === undefined));
}

/** The phone contact field shows only when the event collects it and it is not already filled. */
export const askPhone = (ctx: RequestContext) => ctx.event.form.fields.phone_number !== "off" && !ctx.prefill.fields.phone_number;

export const EXTRA_LABELS: Record<ProofCheck, string> = {
  face: "Face check",
  phone: "Phone number",
  id_document: "ID document",
  name_from_id: "Name from your ID",
  age: "Age",
};

export function extraLabel(m: Pick<MissingCheck, "check" | "minimum">): string {
  return m.check === "age" && m.minimum ? `Age ${m.minimum}+` : EXTRA_LABELS[m.check];
}

/** What the guest does for each extra, in one line. */
export const EXTRA_HINTS: Record<ProofCheck, string> = {
  face: "A quick selfie with Didit",
  phone: "Didit texts you a code",
  id_document: "Photo of your ID and a selfie that matches it",
  name_from_id: "Didit reads the name on your ID; it must match your profile name",
  age: "Didit confirms your age from your ID or a selfie estimate",
};

export function reasonCopy(reason: MissingReason): string {
  switch (reason) {
    case "absent":
      return "Needed for this event";
    case "expired":
      return "Expired, verify again";
    case "revoked":
      return "No longer valid, verify again";
    case "in_review":
      return "Being reviewed by Didit";
    case "continuity_required":
      return "Didit is confirming it is still you";
    case "below_minimum":
      return "Below this event's minimum age";
    case "name_mismatch":
      return "Your profile name does not match your ID";
    case "provider_unavailable":
      return "Not available right now";
  }
}

/** A missing extra the guest cannot fix by starting a check (review pending, below minimum, a name to fix on the profile, …). */
export const blocksLaunch = (m: MissingCheck) => m.reason === "in_review" || m.reason === "continuity_required" || m.reason === "below_minimum" || m.reason === "provider_unavailable" || m.reason === "name_mismatch";

/* ── Answers (mirrors validateApplication) ─────────────────────────────────────────────────────────────────── */

export type AnswerErrors = Record<string, string>;
const E164 = /^\+[1-9][0-9]{6,14}$/;

/** "+34 600 11 22 33" → "+34600112233"; null when it cannot be a full international number. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.trim().replace(/[\s().-]/g, "");
  const v = digits.startsWith("00") ? `+${digits.slice(2)}` : digits;
  return E164.test(v) ? v : null;
}

const blank = (a: Answer | undefined) => a === undefined || (typeof a === "string" && !a.trim()) || (Array.isArray(a) && a.length === 0);

export function validateAnswers(questions: Question[], answers: Record<string, Answer | undefined>, phone: { mode: "off" | "optional" | "required"; value: string; asked: boolean }): AnswerErrors {
  const errors: AnswerErrors = {};
  for (const q of questions) {
    const a = answers[q.id];
    if (blank(a)) {
      if (q.required) errors[q.id] = q.kind === "yes_no" ? "Choose yes or no" : q.kind === "single" || q.kind === "multi" ? "Choose an option" : "Answer this question";
      continue;
    }
    switch (q.kind) {
      case "short":
        if (typeof a !== "string" || codePoints(a.trim()) > 300) errors[q.id] = "Keep it under 300 characters";
        break;
      case "long":
        if (typeof a !== "string" || codePoints(a) > 2000) errors[q.id] = "Keep it under 2000 characters";
        break;
      case "url":
        if (typeof a !== "string" || !normalizeUrl(a)) errors[q.id] = "Enter a link starting with https://";
        break;
      case "yes_no":
        if (typeof a !== "boolean") errors[q.id] = "Choose yes or no";
        break;
      case "single":
        if (typeof a !== "string" || !q.options.some((o) => o.id === a)) errors[q.id] = "Choose an option";
        break;
      case "multi":
        if (!Array.isArray(a) || new Set(a).size !== a.length || !a.every((id) => q.options.some((o) => o.id === id))) errors[q.id] = "Choose from the list";
        break;
    }
  }
  if (phone.asked) {
    if (!phone.value.trim()) {
      if (phone.mode === "required") errors.phone_number = "Add your phone number";
    } else if (!normalizePhone(phone.value)) errors.phone_number = "Use the international format, for example +34 600 112 233";
  }
  return errors;
}

/** The application to save/submit: prefill (draft/earlier answers) + what was typed now, blanks omitted. */
export function buildApplication(ctx: RequestContext, answers: Record<string, Answer | undefined>, phone: string): Application {
  const out: Application = { fields: { ...ctx.prefill.fields }, answers: { ...ctx.prefill.answers } };
  for (const q of ctx.event.form.questions) {
    const a = answers[q.id];
    if (a === undefined) continue;
    if (blank(a)) {
      delete out.answers[q.id];
      continue;
    }
    out.answers[q.id] = q.kind === "url" && typeof a === "string" ? (normalizeUrl(a) ?? a) : typeof a === "string" && q.kind === "short" ? a.trim() : a;
  }
  const p = normalizePhone(phone);
  if (askPhone(ctx) && p) out.fields.phone_number = p;
  return out;
}

/** The consent sent with extras and the submission (checks the guest accepts are exactly what the server lists). */
export function requestConsent(ctx: RequestContext, eventConsent: boolean): ConsentInput {
  return { disclosureVersion: "events-profile-v2", shareProfileWithHosts: true, eventConsentAccepted: ctx.consent.eventConsentText ? eventConsent : false, acceptedChecks: [...ctx.consent.checksToAccept] };
}

/** Where a successful submission lands (same-origin only). */
export { safeNext } from "./links";

/* ── Transport (lane A routes; x-csrf on writes) ───────────────────────────────────────────────────────────── */

export interface RequestApi {
  /** `checksOp`: the extras operation this tab launched, so the context reports that one's outcome. */
  refresh(checksOp?: string): Promise<ApiResult<RequestContext>>;
  saveDraft(body: { expectedVersion: number; policyVersion: number; formVersion: number; application: Application; consent: ConsentInput }): Promise<ApiResult<RequestContext>>;
  startChecks(body: { draftId: string; expectedPolicyVersion: number; consent: ConsentInput }): Promise<ApiResult<VerificationLaunch>>;
  submit(body: {
    draftId?: string;
    expectedPolicyVersion: number;
    expectedFormVersion: number;
    profileVersion: number;
    application: Application;
    consent: ConsentInput;
    joinWaitlist: boolean;
    idempotencyKey: string;
  }): Promise<ApiResult<SubmitResult>>;
}

export function httpRequestApi(eventId: string, csrf: () => string): RequestApi {
  const base = `/api/events/${encodeURIComponent(eventId)}/request`;
  return {
    refresh: (checksOp) => call(checksOp ? `${base}?checksOp=${encodeURIComponent(checksOp)}` : base, { method: "GET" }, csrf),
    saveDraft: (body) => call(base, { method: "PUT", body: JSON.stringify(body) }, csrf),
    startChecks: (body) => call(`${base}/checks`, { method: "POST", body: JSON.stringify(body) }, csrf),
    submit: (body) => call(`${base}/submit`, { method: "POST", body: JSON.stringify(body) }, csrf),
  };
}
