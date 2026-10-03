import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPhaseTimer } from "./phase";
import { verifyingScreen } from "./screen";

/** One display frame at 60 Hz. */
const FRAME_MS = 1000 / 60;

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
afterEach(() => vi.useRealTimers());

function track(state: string) {
  const seen: number[] = [];
  const stop = startPhaseTimer(state, (ms) => seen.push(ms));
  const code = () => verifyingScreen(seen.at(-1) ?? 0).code;
  return { seen, stop, code };
}

describe("startPhaseTimer", () => {
  it("switches K-05a → K-05b at 4000 ms ± one frame, whatever the entry offset against the wall clock", () => {
    for (const offset of [0, 1, 499, 999]) {
      vi.advanceTimersByTime(offset);
      const t = track("verifying");
      vi.advanceTimersByTime(4000 - FRAME_MS);
      expect(t.code()).toBe("K-05a");
      vi.advanceTimersByTime(FRAME_MS);
      expect(t.code()).toBe("K-05b");
      expect(Math.abs(t.seen.find((ms) => ms >= 4000)! - 4000)).toBeLessThanOrEqual(FRAME_MS);
      t.stop();
    }
  });

  it("never skips K-05a: nothing is reported before the first second", () => {
    const t = track("verifying");
    vi.advanceTimersByTime(999);
    expect(t.seen).toEqual([]);
    expect(t.code()).toBe("K-05a");
    t.stop();
  });

  it("ticks every second from the state's entry and stops cleanly", () => {
    vi.advanceTimersByTime(123);
    const t = track("result");
    vi.advanceTimersByTime(3000);
    expect(t.seen).toEqual([1000, 2000, 3000]);
    t.stop();
    vi.advanceTimersByTime(5000);
    expect(t.seen).toHaveLength(3);
  });
});
