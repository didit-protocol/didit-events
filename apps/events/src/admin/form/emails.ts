/**
 * Emails section model: the event lifecycle templates as the admin lists them, and the client transport to lane A's
 * preview / test-send routes (docs/event-model-v2.md "Email preview and test-send API").
 *
 * STUB: `stubEmailTemplates` stands in for `EventEditorView.emails` until the editor loader returns it; titles and
 * triggers follow the v2 semantics (M-06 is the admission confirmation, M-03/M-05 are renewal notices).
 */
import { actionCsrf } from "../../auth/client";
import { CONTACT_EMAIL } from "../../config";
import type { ApiResult, EmailOverride, EmailPreview, EmailTemplateView, EmailTestResult, EventEmailCode, EventEmails } from "../model/contract";
import { EVENT_EMAIL_CODES, MANDATORY_EMAIL_CODES } from "../model/contract";

/** The configured events sender (the doc's values; the loader's EmailTemplateView replaces them at integration). */
export const STUB_SENDER = { from: "Didit Events <events@updates.didit.me>", replyTo: CONTACT_EMAIL };

export const EMAIL_META: Record<EventEmailCode, { title: string; trigger: string }> = {
  "M-02": { title: "Request received", trigger: "Guest sends a request" },
  "M-03": { title: "Renew a required check", trigger: "An accepted check expires before the event" },
  "M-05": { title: "Renewal reminder", trigger: "A renewal is still outstanding" },
  "M-06": { title: "You're in", trigger: "Guest is admitted (approval, open join or waitlist promotion)" },
  "M-07": { title: "Check in review", trigger: "A requested check needs manual review" },
  "M-08": { title: "Check declined · retry", trigger: "A requested check is declined" },
  "M-09": { title: "Waitlisted", trigger: "Host waitlists the guest, or the event is full" },
  "M-10": { title: "Not approved", trigger: "Host rejects the request" },
  "M-11": { title: "Reminder · tomorrow", trigger: "24 hours before the start" },
  "M-12": { title: "Reminder · doors in 1 hour", trigger: "1 hour before the start" },
  "M-13": { title: "Welcome at the door", trigger: "Guest is checked in" },
  "M-14": { title: "Thanks + recordings", trigger: "The day after, attended guests" },
  "M-15": { title: "Registration cancelled", trigger: "Guest cancels" },
  "M-16": { title: "Event update", trigger: "Date, time or venue changes" },
  "M-19": { title: "Invitation", trigger: "Staff invites someone" },
  "M-20": { title: "Cancellation confirmed", trigger: "Guest withdraws or cancels" },
  "M-21": { title: "Cancelled by the host", trigger: "Staff revokes a place or cancels the event" },
  "M-23": { title: "Place confirmed after review", trigger: "Staff confirms after a review" },
  "M-24": { title: "Check-in undone", trigger: "Staff undoes a check-in" },
};

export const isMandatory = (code: EventEmailCode) => MANDATORY_EMAIL_CODES.includes(code);

/** Template rows for the current (unsaved) overrides. */
export function stubEmailTemplates(emails: EventEmails): EmailTemplateView[] {
  return EVENT_EMAIL_CODES.map((code) => {
    const override = emails.templates[code] ?? null;
    return {
      code,
      ...EMAIL_META[code],
      enabled: override?.enabled !== false || isMandatory(code),
      canDisable: !isMandatory(code),
      canEdit: true,
      ...STUB_SENDER,
      override,
    };
  });
}

/** Set one template's override, dropping it when it equals the registry default (canonical value, no noise). */
export function setOverride(emails: EventEmails, code: EventEmailCode, next: EmailOverride): EventEmails {
  const clean: EmailOverride = { enabled: next.enabled };
  if (next.subject !== undefined) clean.subject = next.subject;
  if (next.body_md !== undefined && next.body_md !== "") clean.body_md = next.body_md;
  const templates = { ...emails.templates };
  if (clean.enabled && clean.subject === undefined && clean.body_md === undefined) delete templates[code];
  else templates[code] = clean;
  return { version: 1, templates };
}

/* ── Transport ─────────────────────────────────────────────────────────── */

export interface PreviewInput {
  template: EventEmailCode;
  preview: { kind: "sample" } | { kind: "guest"; registrationId: string };
  override?: EmailOverride;
  expectedEventVersion: number;
}
export interface TestInput extends PreviewInput {
  to: string;
  idempotencyKey: string;
}

/** `unavailable` = the route is not there yet (404/405) or the transport failed: the UI says so, never "sent". */
export type TransportResult<T> = ApiResult<T> | { ok: false; error: { code: "unavailable"; message: string } };

export interface EmailTransport {
  preview(eventId: string, input: PreviewInput): Promise<TransportResult<EmailPreview>>;
  sendTest(eventId: string, input: TestInput): Promise<TransportResult<EmailTestResult>>;
  testStatus(eventId: string, testId: string): Promise<TransportResult<EmailTestResult>>;
}

const UNAVAILABLE = { ok: false as const, error: { code: "unavailable" as const, message: "The email service isn’t connected yet." } };

async function call<T>(url: string, init?: RequestInit): Promise<TransportResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      credentials: "same-origin",
      headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json", "x-csrf": actionCsrf() } : {}) },
    });
  } catch {
    return { ok: false, error: { code: "unavailable", message: "Network error. Check your connection and try again." } };
  }
  if (res.status === 404 || res.status === 405) return UNAVAILABLE;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  if (body && typeof body === "object" && "ok" in body) {
    const r = body as ApiResult<T>;
    if (!r.ok && res.status === 429 && r.error.retryAfterMs === undefined) {
      const after = Number(res.headers.get("retry-after"));
      if (Number.isFinite(after)) r.error.retryAfterMs = after * 1000;
    }
    return r;
  }
  // 202 {testId,status} without the envelope is still a success.
  if (res.ok && body && typeof body === "object") return { ok: true, data: body as T };
  return { ok: false, error: { code: res.status === 429 ? "rate_limited" : res.status === 403 ? "forbidden" : res.status === 401 ? "unauthenticated" : "invalid", message: `Request failed (${res.status}).` } };
}

export const httpEmailTransport: EmailTransport = {
  preview: (eventId, input) => call(`/api/admin/events/${encodeURIComponent(eventId)}/emails/preview`, { method: "POST", body: JSON.stringify(input) }),
  sendTest: (eventId, input) => call(`/api/admin/events/${encodeURIComponent(eventId)}/emails/test`, { method: "POST", body: JSON.stringify(input) }),
  testStatus: (eventId, testId) => call(`/api/admin/events/${encodeURIComponent(eventId)}/emails/test/${encodeURIComponent(testId)}`),
};

/** A syntactically valid destination (any domain: tests may go to any address). */
export const isEmail = (s: string) => s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/** Renders a template with sample data (frames and tests only: real routes never load fixtures). */
export type SamplePreview = (code: EventEmailCode) => Promise<EmailPreview>;
