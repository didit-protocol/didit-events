import { navigationPolicy } from "../../../../../src/auth/browser";
import { routeGlobalAccess } from "../../../../../src/auth/access";
import { autocomplete } from "../../../../../src/server/places";
import { placesError, placesResponse } from "../../../../../src/server/places-route";

export const runtime = "nodejs";

/** GET ?q=…&session=… → { suggestions: [{ placeId, main, secondary }] } (Places API New autocomplete). Staff only. */
export async function GET(req: Request) {
  try {
    navigationPolicy(req);
    // Address search for the event editor: staff and hosts (the editor checks event.edit on save).
    const { viewer } = await routeGlobalAccess(req, "places.search");
    const staff = { email: viewer.email };
    return await placesResponse(staff, req, async (url, session) => {
      const q = (url.searchParams.get("q") ?? "").trim();
      if (q.length < 3 || q.length > 200) return { suggestions: [] };
      return { suggestions: await autocomplete(q, session) };
    });
  } catch (error) {
    return placesError(error);
  }
}
