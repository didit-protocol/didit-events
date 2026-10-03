import { authService, ChangeBus, getDb, getVerificationRuntime } from "@didit-events/core";
import { pollActiveDecision } from "@didit-events/core/verification/fast-poll";
import { verificationStream } from "../../../../../src/server/verification-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The guest's own verification changes, pushed in real time (webhook NOTIFY) with a bounded decision-read fallback. */
export async function GET(request: Request) {
  return verificationStream(request, {
    requireGuest: (cookie) => authService.requireGuest(cookie),
    async listen(channel, onSignal, onReconnect) {
      const bus = new ChangeBus(), unsubscribe = bus.subscribe(onSignal), unlisten = await bus.listen(channel, undefined, onReconnect);
      return async () => { unsubscribe(); await unlisten(); };
    },
    poll(accountId) {
      const service = getVerificationRuntime();
      return pollActiveDecision({ db: getDb(), client: service.options.client, applyDecision: (tx, id, sessionId) => service.evidence.applyDecision(tx, id, sessionId) }, accountId);
    },
    log: (event) => console.info(JSON.stringify({ event })),
  });
}
