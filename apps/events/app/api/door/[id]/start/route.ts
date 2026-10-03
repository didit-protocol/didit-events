import { doorService } from "@didit-events/core/door/service";
import { PolicyError } from "@didit-events/core/http/policy";
import { adminLinks } from "../../../../../src/admin/links";
import { routeEventAccess } from "../../../../../src/auth/access";
import { identity } from "../../../../../src/auth/runtime";
import { doorError, doorJson, enterDoorCookies } from "../../../../../src/door/http";

/**
 * "Start door mode" (`{ "station": "Main door" }`): capability door.operate with the signed-in session + CSRF. The
 * browser's admin session is revoked and replaced by a door cookie scoped to this event's door, so a laptop left at
 * the entrance opens nothing else. Leaving needs a sign-in (any team member with door access) or the staff PIN.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { actor, event, body } = await routeEventAccess(request, id, "door.operate", { maxBytes: 1024, contentType: "application/json" });
    let station: unknown;
    try { station = (JSON.parse(new TextDecoder().decode(body)) as { station?: unknown }).station; } catch { throw new PolicyError(400, "InvalidJson"); }
    if (typeof station !== "string") throw new PolicyError(400, "InvalidStation");
    const started = await doorService.startSession(actor, event.id, station);
    if (!actor.apiTokenId) await identity.sessions.revoke(actor.sessionId);
    return enterDoorCookies(doorJson({ ok: true, station: started.station, expiresAt: started.expiresAt.toISOString(), door: adminLinks.kiosk(event.slug) }), started.token);
  } catch (error) { return doorError(error, "door.start", id); }
}
