import { type NextRequest, NextResponse } from "next/server";
import { COOKIE_NAMES, cookieAttributes } from "@didit-events/core/http/policy";
import { randomToken, readToken, SESSION_TTL_SECONDS, signToken } from "@didit-events/core/identity/shared";
import { csrfToken, sessionSecret } from "./src/auth/browser";
import { IdentityError } from "@didit-events/core/identity";
import { adminViewer } from "@didit-events/core/access/principal";
import { identity } from "./src/auth/runtime";
import { joinHref, joinSlug } from "./src/accounts/links";
import { CSP_REPORT_ONLY_HEADER, cspNonce, reportOnlyCsp, servesDocument } from "./src/system/security-headers";

/** The door (kiosk mode) and its API: the only places the door-session cookie is read. */
export const DOOR_PATH = /^\/(?:admin\/events\/[^/]+\/door(?:\/|$)|api\/door\/)/;

/** The Door tab of an event (the admin page with the launcher), without its trailing slash. */
const DOOR_TAB = /^\/admin\/events\/[^/]+\/door(?=\/?$)/;

/**
 * Documents carry the full CSP, report-only, with a fresh nonce: set on the request so Next.js stamps its scripts with
 * it, and on the response for the browser. The enforced headers come from next.config.ts.
 */
export async function proxy(request: NextRequest) {
  const csp = servesDocument(request.nextUrl.pathname)
    ? reportOnlyCsp(cspNonce(), { production: process.env.NODE_ENV === "production", sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN, emailAssetsUrl: process.env.EMAIL_ASSETS_URL, appUrl: process.env.APP_URL })
    : null;
  if (csp) request.headers.set(CSP_REPORT_ONLY_HEADER, csp);
  const response = await session(request);
  if (csp) response.headers.set(CSP_REPORT_ONLY_HEADER, csp);
  return response;
}

async function session(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // The onboarding deep link that targets an event's join modal is a real HTTP redirect here: the page has a loading
  // boundary, so its own redirect() would stream as a 200 with a client-side redirect (a skeleton flash, and no JS no move).
  let redirectTo = path === "/onboarding" && request.method === "GET" ? onboardingRedirect(request.nextUrl.searchParams) : undefined;
  const next = () => redirectTo ? NextResponse.redirect(new URL(redirectTo, request.url)) : NextResponse.next({ request: { headers: request.headers } });
  if (path.startsWith("/api/auth/") || path.startsWith("/_frames") || !process.env.SESSION_SECRET) return next();
  // Actions own mutation cookies; guards resolve the presented token, including during rotation grace.
  if (request.method !== "GET" && request.method !== "HEAD") return next();
  const secret = sessionSecret(), sid = request.cookies.get(COOKIE_NAMES.session)?.value;
  // Door mode: a browser locked to one event's door carries a door cookie and no admin session. On the door paths its
  // CSRF token is bound to the door cookie; every other page treats the browser as signed out. Once someone signs in
  // again (to exit door mode or restart it), their session takes over as usual.
  const door = request.cookies.get(COOKIE_NAMES.door)?.value;
  if (door && readToken(door, secret, "door") && DOOR_PATH.test(path) && !(sid && readToken(sid, secret, "session"))) {
    // The Door tab is an admin page; the kiosk is one level down. A door device that asks for the tab (a door opened
    // before the kiosk had its own URL reloading, a bookmark) stays a kiosk; if its session is over, the kiosk page
    // sends it through the sign-in to the tab.
    const tab = DOOR_TAB.exec(path);
    if (tab) return NextResponse.redirect(new URL(`${tab[0]}/kiosk`, request.url));
    const csrf = csrfToken(door, secret);
    request.cookies.set(COOKIE_NAMES.csrf, csrf);
    const response = next();
    response.cookies.set(COOKIE_NAMES.csrf, csrf, cookieAttributes(COOKIE_NAMES.csrf, 16 * 3600));
    return response;
  }
  const refreshed = sid && readToken(sid, secret, "session") ? await identity.sessions.refresh(sid) : null;
  if (request.method === "GET" && /^\/admin(?:\/|$)/.test(path) && path !== "/admin/login") {
    const target = encodeURIComponent(path + request.nextUrl.search);
    if (!refreshed) redirectTo = `/login?next=${target}`;
    else if (path !== "/admin/forbidden") {
      // Staff, or an account on at least one event team; each page then checks its own capability.
      try { await adminViewer(refreshed.cookie ?? sid!, { identity }); }
      catch (error) {
        if (!(error instanceof IdentityError) || ![401, 403].includes(error.status)) throw error;
        redirectTo = error.status === 403 ? `/admin/forbidden?next=${target}` : `/login?next=${target}`;
      }
    }
  }
  if (refreshed) {
    if (refreshed.cookie) request.cookies.set(COOKIE_NAMES.session, refreshed.cookie);
    request.cookies.set(COOKIE_NAMES.csrf, refreshed.csrfToken);
    const response = next();
    if (refreshed.cookie) {
      response.cookies.set(COOKIE_NAMES.session, refreshed.cookie, cookieAttributes(COOKIE_NAMES.session, SESSION_TTL_SECONDS));
      response.cookies.set(COOKIE_NAMES.csrf, refreshed.csrfToken, cookieAttributes(COOKIE_NAMES.csrf, SESSION_TTL_SECONDS));
    }
    return response;
  }
  if (request.method !== "GET" || path.startsWith("/api/")) return next();
  const anon = request.cookies.get(COOKIE_NAMES.anonymous)?.value;
  const binding = anon && readToken(anon, secret, "anonymous") ? anon : signToken(randomToken(), secret, "anonymous");
  const csrf = csrfToken(binding, secret);
  request.cookies.delete(COOKIE_NAMES.session);
  request.cookies.set(COOKIE_NAMES.anonymous, binding);
  request.cookies.set(COOKIE_NAMES.csrf, csrf);
  const response = next();
  if (sid) response.cookies.set(COOKIE_NAMES.session, "", cookieAttributes(COOKIE_NAMES.session, 0));
  response.cookies.set(COOKIE_NAMES.anonymous, binding, cookieAttributes(COOKIE_NAMES.anonymous, 3600));
  response.cookies.set(COOKIE_NAMES.csrf, csrf, cookieAttributes(COOKIE_NAMES.csrf, 3600));
  return response;
}
/** Same choice as the onboarding page: `returnTo` (or the older `next`) naming an event's join modal goes straight there. */
function onboardingRedirect(params: URLSearchParams) {
  const target = params.get("returnTo") ?? params.get("next");
  const slug = target ? joinSlug(target) : null;
  return slug ? joinHref(slug) : undefined;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|email/|assets/).*)"] };
