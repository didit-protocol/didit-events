import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { doorService, PinAttemptsExceeded } from "@didit-events/core/door/service";
import type { DoorIdentity } from "@didit-events/core";
import { BODY_LIMITS, bodyLimit, COOKIE_NAMES, cookieAttributes, PolicyError, requestCookies } from "@didit-events/core/http/policy";
import { IdentityError } from "@didit-events/core/identity";
import { equal, readToken, signToken } from "@didit-events/core/identity/shared";
import { log } from "@didit-events/core/log";
import { appOrigin, csrfToken, sessionSecret } from "../auth/browser";
import { identity } from "../auth/runtime";

/** The door cookie lives for the door session (one evening); it authenticates /api/door/{event}/* and nothing else. */
export const DOOR_COOKIE_SECONDS = 16 * 3600;
export const doorCookie = (token: string) => signToken(token, sessionSecret(), "door");

/** The deployed build, inlined at build time (next.config). A door page from an older build is told to reload. */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

/**
 * Authenticates a door request: browser only, same origin, the door cookie and a CSRF header bound to it (or to the
 * admin session that just signed in again). The door session's starter keeps `door.operate` on this event, checked
 * on every call (`resolveSession`). Mutations also bound their body.
 */
export async function doorRequest(req: Request, eventIdOrSlug: string, options: { mutation?: { maxBytes: number; contentType: string } } = {}): Promise<{ door: DoorIdentity; body: Uint8Array }> {
  if (["authorization", "x-signature", "x-signature-v2"].some(h => req.headers.has(h))) throw new PolicyError(403, "BrowserCallerRequired");
  const origin = req.headers.get("origin");
  if (options.mutation ? origin !== appOrigin() : origin !== null && origin !== appOrigin()) throw new PolicyError(403, "BrowserOriginRequired");
  if (req.headers.get("sec-fetch-site") === "cross-site") throw new PolicyError(403, "BrowserOriginRequired");
  const jar = requestCookies(req), secret = sessionSecret();
  const cookie = jar.get(COOKIE_NAMES.door), token = cookie ? readToken(cookie, secret, "door") : null;
  if (!cookie || !token) throw new PolicyError(401, "DoorSessionEnded");
  const csrf = jar.get(COOKIE_NAMES.csrf) ?? "", header = req.headers.get("x-csrf") ?? "";
  const sid = jar.get(COOKIE_NAMES.session);
  // The door token is an HMAC of the door cookie (the page hands it to the door script), so it is checked against the
  // header directly: another page opened in this browser re-binds the shared __Host-csrf cookie, and that must not
  // break the door's next scan. The admin-session binding keeps the double-submit cookie check.
  const bound = header.length > 0 && (equal(csrfToken(cookie, secret), header) ||
    (equal(csrf, header) && !!sid && (equal(csrfToken(sid, secret), csrf) || await identity.sessions.validCsrf(sid, csrf))));
  if (!bound) throw new PolicyError(403, "CsrfRequired");
  const door = await doorService.resolveSession(token, eventIdOrSlug);
  const body = options.mutation ? await bodyLimit(req, options.mutation.maxBytes, options.mutation.contentType) : new Uint8Array();
  return { door, body };
}

/**
 * The door session of a page request: this browser's door cookie, live and for this event (`resolveSession`, so the
 * starter still holds door.operate). The kiosk page renders on it alone; the Door tab uses it to say that door mode
 * runs on this device. `ended` is why a presented cookie no longer opens the door (absent when there is no cookie).
 */
export async function doorPageSession(eventIdOrSlug: string): Promise<{ door: DoorIdentity; cookie: string } | { door: null; ended?: string }> {
  const cookie = (await cookies()).get(COOKIE_NAMES.door)?.value, token = cookie ? readToken(cookie, sessionSecret(), "door") : null;
  if (!cookie || !token) return { door: null };
  try { return { door: await doorService.resolveSession(token, eventIdOrSlug), cookie }; }
  catch (error) { if (error instanceof PolicyError) return { door: null, ended: error.message }; throw error; }
}

export const doorJson = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers } });

/**
 * Every door failure is a status and a stable code the door screen words (no stack, no provider detail). Unexpected
 * failures get a request id, logged with the route, and shown on the door so staff can quote it.
 */
export function doorError(error: unknown, route: string, eventId?: string): Response {
  if (error instanceof PolicyError || error instanceof IdentityError) {
    const status = error.status, code = error instanceof PolicyError ? error.message : error.code;
    if (status >= 500) log("door.request_failed", { route, eventId, status, code });
    return doorJson({ error: code }, status, error instanceof PinAttemptsExceeded ? { "retry-after": String(error.retryAfter) } : {});
  }
  const requestId = randomUUID().slice(0, 8);
  log("door.request_failed", { route, eventId, status: 503, requestId, error });
  return doorJson({ error: "ServiceUnavailable", requestId }, 503, { "x-request-id": requestId });
}

/** Cookie headers for a browser entering door mode: the door cookie, its CSRF token, and the admin session cleared. */
export function enterDoorCookies(response: Response, token: string): Response {
  const cookie = doorCookie(token), secret = sessionSecret();
  const set = (name: (typeof COOKIE_NAMES)[keyof typeof COOKIE_NAMES], value: string, maxAge: number) => {
    const a = cookieAttributes(name, maxAge);
    response.headers.append("set-cookie", `${name}=${encodeURIComponent(value)}; Path=${a.path}; Max-Age=${maxAge}; SameSite=Lax; Secure${a.httpOnly ? "; HttpOnly" : ""}`);
  };
  set(COOKIE_NAMES.door, cookie, DOOR_COOKIE_SECONDS);
  set(COOKIE_NAMES.csrf, csrfToken(cookie, secret), DOOR_COOKIE_SECONDS);
  set(COOKIE_NAMES.session, "", 0);
  return response;
}
/** Cookie headers for a browser leaving door mode. */
export function leaveDoorCookies(response: Response): Response {
  response.headers.append("set-cookie", `${COOKIE_NAMES.door}=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly`);
  return response;
}
export { BODY_LIMITS };
