import { COOKIE_NAMES,cookieAttributes,requestCookies } from "@didit-events/core/http/policy";
import { SESSION_TTL_SECONDS } from "@didit-events/core/identity/shared";
import { NextResponse } from "next/server";
import { afterSignIn,safeNext } from "../../../../../src/accounts/links";
import { appOrigin,csrfToken,navigationPolicy,sessionSecret } from "../../../../../src/auth/browser";
import { routeError } from "../../../../../src/auth/route";
import { identity } from "../../../../../src/auth/runtime";
export async function GET(req: Request) {
  let response: Response;
  let failureLogged = false;
  try {
    navigationPolicy(req, true);
    const result = await identity.auth.finishOidc(req.url, requestCookies(req).get(COOKIE_NAMES.oidc) ?? "").catch(error => { failureLogged = true; throw error; });
    const next=safeNext(result.next);
    const res = NextResponse.redirect(new URL(afterSignIn(next,result.onboarding.step),appOrigin()));
    res.cookies.set(COOKIE_NAMES.session, result.cookie, cookieAttributes(COOKIE_NAMES.session, SESSION_TTL_SECONDS));
    res.cookies.set(COOKIE_NAMES.csrf, csrfToken(result.cookie, sessionSecret()), cookieAttributes(COOKIE_NAMES.csrf, SESSION_TTL_SECONDS));
    response = res;
  } catch (error) {
    // Core logs authentication failures. Cover route-policy/response failures
    // here as well, without duplicating that event or retaining request details.
    if (!failureLogged) console.info(JSON.stringify({ event: "auth.oidc_callback_failed", reason: "callback_failed" }));
    const e = error as { code?: unknown; next?: unknown; cancelled?: unknown } | null;
    if (e && typeof e === "object" && (e.code === "OidcCancelled" || e.code === "InvalidOidcState" || e.code === "InvalidOidcCode" || e.code === "OidcUserinfoFailed" || e.code === "InvalidIdToken" || e.code === "InvalidAccessToken")) {
      // Back to our own sign-in screen with a calm notice (cancelled vs failed), keeping the page they came from.
      const back = new URL("/login", appOrigin());
      back.searchParams.set("error", e.code === "OidcCancelled" && e.cancelled === true ? "google_cancelled" : "google_failed");
      const next = typeof e.next === "string" ? safeNext(e.next) : null;
      if (next && next !== "/") back.searchParams.set("next", next);
      response = NextResponse.redirect(back);
    } else response = routeError(error);
  }
  response.headers.append("Set-Cookie", `${COOKIE_NAMES.oidc}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  response.headers.set("Referrer-Policy", "no-referrer"); response.headers.set("Cache-Control", "no-store");
  return response;
}
