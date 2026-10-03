import { IdentityError } from "@didit-events/core/identity";
import { routeGlobalAccess } from "../../../../../src/auth/access";
import { failure, success, uuid } from "../../../../../src/server/event-model-api";
import { getPerson } from "../../../../admin/people/data";

export const runtime = "nodejs";

/**
 * The People drawer for one account (owner-only, `people.view`), fetched when the drawer opens. It answers with the
 * page loader's own result. `data: null` = no such account.
 */
export async function GET(request: Request, context: { params: Promise<{ accountId: string }> }) {
  try {
    const { actor } = await routeGlobalAccess(request, "people.view");
    if (!actor) throw new IdentityError("StaffForbidden", 403);
    const id = uuid.safeParse((await context.params).accountId);
    return success(id.success ? await getPerson(id.data.toLowerCase()) : null);
  } catch (e) {
    return failure(e);
  }
}
