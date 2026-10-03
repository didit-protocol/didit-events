import { routeEventAccess } from "../../../../../../../../src/auth/access";
import { parseApplicantQuery } from "../../../../../../../../src/admin/applicants/query";
import { failure, success } from "../../../../../../../../src/server/event-model-api";
import { getApplicantDetail } from "../../../../../../../admin/(events)/events/[id]/(tabs)/applicants/data";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const runtime = "nodejs";

/**
 * The Requests drawer for one applicant, fetched when the drawer opens or moves (the page no longer re-renders for
 * it). It answers with the page loader's own result: same capability, same photo rule, same place in the filtered
 * list (`?tab=&q=&signin=&signal=`). `data: null` = no such applicant on this event.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string; registrationId: string }> }) {
  try {
    const p = await context.params;
    const { event } = await routeEventAccess(request, p.id, "guests.view");
    if (!ID_RE.test(p.registrationId)) return success(null);
    const query = parseApplicantQuery(Object.fromEntries(new URL(request.url).searchParams));
    return success(await getApplicantDetail(event.slug, p.registrationId, query));
  } catch (e) {
    return failure(e);
  }
}
