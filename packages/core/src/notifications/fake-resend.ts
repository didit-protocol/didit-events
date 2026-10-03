import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeResendCall { headers: IncomingHttpHeaders; body: Record<string, unknown> }
/** A scripted answer; `body` replaces the default error JSON (e.g. Resend's `daily_quota_exceeded`). */
export interface FakeResendResponse { status: number; headers?: Record<string, string>; body?: Record<string, unknown> }
export const RESEND_DAILY_QUOTA: FakeResendResponse = { status: 429, body: { statusCode: 429, name: "daily_quota_exceeded", message: "You have reached your daily email sending quota." } };
/**
 * Local Resend double (node:http, no deps). Records every POST /emails. `respond` scripts the next
 * responses; otherwise it answers 200 and, like Resend, returns the same id for a repeated Idempotency-Key.
 */
export async function startFakeResend() {
  const calls: FakeResendCall[] = [], script: FakeResendResponse[] = [], ids = new Map<string, string>();
  let delayMs = 0, counter = 0;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk as Buffer));
    req.on("end", () => {
      void (async () => {
        if (req.method !== "POST" || req.url !== "/emails") { res.writeHead(404).end(); return; }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
        calls.push({ headers: req.headers, body });
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
        const next = script.shift();
        if (next && next.status !== 200) { res.writeHead(next.status, { "content-type": "application/json", ...next.headers }).end(JSON.stringify(next.body ?? { name: "error", message: "SECRET_PROVIDER_BODY" })); return; }
        const key = String(req.headers["idempotency-key"] ?? "");
        const id = ids.get(key) ?? `re_${++counter}`;
        if (key) ids.set(key, id);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id }));
      })();
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    respond: (...responses: FakeResendResponse[]) => { script.push(...responses); },
    setDelay: (ms: number) => { delayMs = ms; },
    reset: () => { calls.length = 0; script.length = 0; ids.clear(); delayMs = 0; counter = 0; },
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
export type FakeResend = Awaited<ReturnType<typeof startFakeResend>>;
