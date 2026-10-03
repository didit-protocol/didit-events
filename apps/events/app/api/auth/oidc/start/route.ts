import { consentSchema } from "@didit-events/core/domain/event-model";
import { COOKIE_NAMES,cookieAttributes,PolicyError,requestCookies } from "@didit-events/core/http/policy";
import { NextResponse } from "next/server";
import { safeNext } from "../../../../../src/accounts/links";
import { appOrigin,navigationPolicy } from "../../../../../src/auth/browser";
import { inAppBrowser } from "../../../../../src/auth/inapp";
import { routeError } from "../../../../../src/auth/route";
import { identity } from "../../../../../src/auth/runtime";
export async function GET(req: Request) {
  try {
    navigationPolicy(req, false, true);
    const url = new URL(req.url), as = url.searchParams.get("as") ?? "guest";
    if (as !== "staff" && as !== "guest") return new Response("Invalid sign-in type", { status: 400 });
    // Google refuses in-app browsers (X, LinkedIn, Instagram…): a stale or deep link lands on the sign-in guidance
    // instead. Its "Try Google anyway" link carries force=1.
    if (url.searchParams.get("force") !== "1" && inAppBrowser(req.headers.get("user-agent"))) {
      const back = new URL("/login", appOrigin()), next = safeNext(url.searchParams.get("next"), "");
      back.searchParams.set("error", "inapp");
      if (next) back.searchParams.set("next", next);
      const res = NextResponse.redirect(back, 302);
      res.headers.set("Cache-Control", "no-store"); res.headers.set("Referrer-Policy", "no-referrer");
      return res;
    }
    const rawConsent = url.searchParams.get("consent");
    if (rawConsent !== null && Buffer.byteLength(rawConsent, "utf8") > 2048) throw new PolicyError(413, "ConsentTooLarge");
    const consent = rawConsent !== null && req.headers.get("sec-fetch-site") === "same-origin"
      ? consentSchema.parse(JSON.parse(rawConsent)) : undefined;
    const result = await identity.auth.beginOidc(as, safeNext(url.searchParams.get("next"), as === "staff" ? "/admin" : "/me/events"), requestCookies(req).get(COOKIE_NAMES.session), consent);
    const res = NextResponse.redirect(result.url, 302);
    res.cookies.set(COOKIE_NAMES.oidc, result.cookie, cookieAttributes(COOKIE_NAMES.oidc, 300));
    res.headers.set("Cache-Control", "no-store"); res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  } catch (error) {
    // No OIDC client of its own: back to the sign-in screen, where email codes still work.
    if ((error as { code?: unknown } | null)?.code === "OidcClientNotConfigured") {
      console.info(JSON.stringify({ event: "auth.oidc_not_configured", hint: "set DIDIT_OIDC_CLIENT_ID and DIDIT_OIDC_CLIENT_SECRET" }));
      const back = new URL("/login", appOrigin());
      back.searchParams.set("error", "google_failed");
      const res = NextResponse.redirect(back, 302);
      res.headers.set("Cache-Control", "no-store"); res.headers.set("Referrer-Policy", "no-referrer");
      return res;
    }
    return routeError(error);
  }
}
