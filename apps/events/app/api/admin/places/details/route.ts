import { navigationPolicy } from "../../../../../src/auth/browser";
import { routeGlobalAccess } from "../../../../../src/auth/access";
import { details, PLACE_ID, PlacesError } from "../../../../../src/server/places";
import { placesError, placesResponse } from "../../../../../src/server/places-route";

export const runtime = "nodejs";

/** GET ?id=…&session=… → { place: { placeId, name, formattedAddress, street, city, postalCode, country, lat, lng, mapsUrl } }. Staff only. */
export async function GET(req: Request) {
  try {
    navigationPolicy(req);
    // Address search for the event editor: staff and hosts (the editor checks event.edit on save).
    const { viewer } = await routeGlobalAccess(req, "places.search");
    const staff = { email: viewer.email };
    return await placesResponse(staff, req, async (url, session) => {
      const id = url.searchParams.get("id") ?? "";
      if (!PLACE_ID.test(id)) throw new PlacesError(400, "InvalidPlace");
      return { place: await details(id, session) };
    });
  } catch (error) {
    return placesError(error);
  }
}
