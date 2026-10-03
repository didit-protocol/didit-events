import { doorService } from "@didit-events/core/door/service";
import { BODY_LIMITS } from "@didit-events/core/http/policy";
import { doorError, doorJson, doorRequest } from "../../../../../src/door/http";

export const dynamic = "force-dynamic";

/** `?track=7&face=212` from the multi-face door: its track id (echoed back) and the face width in camera px. */
function faceHint(url: URL): { trackId: number | null; faceWidth: number | null } {
  const int = (value: string | null, max: number) => (value !== null && /^\d{1,7}$/.test(value) && Number(value) <= max ? Number(value) : null);
  return { trackId: int(url.searchParams.get("track"), 1_000_000), faceWidth: int(url.searchParams.get("face"), 10_000) };
}

/**
 * One face crop from the door (JPEG ≤ 400 KB, a single face). `?test=1` runs Test mode: the same recognition, no
 * check-in, the row flagged `test`. Returns the legacy result plus the compact AR-tag fields (outcome, name, verified
 * badge). Capability: the door session (door.operate), re-checked per scan. Never stores the image.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { door, body } = await doorRequest(request, id, { mutation: { maxBytes: BODY_LIMITS.scan, contentType: "image/jpeg" } });
    const url = new URL(request.url), test = url.searchParams.get("test") === "1", hint = faceHint(url);
    const result = await doorService.scanFace(door, body, { test, faceWidth: hint.faceWidth });
    return doorJson(await doorService.scanResult(result, door.eventId, test, hint));
  } catch (error) { return doorError(error, "door.scan", id); }
}
