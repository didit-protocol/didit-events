import { SESSION_TTL_SECONDS } from "@didit-events/core/identity/shared";
import { cookies, headers } from "next/headers";
import { COOKIE_NAMES, cookieAttributes, PolicyError } from "@didit-events/core/http/policy";
import { identity } from "./runtime";
import { appOrigin, csrfToken, guardBrowser, sessionSecret } from "./browser";
import { sourceIpFromHeaders } from "./source-ip";
import { randomToken, signToken } from "@didit-events/core/identity/shared";

export async function guardAction(form: FormData, options: { anonymous?: boolean; maxBytes?: number } = {}) {
  const h = new Headers(await headers());
  // Next's action protocol has no caller-controlled x-csrf header; adapt the submitted hidden field.
  const submitted = form.get("csrf");
  if (typeof submitted !== "string") throw new PolicyError(403, "CsrfRequired");
  h.set("x-csrf", submitted);
  h.delete("content-length"); h.delete("content-type");
  const maxBytes = options.maxBytes ?? 64 * 1024;
  // Authenticate before reporting input errors, including oversized uploads.
  const proof = await guardBrowser(new Request(appOrigin(), { method: "POST", headers: h, body: "" }), { anonymous: options.anonymous, maxBytes });
  let bytes = 0;
  for (const [key, value] of form) {
    bytes += Buffer.byteLength(key) + (typeof value === "string" ? Buffer.byteLength(value) : value.size);
    if (bytes > maxBytes) throw new PolicyError(413, "BodyTooLarge");
  }
  // Bound before encoding; use a fixed byte body so cancelling an oversized multipart
  // stream cannot race Node's FormData producer (undici enqueue-after-close).
  const encoded = new Response(form), body = new Uint8Array(await encoded.arrayBuffer());
  if (body.byteLength > maxBytes) throw new PolicyError(413, "BodyTooLarge");
  return proof;
}
export function isBodyTooLarge(error: unknown): boolean { return error instanceof PolicyError && error.status === 413 && error.message === "BodyTooLarge"; }
export async function requireGuest(maxAge?: number) { return identity.auth.requireGuest((await cookies()).get(COOKIE_NAMES.session)?.value ?? "", maxAge); }
export async function requireStaff(roles?: readonly ("owner" | "admin" | "staff")[]) { return identity.auth.requireStaff((await cookies()).get(COOKIE_NAMES.session)?.value ?? "", roles); }
export async function setSession(cookie: string) {
  const jar = await cookies();
  jar.set(COOKIE_NAMES.session, cookie, cookieAttributes(COOKIE_NAMES.session, SESSION_TTL_SECONDS));
  jar.set(COOKIE_NAMES.csrf, csrfToken(cookie, sessionSecret()), cookieAttributes(COOKIE_NAMES.csrf, SESSION_TTL_SECONDS));
  jar.set(COOKIE_NAMES.anonymous, "", cookieAttributes(COOKIE_NAMES.anonymous, 0));
}
export async function clearSession() {
  const jar = await cookies(), secret = sessionSecret();
  const anonymous = signToken(randomToken(), secret, "anonymous");
  for (const name of [COOKIE_NAMES.session, COOKIE_NAMES.otp, COOKIE_NAMES.oidc]) jar.set(name, "", cookieAttributes(name, 0));
  // The action response must already support the next anonymous form, before any GET/proxy runs.
  jar.set(COOKIE_NAMES.anonymous, anonymous, cookieAttributes(COOKIE_NAMES.anonymous, 3600));
  jar.set(COOKIE_NAMES.csrf, csrfToken(anonymous, secret), cookieAttributes(COOKIE_NAMES.csrf, 3600));
}
export async function sourceIp() { return sourceIpFromHeaders(new Headers(await headers())); }
