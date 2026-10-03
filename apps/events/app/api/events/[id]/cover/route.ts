import { authService } from "@didit-events/core";
import { coverWidth,readEventCover } from "@didit-events/core/content/event-assets";
import { COOKIE_NAMES,requestCookies } from "@didit-events/core/http/policy";
import { failure } from "../../../../../src/server/event-model-api";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const cookie = requestCookies(request).get(COOKIE_NAMES.session);
    const actor = cookie ? await authService.requireStaff(cookie).catch(() => undefined) : undefined;
    const query = new URL(request.url).searchParams;
    return await readEventCover((await params).id, query.get("v"), actor, undefined, coverWidth(query.get("w")));
  } catch (error) { return failure(error); }
}
