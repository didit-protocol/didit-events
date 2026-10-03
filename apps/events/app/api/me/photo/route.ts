import { COOKIE_NAMES, requestCookies } from "@didit-events/core/http/policy";
import { identity } from "../../../../src/auth/runtime";
import { navigationPolicy } from "../../../../src/auth/browser";
import { routeError } from "../../../../src/auth/route";
export async function GET(req: Request) {
  try {
    navigationPolicy(req);
    const principal = await identity.auth.requireGuest(requestCookies(req).get(COOKIE_NAMES.session) ?? "");
    const account = await identity.accounts.get(principal.accountId);
    if (!account?.photo) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(account.photo), { headers: { "Content-Type": "image/jpeg", "Content-Length": String(account.photo.length), "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
  } catch (error) { return routeError(error); }
}
