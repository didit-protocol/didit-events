// The door's side effects around the app reducer (./appState.ts): one context poll and the
// single timeout that fires the next poll. Every dependency is injected, so the cadence is testable on fake timers.
import type { ContextFetch } from "./client";
import type { KioskAction, KioskAppState } from "./appState";

/** Upper bound for one context poll, after which it counts as failed and the next poll is scheduled. */
export const POLL_TIMEOUT_MS = 25_000;

export interface KioskEffects {
  getState: () => KioskAppState;
  dispatch: (action: KioskAction) => void;
  now: () => number;
}

/** Fetches the context once (skipped while one is in flight) and dispatches the outcome. */
export async function runPoll(
  fx: KioskEffects,
  fetchContext: () => Promise<ContextFetch>,
  timeoutMs = POLL_TIMEOUT_MS,
): Promise<void> {
  const s = fx.getState();
  if (s.session || s.poll.inFlightSince !== null) return;
  const requestedAt = fx.now();
  fx.dispatch({ type: "pollStarted", now: requestedAt });
  // Belt and braces on top of the fetch AbortSignal: a promise that never settles still releases the poll slot.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<ContextFetch>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "service" }), timeoutMs);
  });
  const r = await Promise.race([fetchContext(), timedOut]);
  clearTimeout(timer);
  if (r.ok) fx.dispatch({ type: "contextReceived", context: r.context, requestedAt, now: fx.now(), source: "poll" });
  else if (r.session) fx.dispatch({ type: "sessionEnded", reason: r.session });
  else fx.dispatch({ type: "pollFailed", reason: r.reason, now: fx.now() });
}

export interface Timers {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

/** Arms `run` for epoch time `at`; returns the cancel. Re-arm only when `poll.at` changes, never on context updates. */
export function armAt(at: number, run: () => void, timers: Timers): () => void {
  const id = timers.setTimeout(run, Math.max(0, at - timers.now()));
  return () => timers.clearTimeout(id);
}
