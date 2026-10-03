import { routeGlobalAccess } from "../../../../src/auth/access";
import { IdentityError } from "@didit-events/core/identity";
import { navigationPolicy } from "../../../../src/auth/browser";
import { failure, success } from "../../../../src/server/event-model-api";
import { searchPeople } from "../../../../src/server/hosts";

export const runtime = "nodejs";

/** Staff: host picker suggestions (staff and accounts by email or name). */
export async function GET(request: Request) {
  try {
    navigationPolicy(request);
    const { actor } = await routeGlobalAccess(request, "people.search");
    if (!actor) throw new IdentityError("StaffForbidden", 403);
    return success(await searchPeople(new URL(request.url).searchParams.get("q") ?? ""));
  } catch (error) {
    return failure(error);
  }
}
