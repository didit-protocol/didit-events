import { PermanentOutboxError, QuotaOutboxError, RetryableOutboxError } from "../outbox.ts";

export const RESEND_API_URL = "https://api.resend.com";
/** The verified Resend domain. Template senders keep their display name; the address is always on this domain. */
export const DEFAULT_EMAIL_FROM = "Didit Events <events@updates.didit.me>";
/** Replies (e.g. M-21 "reply to this email") go to the team mailbox, not the sending-only domain. */
export { DEFAULT_CONTACT_EMAIL as DEFAULT_REPLY_TO } from "../contact-email.ts";
/** The old shared team mailbox (never a real inbox): host notices never address it. */
export const LEGACY_TEAM_MAILBOX = "events@didit.me";

export interface ResendConfig { apiKey: string; apiUrl?: string; fetch?: typeof fetch }
export interface ResendEmail { from: string; to: string[]; cc?: string[]; reply_to?: string; subject: string; html: string; text: string; headers?: Record<string, string>; tags?: { name: string; value: string }[]; attachments?: ResendAttachment[] }
/** Base64 `content`. With `content_id` the file is inline: the HTML shows it through `<img src="cid:<content_id>">`. */
export interface ResendAttachment { filename: string; content: string; content_type?: string; content_id?: string }

/** Seconds from a Retry-After header (delta seconds or HTTP date); undefined when absent or unusable. */
export function retryAfterSec(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  if (/^\d+$/.test(header.trim())) return Number(header.trim());
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : undefined;
}

/**
 * A 429 is either the per-second rate limit or the team's sending quota (daily/monthly). Only the JSON error tells
 * them apart: `name` daily_quota_exceeded / monthly_quota_exceeded, or a message that mentions the quota.
 */
async function quotaRefusal(response: Response): Promise<boolean> {
  try {
    const body = JSON.parse(await response.text()) as { name?: unknown; message?: unknown } | null;
    return /^(daily|monthly)_quota_exceeded$/.test(String(body?.name ?? "")) || (typeof body?.message === "string" && /quota/i.test(body.message));
  } catch { return false; }
}

/**
 * POST /emails with Idempotency-Key = the outbox dedupe key. Classification:
 * 2xx → provider id; 429 for a spent quota → QuotaOutboxError (deferred, not an attempt); any other 429, 409
 * (concurrent idempotent request), 5xx and network errors → retryable; any other 4xx → permanent, with only the
 * status stored. Response bodies never leave this function.
 */
export async function sendResendEmail(config: ResendConfig, email: ResendEmail, idempotencyKey: string, signal?: AbortSignal): Promise<{ providerId: string }> {
  if (!idempotencyKey || idempotencyKey.length > 256) throw new PermanentOutboxError("invalid_idempotency_key");
  let response: Response;
  try {
    response = await (config.fetch ?? fetch)(`${(config.apiUrl ?? RESEND_API_URL).replace(/\/$/, "")}/emails`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(email),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    });
  } catch { throw new RetryableOutboxError("resend_network"); }
  if (response.ok) {
    let id: unknown;
    try { id = ((await response.json()) as { id?: unknown }).id; } catch { throw new RetryableOutboxError("resend_bad_response"); }
    if (typeof id !== "string" || !id) throw new RetryableOutboxError("resend_bad_response");
    return { providerId: id };
  }
  const status = response.status, retryAfter = retryAfterSec(response.headers.get("retry-after"));
  if (status === 429 && await quotaRefusal(response)) throw new QuotaOutboxError(retryAfter);
  await response.body?.cancel().catch(() => undefined);
  if (status === 429 || status === 409 || status >= 500) throw new RetryableOutboxError(`resend_${status}`, retryAfter);
  throw new PermanentOutboxError(`resend_${status}`);
}
