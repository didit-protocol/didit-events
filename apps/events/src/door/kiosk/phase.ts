// Time spent in the face engine's current state, for the screens that change inside one state (K-05a → K-05b at 4 s,
// the result countdowns). Measured on performance.now() from the moment the state is entered, with a timer armed for
// each exact boundary, so a sub-phase switches on time instead of on the next tick of the door clock.
import { useEffect, useState } from "react";

/** Sub-phase boundaries (ms since entering the state) the screen must switch on exactly. */
export const PHASE_BOUNDARIES_MS: Readonly<Record<string, readonly number[]>> = { verifying: [4000] };
/** Countdowns inside a state refresh this often, counted from the state's entry. */
export const PHASE_TICK_MS = 1000;

export interface PhaseTimerDeps {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

const defaultDeps = (): PhaseTimerDeps => ({
  now: () => performance.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
});

/**
 * Starts timing `state` now: calls `onElapsed(ms)` on every tick and at each boundary. Returns a stop function.
 * Ticks are one-shot timers re-armed from the true elapsed time, so drift never accumulates.
 */
export function startPhaseTimer(state: string | null, onElapsed: (ms: number) => void, deps: PhaseTimerDeps = defaultDeps()): () => void {
  const since = deps.now();
  const boundaries = (state && PHASE_BOUNDARIES_MS[state]) || [];
  let timer: unknown = null;
  const arm = () => {
    const elapsed = deps.now() - since;
    const nextTick = (Math.floor(elapsed / PHASE_TICK_MS) + 1) * PHASE_TICK_MS;
    const next = Math.min(nextTick, ...boundaries.filter((b) => b > elapsed));
    timer = deps.setTimeout(() => {
      onElapsed(Math.max(next, deps.now() - since));
      arm();
    }, next - elapsed);
  };
  arm();
  return () => {
    if (timer !== null) deps.clearTimeout(timer);
  };
}

/** Milliseconds since `state` was entered; 0 on the render that enters it. */
export function usePhaseElapsed(state: string | null): number {
  const [phase, setPhase] = useState<{ state: string | null; elapsed: number }>({ state, elapsed: 0 });
  if (phase.state !== state) setPhase({ state, elapsed: 0 });
  useEffect(() => startPhaseTimer(state, (elapsed) => setPhase({ state, elapsed })), [state]);
  return phase.state === state ? phase.elapsed : 0;
}
