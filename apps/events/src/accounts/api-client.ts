/**
 * The JSON transport of the guest screens to lane A's routes: same-origin cookies, no-store, and the session's
 * double-submit CSRF token in `x-csrf` on every write. Always resolves to an `ApiResult` (offline and non-JSON
 * error pages become a typed, recoverable error instead of a thrown exception).
 *
 * The status decides: a 2xx must carry `{ ok: true, data }`; anything else is an error, passed through only when it
 * is a contract error (`{ ok: false, error: { code, message } }` with a known code), otherwise mapped from the status.
 * A body that does not match the contract never reaches a screen.
 */
import type { ApiErrorCode, ApiResult } from "@didit-events/core/contracts/event-model";

const CODES: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>([
  "unauthenticated", "forbidden", "not_found", "invalid", "context_changed", "idempotency_conflict", "checks_required", "onboarding_required",
  "capacity", "closed", "invite_required", "invite_invalid", "rate_limited", "provider_unavailable", "budget", "review_required", "retained_data_expired",
]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function contractError<T>(body: unknown): ApiResult<T> | null {
  if (!isObject(body) || body.ok !== false || !isObject(body.error)) return null;
  const { code, message } = body.error;
  if (typeof code !== "string" || !CODES.has(code as ApiErrorCode) || typeof message !== "string") return null;
  return body as ApiResult<T>;
}

const COPY: Partial<Record<ApiErrorCode, string>> = {
  unauthenticated: "Your session ended. Sign in again to continue.",
  forbidden: "This account can't do that. Sign in with the right account and try again.",
  not_found: "We couldn't find this event or request. Refresh the page and try again.",
  closed: "Requests for this event are closed.",
  invite_required: "This event is by invitation only.",
  invite_invalid: "This invitation is no longer valid. Ask the hosts for a new one.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  onboarding_required: "Finish your profile and face check first.",
  idempotency_conflict: "This request changed while it was being sent. Try again.",
  retained_data_expired: "Your earlier check has expired. Start a new one.",
};
/** Copy for an error: the server's sentence, or (when the server sent only its code) a sentence for that code. */
export const errorCopy = (error: { code: ApiErrorCode; message: string }): string =>
  error.message && error.message !== error.code ? error.message : (COPY[error.code] ?? "Something went wrong on our side. Try again in a moment.");

function statusError<T>(status: number): ApiResult<T> {
  const code: ApiErrorCode = status === 401 ? "unauthenticated" : status === 403 ? "forbidden" : status === 404 ? "not_found" : status === 429 ? "rate_limited" : "provider_unavailable";
  return { ok: false, error: { code, message: "Something went wrong. Try again in a moment." } };
}

export async function apiCall<T>(url: string, init: RequestInit, csrf: () => string): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.method && init.method !== "GET" ? { "x-csrf": csrf() } : {}) },
    });
  } catch {
    return { ok: false, error: { code: "provider_unavailable", message: "You seem to be offline. Check your connection and try again." } };
  }
  // This transport runs outside React; load the server-bound re-proof form with its new HttpOnly intent cookie.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  if (res.headers.get("x-account-reproof") === "/me/reauth" && typeof window !== "undefined") window.location.assign("/me/reauth");
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    /* a non-JSON page (proxy error, HTML 500): mapped from the status below */
  }
  if (res.ok) {
    if (isObject(body) && body.ok === true && "data" in body) return { ok: true, data: body.data as T };
    // A 2xx without the success envelope is not a success the screens can trust.
    return statusError(500);
  }
  return contractError<T>(body) ?? statusError(res.status);
}
