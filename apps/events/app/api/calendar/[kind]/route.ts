import { getCalendarImage } from "@didit-events/core/calendar";
import { IMAGE_CSP } from "../../../../src/system/security-headers";

export const runtime = "nodejs";

/**
 * Public calendar images (P-03 cover and logo). The URL carries the slot version (`?v=3`): the current version is
 * immutable and cached for a year; any other `v` gets the current bytes with a one-minute cache; no image is a 404.
 */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (kind !== "cover" && kind !== "logo") return new Response(null, { status: 404 });
  const image = await getCalendarImage(kind);
  if (!image) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const requested = new URL(req.url).searchParams.get("v");
  const current = requested === String(image.version);
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.type,
      "Content-Length": String(image.bytes.length),
      "X-Content-Type-Options": "nosniff",
      // The header the browser gets comes from next.config.ts (same value); this one covers a handler called directly.
      "Content-Security-Policy": IMAGE_CSP,
      "Cache-Control": current ? "public, max-age=31536000, immutable" : "public, max-age=60",
    },
  });
}
