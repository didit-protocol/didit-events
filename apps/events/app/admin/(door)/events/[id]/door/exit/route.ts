import { doorService } from "@didit-events/core/door/service";
import { bodyLimit, COOKIE_NAMES, PolicyError, requestCookies } from "@didit-events/core/http/policy";
import { IdentityError } from "@didit-events/core/identity";
import { readToken } from "@didit-events/core/identity/shared";
import { routeEventAccess } from "../../../../../../../src/auth/access";
import { csrfToken, sessionSecret } from "../../../../../../../src/auth/browser";
import { doorError, leaveDoorCookies } from "../../../../../../../src/door/http";

const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/** Sign-in returns to a confirmation. Navigating here never ends a door session or clears its cookie. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const site = request.headers.get("sec-fetch-site");
  if (site && !["same-origin", "none"].includes(site)) return new Response("Open this link from the door.", { status: 403, headers: privateHeaders });
  let event;
  try { ({ event } = await routeEventAccess(request, id, "door.operate")); }
  catch (error) {
    if (error instanceof IdentityError && error.status === 401) return Response.redirect(new URL(`/login?next=${encodeURIComponent(`/admin/events/${encodeURIComponent(id)}/door/exit`)}`, request.url), 303);
    if (error instanceof IdentityError || error instanceof PolicyError) return Response.redirect(new URL(`/admin/forbidden?next=${encodeURIComponent(`/admin/events/${encodeURIComponent(id)}/door`)}`, request.url), 303);
    throw error;
  }
  const cookie = requestCookies(request).get(COOKIE_NAMES.session)!;
  const csrf = csrfToken(cookie, sessionSecret());
  const path = `/admin/events/${encodeURIComponent(event.slug)}/door`;
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Exit door mode</title></head>
<body><main><h1>Exit door mode?</h1><p>This ends the door session on this device.</p>
<form method="post" action="${path}/exit"><input type="hidden" name="csrf" value="${csrf}"><button type="submit">Exit door mode</button></form>
<p><a href="${path}/kiosk">Keep door mode open</a></p></main></body></html>`, { headers: { ...privateHeaders, "Content-Type": "text/html; charset=utf-8" } });
}

/** The normal browser mutation guard checks Origin and the session-bound CSRF hidden field. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const bytes = await bodyLimit(request, 4096, "application/x-www-form-urlencoded");
    const form = new URLSearchParams(new TextDecoder().decode(bytes));
    const headers = new Headers(request.headers);
    headers.set("x-csrf", form.get("csrf") ?? "");
    const mutation = new Request(request.url, { method: "POST", headers, body: new Uint8Array(bytes) });
    const { actor, event } = await routeEventAccess(mutation, id, "door.operate", { maxBytes: 4096, contentType: "application/x-www-form-urlencoded" });
    const cookie = requestCookies(request).get(COOKIE_NAMES.door), token = cookie ? readToken(cookie, sessionSecret(), "door") : null;
    if (token) {
      let door;
      try { door = await doorService.resolveSession(token, event.id); }
      catch (error) { if (!(error instanceof PolicyError)) throw error; }
      if (door) await doorService.endSession(actor, door);
    }
    return leaveDoorCookies(new Response(null, { status: 303, headers: { ...privateHeaders, Location: new URL(`/admin/events/${event.slug}/door`, request.url).href } }));
  } catch (error) { return doorError(error, "sign-in-exit", id); }
}
