import { AssetError,COVER_TRANSPORT_BYTES,uploadEventCover } from "@didit-events/core/content/event-assets";
import { routeEventAccess } from "../../../../../../src/auth/access";
import { routeError } from "../../../../../../src/auth/route";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor, event, body } = await routeEventAccess(request, (await params).id, "event.edit", { maxBytes: COVER_TRANSPORT_BYTES + 64 * 1024, contentType: "multipart/form-data" });
    const form = await new Response(new Uint8Array(body!), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
    const file = form.get("cover");
    if (!(file instanceof File)) throw new AssetError("invalid");
    const result = await uploadEventCover(actor, event.id, { bytes: new Uint8Array(await file.arrayBuffer()),
      expectedEventVersion: Number(form.get("expectedEventVersion")), alt: String(form.get("alt") || "Event cover"),
      // "wide" adds or replaces the banner (tickets and emails); anything else is the square main cover.
      variant: form.get("variant") === "wide" ? "wide" : "main" });
    return Response.json({ ok: true, data: result });
  } catch (error) {
    if (error instanceof AssetError) return Response.json({ ok: false, error: { code: error.code, message: error.message } }, { status: error.status });
    return routeError(error);
  }
}
