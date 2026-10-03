import { ModelError } from "@didit-events/core/domain/model-error";
import { IdentityError } from "@didit-events/core/identity";
import { routeEventAccess, routeGlobalAccess } from "../../../../../src/auth/access";
import { renderDescriptionPreview } from "../../../../../src/server/markdown-preview";
import { failure, success, uuid } from "../../../../../src/server/event-model-api";

export const runtime = "nodejs";

/**
 * Editor description preview: the Markdown rendered by the public page's sanitiser (renderSafeMarkdown), so the
 * Preview tab shows exactly what guests get. `?event=<id>` = an event editor (event.edit); none = New event
 * (events.create). Browser POST with the CSRF header; nothing is stored.
 */
export async function POST(request: Request) {
  try {
    const event = new URL(request.url).searchParams.get("event");
    const guard = { maxBytes: 256 * 1024, contentType: "application/json" };
    let bytes: Uint8Array | undefined;
    if (event) bytes = (await routeEventAccess(request, uuid.parse(event), "event.edit", guard)).body;
    else {
      const access = await routeGlobalAccess(request, "events.create", guard);
      if (!access.actor) throw new IdentityError("StaffForbidden", 403);
      bytes = access.body;
    }
    let source: unknown;
    try { source = (JSON.parse(Buffer.from(bytes!).toString("utf8")) as { source?: unknown }).source; } catch { throw new ModelError("invalid"); }
    const html = renderDescriptionPreview(source);
    if (html === null) throw new ModelError("invalid");
    return success({ html });
  } catch (error) {
    return failure(error);
  }
}
