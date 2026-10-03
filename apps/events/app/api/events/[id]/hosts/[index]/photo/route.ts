import { z } from "zod";
import { hostPhoto } from "../../../../../../../src/server/hosts";

export const runtime = "nodejs";

/** Public: the profile photo of the account a published event names as host `index` (the URL is versioned). */
export async function GET(_request: Request, context: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await context.params;
  const eventId = z.uuid().safeParse(id), n = z.coerce.number().int().min(0).max(49).safeParse(index);
  const photo = eventId.success && n.success ? await hostPhoto(eventId.data, n.data) : null;
  if (!photo) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(photo), {
    headers: { "Content-Type": "image/jpeg", "Content-Length": String(photo.length), "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
