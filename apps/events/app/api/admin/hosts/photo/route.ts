import { IdentityError } from "@didit-events/core/identity";
import { routeGlobalAccess } from "../../../../../src/auth/access";
import { failure } from "../../../../../src/server/event-model-api";
import { hostAccountPhoto } from "../../../../../src/server/hosts";

export const runtime = "nodejs";

/**
 * Staff (`people.search`, the host picker's capability): the profile photo of the account a host row names by email,
 * for the editor's host avatar. The public page shows the same photo once the event is published. Private, no-store.
 */
export async function GET(request: Request) {
  try {
    const { actor } = await routeGlobalAccess(request, "people.search");
    if (!actor) throw new IdentityError("StaffForbidden", 403);
    const photo = await hostAccountPhoto(new URL(request.url).searchParams.get("email") ?? "");
    if (!photo) return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    return new Response(new Uint8Array(photo), { headers: { "Content-Type": "image/jpeg", "Content-Length": String(photo.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return failure(error);
  }
}
