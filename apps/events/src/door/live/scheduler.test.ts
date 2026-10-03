import { describe, expect, it } from "vitest";
import { RecognitionScheduler, type Candidate } from "./scheduler";

const ready = (id: number, priority = 100, extra: Partial<Candidate> = {}): Candidate => ({ id, ready: true, priority, ...extra });

describe("RecognitionScheduler", () => {
  it("sends at most 3 at once, biggest face first, one dispatch per 400 ms", () => {
    const s = new RecognitionScheduler<string>();
    const faces = [ready(1, 50), ready(2, 300), ready(3, 120), ready(4, 80), ready(5, 60)];
    expect(s.next(faces, 0)).toEqual([2]);
    expect(s.next(faces, 100)).toEqual([]);
    expect(s.next(faces, 400)).toEqual([3]);
    expect(s.next(faces, 800)).toEqual([4]);
    expect(s.inFlight).toBe(3);
    expect(s.next(faces, 1200)).toEqual([]);
    s.resolve(2, "welcome", 1250);
    expect(s.next(faces, 1300)).toEqual([5]);
  });

  it("never sends the same face twice while it is tracked; it is re-identified only after it was lost", () => {
    const s = new RecognitionScheduler<string>({ minGapMs: 0 });
    expect(s.next([ready(1)], 0)).toEqual([1]);
    expect(s.next([ready(1)], 10)).toEqual([]);
    s.resolve(1, "welcome", 20);
    expect(s.next([ready(1)], 5000)).toEqual([]);
    expect(s.status(1)).toEqual({ state: "done", result: "welcome", at: 20 });
    // Lost: the tracker drops id 1; the face comes back as id 2 and is sent again.
    s.sync(new Set([2]));
    expect(s.status(1)).toEqual({ state: "waiting" });
    expect(s.next([ready(2)], 5001)).toEqual([2]);
  });

  it("retries a failed face after 2 s", () => {
    const s = new RecognitionScheduler<string>({ minGapMs: 0 });
    s.next([ready(1)], 0);
    s.fail(1, 100);
    expect(s.status(1)).toEqual({ state: "retry", at: 2100 });
    expect(s.next([ready(1)], 2000)).toEqual([]);
    expect(s.next([ready(1)], 2100)).toEqual([1]);
  });

  it("sends nothing while blocked (offline) and skips faces that aren't ready", () => {
    const s = new RecognitionScheduler<string>({ minGapMs: 0 });
    expect(s.next([ready(1)], 0, true)).toEqual([]);
    expect(s.status(1)).toEqual({ state: "waiting" });
    expect(s.next([{ id: 1, ready: false, priority: 1 }], 0)).toEqual([]);
  });

  it("a pending request of a lost face still counts against concurrency until it settles", () => {
    const s = new RecognitionScheduler<string>({ minGapMs: 0 });
    s.next([ready(1), ready(2), ready(3)], 0);
    s.sync(new Set());
    expect(s.inFlight).toBe(3);
    expect(s.next([ready(4)], 1)).toEqual([]);
    s.resolve(1, "x", 2, false);
    expect(s.status(1)).toEqual({ state: "waiting" });
    expect(s.next([ready(4)], 3)).toEqual([4]);
  });

  it("asks again for a finished face only when the caller says so (strict door: it came closer), after the retry gap", () => {
    const s = new RecognitionScheduler<string>({ minGapMs: 0 });
    s.next([ready(1)], 0);
    s.resolve(1, "liveness_needed", 10);
    expect(s.next([ready(1, 100, { again: true })], 500)).toEqual([]);
    expect(s.next([ready(1, 100, { again: true })], 2010)).toEqual([1]);
  });

  it("a transient result is retried after 2 s when the face is ready again, at most 3 sends per track; then it stands", () => {
    const s = new RecognitionScheduler<string>({ minGapMs: 0 });
    expect(s.next([ready(1)], 0)).toEqual([1]);
    s.retry(1, "no_face", 100);
    expect(s.status(1)).toEqual({ state: "retry", at: 2100 });
    expect(s.next([ready(1)], 2000)).toEqual([]);
    expect(s.next([{ id: 1, ready: false, priority: 1 }], 2100)).toEqual([]);
    expect(s.next([ready(1)], 2200)).toEqual([1]);
    s.retry(1, "inconclusive", 2300);
    expect(s.next([ready(1)], 4300)).toEqual([1]);
    s.retry(1, "no_face", 4400);
    expect(s.status(1)).toEqual({ state: "done", result: "no_face", at: 4400 });
    expect(s.next([ready(1)], 9000)).toEqual([]);
    // A new track (the face was lost and came back) starts with fresh attempts.
    s.sync(new Set([2]));
    expect(s.next([ready(2)], 9001)).toEqual([2]);
    s.retry(2, "no_face", 9002);
    expect(s.status(2).state).toBe("retry");
  });

  it("a mode change voids finished faces (they go again) and marks requests in flight stale", () => {
    const s = new RecognitionScheduler<string>({ minGapMs: 0 });
    s.next([ready(1), ready(2)], 0);
    s.resolve(1, "test:welcome", 10);
    s.invalidate();
    expect(s.status(1)).toEqual({ state: "waiting" });
    expect(s.stale(2)).toBe(true);
    expect(s.inFlight).toBe(1);
    // The late answer of face 2 (Test mode) is dropped; face 2 is sent again live.
    s.drop(2);
    expect(s.status(2)).toEqual({ state: "waiting" });
    expect(s.next([ready(1), ready(2)], 20)).toEqual([1, 2]);
    expect(s.stale(1)).toBe(false);
  });

  it("a strict door's `again` stops once the track's transient sends hit maxAttempts (no endless liveness_needed loop)", () => {
    const s = new RecognitionScheduler<string>({ minGapMs: 0, maxAttempts: 3 });
    const again = ready(1, 100, { again: true });
    let dispatches = 0;
    for (let t = 0; t < 60_000; t += 100) {
      if (s.next([again], t).length) {
        dispatches++;
        s.retry(1, "liveness_needed", t + 10);
      }
    }
    expect(dispatches).toBe(3);
    expect(s.status(1)).toMatchObject({ state: "done", result: "liveness_needed" });
    // A new track starts with fresh attempts.
    s.sync(new Set([2]));
    expect(s.next([ready(2, 100, { again: true })], 60_000)).toEqual([2]);
  });

  it("a mode toggle advances the generation at once: an answer that lands before the next frame's check is stale", () => {
    const s = new RecognitionScheduler<string>({ minGapMs: 0 });
    expect(s.setMode(false)).toBe(false);
    expect(s.next([ready(1)], 0)).toEqual([1]);
    const epoch = s.epoch;
    // The operator switches to Test mode while a detection pass is running; the live answer arrives first.
    expect(s.setMode(true)).toBe(true);
    expect(s.epoch).toBe(epoch + 1);
    expect(s.stale(1)).toBe(true);
    s.drop(1);
    expect(s.status(1)).toEqual({ state: "waiting" });
    // Re-reading the same mode is not a toggle.
    expect(s.setMode(true)).toBe(false);
    expect(s.epoch).toBe(epoch + 1);
  });
});
