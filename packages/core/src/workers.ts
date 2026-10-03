import { setTimeout } from "node:timers/promises";
/** Abortable worker loop; a failed tick is handed to `onError` (the caller reports it) and the loop goes on. */
export async function workerLoop(tick: () => Promise<unknown>, options: { signal: AbortSignal; intervalMs?: number; onError?: (error: unknown) => void }): Promise<void> {
  while (!options.signal.aborted) {
    try { await tick(); } catch (error) { options.onError?.(error); }
    try { await setTimeout(options.intervalMs ?? 1000, undefined, { signal: options.signal }); } catch { if (options.signal.aborted) return; throw new Error("WorkerTimerFailed"); }
  }
}
export const retryDelaySec = (attempt: number): number => Math.min(3600, 2 ** Math.min(attempt, 12));
