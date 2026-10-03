import type { ChangeSignal } from "@didit-events/core";
import { COOKIE_NAMES, requestCookies } from "@didit-events/core/http/policy";
import type { FastPollResult } from "@didit-events/core/verification/fast-poll";

/**
 * GET /api/me/verification/stream: the signed-in guest's own verification changes as Server-Sent Events.
 *
 * - Auth: the guest session cookie; only `account_<own id>` is listened to (another account's signals never reach it).
 *   Cross-site requests are refused; the session is re-checked on every heartbeat and the stream ends when it lapses.
 * - Push: the webhook / decision path NOTIFYs `account_<id>` in its transaction (pg LISTEN/NOTIFY via ChangeBus);
 *   each signal becomes `data: {"type":"verification.updated"}` (or `onboarding.complete`).
 * - Fallback without webhooks (localhost): while the account has an active operation, `poll` reads the Didit decision
 *   and applies it through the same decision path (bounded and deduped in core `pollActiveDecision`). `?wait=decision`
 *   (the guest finished the check and waits on the result) reads every ~3 s; without it (the guest is still in the
 *   camera UI) at most one read every 20 s, so the per-account budget is still there when the guest actually waits.
 *   When the budget or the app-wide limiter refuses a read, `data: {"type":"verification.limited"}` is pushed once.
 * - Heartbeat `event: ping` every 15 s; the stream closes after `maxLifetimeMs` (EventSource reconnects on its own).
 */
export interface VerificationStreamDeps {
  requireGuest(sessionCookie: string): Promise<{ accountId: string }>;
  listen(channel: string, onSignal: (signal: ChangeSignal) => void, onReconnect: () => void): Promise<() => Promise<void>>;
  poll?: (accountId: string) => Promise<FastPollResult>;
  heartbeatMs?: number;
  pollMs?: number;
  /** Read interval without `?wait=decision` (the guest is still in the check). */
  passivePollMs?: number;
  /** Stop reading Didit directly after this long (the webhook and the reconcile sweep still run). */
  maxPollMs?: number;
  maxLifetimeMs?: number;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

const PUSHED = new Set(["verification.updated", "onboarding.complete"]);
const headers = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no", "referrer-policy": "no-referrer" };

export async function verificationStream(request: Request, deps: VerificationStreamDeps): Promise<Response> {
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ ok: false, error: { code: "forbidden", message: "forbidden" } }, { status: 403 });
  const cookie = requestCookies(request).get(COOKIE_NAMES.session) ?? "";
  let accountId: string;
  try {
    ({ accountId } = await deps.requireGuest(cookie));
  } catch {
    return Response.json({ ok: false, error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const { heartbeatMs = 15_000, pollMs = 3_000, passivePollMs = 20_000, maxPollMs = 10 * 60_000, maxLifetimeMs = 15 * 60_000 } = deps;
  const waiting = new URL(request.url).searchParams.get("wait") === "decision";
  const encoder = new TextEncoder();
  let close: () => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false, unlisten: (() => Promise<void>) | undefined, polling = false, limited = false;
      const opened = Date.now();
      const write = (chunk: string) => { if (!closed) try { controller.enqueue(encoder.encode(chunk)); } catch { close(); } };
      const send = (type: string) => write(`data: ${JSON.stringify({ type })}\n\n`);
      const timers: ReturnType<typeof setInterval>[] = [];
      close = () => {
        if (closed) return;
        closed = true;
        for (const t of timers) clearInterval(t);
        void unlisten?.().catch(() => undefined);
        try { controller.close(); } catch { /* the consumer already cancelled */ }
        request.signal.removeEventListener("abort", close);
      };
      request.signal.addEventListener("abort", close, { once: true });
      const end = (reason: string) => { write(`event: end\ndata: ${JSON.stringify({ reason })}\n\n`); close(); };
      timers.push(setInterval(() => {
        if (Date.now() - opened >= maxLifetimeMs) return end("lifetime");
        deps.requireGuest(cookie).then(principal => principal.accountId === accountId ? write(`event: ping\ndata: {}\n\n`) : end("session"), () => end("session"));
      }, heartbeatMs));
      if (deps.poll) {
        const poll = deps.poll;
        timers.push(setInterval(() => {
          if (closed || polling || Date.now() - opened >= maxPollMs) return;
          polling = true;
          poll(accountId).then(result => {
            if (result.state === "applied") send("verification.updated");
            // dedupe = another tab read a moment ago (normal); budget / global = no reads for a while: tell the client.
            else if (result.state === "limited" && result.scope !== "dedupe" && !limited) {
              limited = true;
              deps.log?.("verification.fast_poll_limited", { scope: result.scope });
              send("verification.limited");
            }
          })
            .catch(() => deps.log?.("verification.fast_poll_failed"))
            .finally(() => { polling = false; });
        }, waiting ? pollMs : passivePollMs));
      }
      try {
        unlisten = await deps.listen(`account_${accountId}`, signal => { if (PUSHED.has(signal.type) && signal.event_id === accountId) send(signal.type); }, () => send("verification.updated"));
        if (closed) await unlisten();
        else write(`retry: 3000\nevent: connected\ndata: {}\n\n`);
      } catch {
        end("unavailable");
      }
      if (request.signal.aborted) close();
    },
    cancel() { close(); },
  });
  return new Response(stream, { headers });
}
