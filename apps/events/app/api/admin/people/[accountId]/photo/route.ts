import { IdentityError } from "@didit-events/core/identity";
import { routeGlobalAccess } from "../../../../../../src/auth/access";
import { failure } from "../../../../../../src/server/event-model-api";
import { peoplePhoto } from "../../../../../../src/server/people";

export const runtime = "nodejs";

/** Owner-only (`people.view`): an account's profile photo for the People list and drawer (private, no-store). */
export async function GET(request: Request, context: { params: Promise<{ accountId: string }> }) {
  try {
    const { actor } = await routeGlobalAccess(request, "people.view");
    if (!actor) throw new IdentityError("StaffForbidden", 403);
    const photo = await peoplePhoto((await context.params).accountId);
    if (!photo) return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    return new Response(new Uint8Array(photo), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return failure(error);
  }
}
