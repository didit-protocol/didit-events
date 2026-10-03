import { IdentityError } from "@didit-events/core/identity";
import { eventService } from "@didit-events/core";
import { routeEventAccess } from "../../../../../../src/auth/access";
import { PolicyError } from "@didit-events/core/http/policy";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
 try { const { id } = await params, { actor, event } = await routeEventAccess(request, id, "event.view"); return Response.json(await eventService.liveSnapshot(actor, event.id), { headers: { "cache-control": "no-store" } }); }
 catch (e) { return Response.json({ error: (e instanceof PolicyError || e instanceof IdentityError) ? e.message : "SnapshotUnavailable" }, { status: (e instanceof PolicyError || e instanceof IdentityError) ? e.status : e instanceof Error && e.message === "EventNotFound" ? 404 : 503 }); }
}
