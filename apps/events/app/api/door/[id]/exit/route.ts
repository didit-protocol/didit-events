import { sourceIpFromHeaders } from "../../../../../src/auth/source-ip";
import { doorService } from "@didit-events/core/door/service";
import { PolicyError } from "@didit-events/core/http/policy";
import { doorError, doorJson, doorRequest, leaveDoorCookies } from "../../../../../src/door/http";

/** Ends door mode with the staff-set PIN (`{ "pin": "123456" }`). Nobody is signed in afterwards. Capability: the door session. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { door, body } = await doorRequest(request, id, { mutation: { maxBytes: 1024, contentType: "application/json" } });
    let pin: unknown;
    try { pin = (JSON.parse(new TextDecoder().decode(body)) as { pin?: unknown }).pin; } catch { throw new PolicyError(400, "InvalidJson"); }
    if (typeof pin !== "string") throw new PolicyError(400, "InvalidPin");
    await doorService.endSessionWithPin(door, pin, sourceIpFromHeaders(request.headers));
    return leaveDoorCookies(doorJson({ ok: true }));
  } catch (error) { return doorError(error, "door.exit", id); }
}
