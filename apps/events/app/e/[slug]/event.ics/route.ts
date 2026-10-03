import { eventIcs } from "../../../../src/public/ics";
import { getEvent } from "../data";

/** "Add to calendar" / "Apple / .ics" (P-02f, G-03a). */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const event = await getEvent((await params).slug);
  if (!event) return new Response("Not found", { status: 404 });
  return new Response(eventIcs(event, new URL(request.url).origin, new Date()), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${event.slug}.ics"`,
      "cache-control": "public, max-age=300",
    },
  });
}
