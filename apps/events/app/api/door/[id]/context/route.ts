import { doorService } from "@didit-events/core/door/service";
import { BUILD_ID, doorError, doorJson, doorRequest } from "../../../../../src/door/http";

export const dynamic = "force-dynamic";

/** The door screen's poll (every 15 s): event state, station, arrivals, budget, recent scans, build. Capability: the door session (door.operate). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { door } = await doorRequest(request, id);
    return doorJson({ ...(await doorService.context(door)), build: BUILD_ID });
  } catch (error) { return doorError(error, "door.context", id); }
}
