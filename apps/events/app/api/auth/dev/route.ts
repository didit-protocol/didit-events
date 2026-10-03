import { SESSION_TTL_SECONDS } from "@didit-events/core/identity/shared";
import { NextResponse } from "next/server";
import { COOKIE_NAMES, cookieAttributes, requestCookies } from "@didit-events/core/http/policy";
import { identity } from "../../../../src/auth/runtime";
import { appOrigin, csrfToken, navigationPolicy, sessionSecret } from "../../../../src/auth/browser";
import { routeError } from "../../../../src/auth/route";
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production" || process.env.DEV_AUTH !== "1") return new Response("Not found", { status: 404 });
  try {
    const url = new URL(process.env.APP_URL ?? "");
    if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return new Response("Not found", { status: 404 });
  } catch { return new Response("Not found", { status: 404 }); }
  try {
    navigationPolicy(req);
    const params = new URL(req.url).searchParams, staff = params.get("as") === "staff";
    const result = await (staff ? identity.devStaffLogin : identity.devLogin)(params.get("email") ?? "", requestCookies(req).get(COOKIE_NAMES.session));
    const response = NextResponse.redirect(new URL(staff ? "/admin" : "/me/events", appOrigin()));
    response.cookies.set(COOKIE_NAMES.session, result.cookie, cookieAttributes(COOKIE_NAMES.session, SESSION_TTL_SECONDS));
    response.cookies.set(COOKIE_NAMES.csrf, csrfToken(result.cookie, sessionSecret()), cookieAttributes(COOKIE_NAMES.csrf, SESSION_TTL_SECONDS));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) { return routeError(error); }
}
