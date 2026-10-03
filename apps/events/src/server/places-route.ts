import { consume } from "@didit-events/core/counters";
import { PolicyError } from "@didit-events/core/http/policy";
import { IdentityError } from "@didit-events/core/identity";
import { PlacesError, placesEnabled, SESSION_TOKEN } from "./places";

/** Per staff member: typing bursts are debounced client-side, so 120 calls a minute is generous. */
const LIMIT = 120, WINDOW_SEC = 60;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

/**
 * The part of a /api/admin/places/* request after the route's own staff check: Places configured, a well-formed
 * session token and the per-staff rate limit, then the handler's JSON.
 */
export async function placesResponse(staff: { email: string }, req: Request, handler: (url: URL, session: string) => Promise<unknown>): Promise<Response> {
  if (!placesEnabled()) return json({ error: "PlacesDisabled" }, 404);
  const url = new URL(req.url);
  const session = url.searchParams.get("session") ?? "";
  if (!SESSION_TOKEN.test(session)) return json({ error: "InvalidSession" }, 400);
  const limit = await consume(`places:${staff.email}`, LIMIT, WINDOW_SEC);
  if (!limit.allowed) return Response.json({ error: "RateLimited" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(Math.max(1, Math.ceil((limit.resetsAt.getTime() - Date.now()) / 1000))) } });
  return json(await handler(url, session));
}

/** Guard and upstream failures → JSON the Location field understands (it falls back to manual fields). */
export function placesError(error: unknown): Response {
  if (error instanceof PlacesError) return json({ error: error.message }, error.status);
  if (error instanceof IdentityError || error instanceof PolicyError) return json({ error: "Forbidden" }, error.status === 401 ? 401 : 403);
  return json({ error: "PlacesUnavailable" }, 502);
}
