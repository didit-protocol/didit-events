import { routeEventAccess } from "../../../../../../../src/auth/access";
import { failure, success } from "../../../../../../../src/server/event-model-api";
import { getGuestDetail } from "../../../../../../admin/(events)/events/[id]/(tabs)/guests/data";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const runtime = "nodejs";

/**
 * The Guests drawer for one guest (Guests tab and check-in log), fetched when the drawer opens. It answers with the
 * page loader's own result: same capability and photo rule. `data: null` = no such guest on this event.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string; registrationId: string }> }) {
  try {
    const p = await context.params;
    const { event } = await routeEventAccess(request, p.id, "guests.view");
    if (!ID_RE.test(p.registrationId)) return success(null);
    return success(await getGuestDetail(event.slug, p.registrationId));
  } catch (e) {
    return failure(e);
  }
}
