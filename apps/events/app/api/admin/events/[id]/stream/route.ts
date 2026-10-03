import { IdentityError } from "@didit-events/core/identity";
import { ChangeBus } from "@didit-events/core";
import { routeEventAccess } from "../../../../../../src/auth/access";
import { PolicyError } from "@didit-events/core/http/policy";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
 try {
  const { id } = await params, { event } = await routeEventAccess(request, id, "event.view");
  const bus = new ChangeBus(), encoder = new TextEncoder(); let close: () => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
   async start(controller) {
    let closed = false, unlisten: (() => Promise<void>) | undefined;
    const send = (type: string) => { if (!closed) controller.enqueue(encoder.encode("data: " + JSON.stringify({ type, event_id: event.id }) + "\n\n")); };
    const unsubscribe = bus.subscribe(s => { if (s.event_id === event.id) send(s.type); });
    const timer = setInterval(() => { void routeEventAccess(request, event.id, "event.view").then(() => send("refresh")).catch(() => close()); }, 15000);
    close = () => { if (closed) return; closed = true; clearInterval(timer); unsubscribe(); void unlisten?.(); try { controller.close(); } catch { /* Consumer cancellation already closed it. */ } request.signal.removeEventListener("abort", close); };
    request.signal.addEventListener("abort", close, { once: true });
    try { unlisten = await bus.listen("event_" + event.id, undefined, () => send("reconnect")); if (closed) await unlisten(); else send("connected"); } catch { close(); }
    if (request.signal.aborted) close();
   }, cancel() { close(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
 } catch (e) { return new Response(null, { status: (e instanceof PolicyError || e instanceof IdentityError) ? e.status : 503 }); }
}
