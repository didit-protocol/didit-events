import { identity } from "./runtime";
import { createHmac } from "node:crypto";
import { COOKIE_NAMES, browserMutation, PolicyError, requestCookies } from "@didit-events/core/http/policy";
import { equal, readToken } from "@didit-events/core/identity/shared";

export function csrfToken(binding: string, secret: string) { return createHmac("sha256", secret).update(`csrf\0${binding}`).digest("base64url"); }
export function appOrigin() {
  const value = process.env.APP_URL;
  if (!value) throw new PolicyError(503, "AppUrlRequired");
  return new URL(value).origin;
}
export function sessionSecret() { const secret = process.env.SESSION_SECRET; if (!secret || secret.length < 32) throw new PolicyError(503, "SessionSecretRequired"); return secret; }
export async function guardBrowser(req: Request, options: { anonymous?: boolean; maxBytes?: number; contentType?: string } = {}) {
  const proof = await browserMutation(req, { origins: [appOrigin()], allowAnonymous: options.anonymous, maxBytes: options.maxBytes, contentType: options.contentType });
  const jar = requestCookies(req), sid = jar.get(COOKIE_NAMES.session), anonymous = jar.get(COOKIE_NAMES.anonymous), secret = sessionSecret();
  const binding = sid && readToken(sid, secret, "session") ? sid : options.anonymous && anonymous && readToken(anonymous, secret, "anonymous") ? anonymous : null;
  if (!binding || (!equal(csrfToken(binding, secret), jar.get(COOKIE_NAMES.csrf) ?? "") && !(sid && await identity.sessions.validCsrf(sid, jar.get(COOKIE_NAMES.csrf) ?? "")))) throw new PolicyError(403, "InvalidBrowserBinding");
  return { ...proof, sessionCookie: sid ?? "" };
}
/** GET bootstrap and OIDC redirect are explicit C14 exceptions, never mutations with relaxed CSRF. */
export function navigationPolicy(req: Request, callback = false, externalStart = false) {
  if (req.method !== "GET" || req.headers.has("authorization") || req.headers.has("x-signature") || req.headers.has("x-signature-v2")) throw new PolicyError(403, "BrowserNavigationRequired");
  if (externalStart && (req.headers.get("sec-fetch-mode") !== "navigate" || req.headers.get("sec-fetch-dest") !== "document")) throw new PolicyError(403, "BrowserNavigationRequired");
  if (!callback && !externalStart && ((req.headers.has("origin") && req.headers.get("origin") !== appOrigin()) || req.headers.get("sec-fetch-site") === "cross-site")) throw new PolicyError(403, "SameOriginNavigationRequired");
  requestCookies(req);
}
