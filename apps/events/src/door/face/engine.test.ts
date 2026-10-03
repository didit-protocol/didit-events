import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIG, FaceEngine, HINT_PRIORITY, evaluateGates, frontalRatio } from "./engine";
import type { Box, EngineFrame, EngineOutput, EngineState, FaceDetection, HintCode } from "./engine";

const W = 1280;
const H = 720;
const DT = 40;
// A face that passes every gate: 45 % of the frame height, centred, frontal.
const GOOD_BOX: Box = { x: 510, y: 198, w: 260, h: 324 };

function face(box: Box = GOOD_BOX, opts: { score?: number; yaw?: number } = {}): FaceDetection {
  const cx = box.x + box.w / 2;
  const eyeY = box.y + box.h * 0.35;
  // yaw shifts the nose towards one eye, skewing the eye–nose ratio.
  const nose = cx + (opts.yaw ?? 0);
  return {
    score: opts.score ?? 0.95,
    box,
    keypoints: {
      rightEye: { x: cx - 50, y: eyeY },
      leftEye: { x: cx + 50, y: eyeY },
      noseTip: { x: nose, y: box.y + box.h * 0.55 },
      mouth: { x: cx, y: box.y + box.h * 0.75 },
      rightEar: { x: box.x, y: eyeY },
      leftEar: { x: box.x + box.w, y: eyeY },
    },
  };
}

function frame(t: number, detections: FaceDetection[] = [face()], extra: Partial<EngineFrame> = {}): EngineFrame {
  return { t, width: W, height: H, detections, luminance: 120, sharpness: 100, ...extra };
}

const shift = (box: Box, dx: number): Box => ({ ...box, x: box.x + dx });

/** Collapses consecutive duplicates: the state trace a user would see. */
function trace(states: EngineState[]): EngineState[] {
  return states.filter((s, i) => s !== states[i - 1]);
}

class Driver {
  t = 0;
  outs: EngineOutput[] = [];
  constructor(readonly engine = new FaceEngine()) {}
  step(detections?: FaceDetection[], extra?: Partial<EngineFrame>): EngineOutput {
    this.t += DT;
    const out = this.engine.step(frame(this.t, detections, extra));
    this.outs.push(out);
    return out;
  }
  steps(n: number, detections?: FaceDetection[], extra?: Partial<EngineFrame>): EngineOutput {
    let out = this.step(detections, extra);
    for (let i = 1; i < n; i++) out = this.step(detections, extra);
    return out;
  }
  /** Advances the clock without frames (face absent from the camera). */
  wait(ms: number) {
    this.t += ms - DT;
  }
  /** Good frames until the engine asks for a capture; returns how many frames it took. */
  untilCapture(detections?: FaceDetection[], max = 200): number {
    for (let i = 1; i <= max; i++) if (this.step(detections).captureRequest) return i;
    throw new Error("no capture request");
  }
  states(): EngineState[] {
    return this.outs.map((o) => o.state);
  }
}

describe("FaceEngine: stability → capture", () => {
  it("goes idle → adjusting → holding → capturing with exact frame counts", () => {
    const d = new Driver();
    d.steps(3, []);
    const good: EngineOutput[] = [];
    for (let i = 0; i < 40; i++) good.push(d.step());

    expect(trace(d.states())).toEqual(["idle", "adjusting", "holding", "capturing"]);
    // Frames 1–11 adjust, frame 12 (index 11) starts the hold.
    expect(good.slice(0, 11).every((o) => o.state === "adjusting" && o.hint === null)).toBe(true);
    expect(good[11]?.state).toBe("holding");
    expect(good[11]?.progress).toBe(0);
    // Hold lasts 800 ms = 20 frames at 40 ms.
    const captureIndex = good.findIndex((o) => o.state === "capturing");
    expect(captureIndex).toBe(11 + 800 / DT);
    expect(good[captureIndex - 1]?.progress).toBeCloseTo(19 / 20);
    expect(good[captureIndex]?.captureRequest).toEqual({ box: GOOD_BOX });
    expect(good[captureIndex]?.events).toContainEqual(expect.objectContaining({ type: "capture", box: GOOD_BOX }));
    // One capture request only; stays capturing until onCaptured.
    expect(good.slice(captureIndex + 1).every((o) => o.state === "capturing" && !o.captureRequest)).toBe(true);
    expect(d.engine.onCaptured().state).toBe("verifying");
    expect(d.step().state).toBe("verifying");
  });

  it("emits state events for each transition", () => {
    const d = new Driver();
    d.step([]);
    const events = [...d.steps(1).events];
    expect(events).toContainEqual({ type: "state", from: "idle", to: "adjusting", t: d.t });
    expect(events).toContainEqual({ type: "track", trackId: 1, t: d.t });
  });

  it("jitter (IoU < 0.85) resets the stability count", () => {
    const d = new Driver();
    d.steps(11);
    const jitter = shift(GOOD_BOX, 60); // IoU 0.625, still passes every gate
    expect(d.step([face(jitter)]).state).toBe("adjusting");
    // The jittered frame starts a new streak: 11 more steady frames are needed.
    expect(d.steps(10, [face(jitter)]).state).toBe("adjusting");
    expect(d.step([face(jitter)]).state).toBe("holding");
  });

  it("small movement (IoU ≥ 0.85) keeps the streak", () => {
    const d = new Driver();
    for (let i = 0; i < 12; i++) d.step([face(shift(GOOD_BOX, i * 5))]);
    expect(d.outs.at(-1)?.state).toBe("holding");
  });

  it("jitter or a gate failure during holding drops back to adjusting and resets progress", () => {
    const d = new Driver();
    d.steps(12);
    expect(d.steps(10).progress).toBeCloseTo(10 / 20);
    const jittered = d.step([face(shift(GOOD_BOX, 60))]);
    expect(jittered.state).toBe("adjusting");
    expect(jittered.progress).toBe(0);

    const e = new Driver();
    e.steps(15);
    const dark = e.step(undefined, { luminance: 30 });
    expect(dark).toMatchObject({ state: "adjusting", hint: "too_dark", progress: 0 });
    // Needs a full 12-frame streak again.
    expect(e.steps(11).state).toBe("adjusting");
    expect(e.step().state).toBe("holding");
  });

  it("captures the sharpest box seen while holding", () => {
    const d = new Driver();
    d.steps(12, undefined, { sharpness: 80 });
    const sharpBox = shift(GOOD_BOX, 4);
    const sharpest = d.step([face(sharpBox)], { sharpness: 300 });
    expect(sharpest.events).toContainEqual({ type: "sharpest", box: sharpBox, sharpness: 300, t: d.t });
    d.untilCapture();
    expect(d.outs.at(-1)?.captureRequest).toEqual({ box: sharpBox });
  });
});

describe("FaceEngine: gates and hints", () => {
  const cases: Array<[string, EngineFrame, HintCode | null]> = [
    ["all pass", frame(0), null],
    ["no face", frame(0, []), "no_face"],
    ["low-score detection is not a face", frame(0, [face(GOOD_BOX, { score: 0.6 })]), "no_face"],
    ["two faces", frame(0, [face(), face(shift(GOOD_BOX, 400))]), "multiple_faces"],
    ["a low-score second face is ignored", frame(0, [face(), face(shift(GOOD_BOX, 400), { score: 0.5 })]), null],
    ["too far", frame(0, [face({ x: 580, y: 280, w: 120, h: 150 })]), "too_far"],
    ["too close", frame(0, [face({ x: 440, y: 90, w: 400, h: 540 })]), "too_close"],
    ["off centre", frame(0, [face(shift(GOOD_BOX, 320))]), "off_center"],
    ["not frontal", frame(0, [face(GOOD_BOX, { yaw: 25 })]), "not_frontal"],
    ["too dark", frame(0, undefined, { luminance: 40 }), "too_dark"],
    ["too bright", frame(0, undefined, { luminance: 230 }), "too_bright"],
    ["blurry", frame(0, undefined, { sharpness: 10 }), "blurry"],
    // Priority when several gates fail at once.
    ["multiple beats dark/blurry", frame(0, [face(), face(shift(GOOD_BOX, 400))], { luminance: 5, sharpness: 0 }), "multiple_faces"],
    ["size beats off-centre/dark", frame(0, [face({ x: 0, y: 0, w: 100, h: 120 })], { luminance: 5 }), "too_far"],
    ["off-centre beats not frontal", frame(0, [face(shift(GOOD_BOX, 320), { yaw: 25 })]), "off_center"],
    ["not frontal beats dark/blurry", frame(0, [face(GOOD_BOX, { yaw: 25 })], { luminance: 5, sharpness: 0 }), "not_frontal"],
    ["dark beats blurry", frame(0, undefined, { luminance: 5, sharpness: 0 }), "too_dark"],
    ["bright beats blurry", frame(0, undefined, { luminance: 250, sharpness: 0 }), "too_bright"],
  ];

  it.each(cases)("%s", (_name, f, hint) => {
    expect(evaluateGates(f).hint).toBe(hint);
    const out = new FaceEngine().step(f);
    expect(out.hint).toBe(hint);
    expect(out.state).toBe(hint === "no_face" ? "idle" : "adjusting");
  });

  it("frontal ratio bounds are inclusive and configurable", () => {
    const kp = face().keypoints;
    expect(frontalRatio(kp)).toBe(1);
    // right 50 / left 50 → yaw of +x shrinks left distance: ratio (50+x)/(50−x).
    expect(evaluateGates(frame(0, [face(GOOD_BOX, { yaw: 10 })])).hint).toBeNull(); // 1.5
    expect(evaluateGates(frame(0, [face(GOOD_BOX, { yaw: 11 })])).hint).toBe("not_frontal");
    const strict = { ...DEFAULT_ENGINE_CONFIG, frontalMax: 1.2 };
    expect(evaluateGates(frame(0, [face(GOOD_BOX, { yaw: 10 })]), strict).hint).toBe("not_frontal");
  });

  it("hint priority list is the spec order", () => {
    expect(HINT_PRIORITY).toEqual([
      "multiple_faces",
      "no_face",
      "too_far",
      "too_close",
      "off_center",
      "not_frontal",
      "too_dark",
      "too_bright",
      "blurry",
    ]);
  });
});

function toResult(d: Driver, result: unknown = { kind: "welcome" }) {
  d.untilCapture();
  d.engine.onCaptured();
  return d.engine.onResult(result, d.t);
}

describe("FaceEngine: result, cooldown and track guard", () => {
  it("shows the result for 4000 ms, then cooldown", () => {
    const d = new Driver();
    const res = toResult(d);
    expect(res).toMatchObject({ state: "result", result: { kind: "welcome" }, hint: null });
    const resultT = d.t;
    for (let i = 0; i < 99; i++) expect(d.step().state).toBe("result"); // up to resultT + 3960
    expect(d.t - resultT).toBe(3960);
    expect(d.step().state).toBe("cooldown"); // resultT + 4000
  });

  it("does not rescan the same track until 20 s after its result", () => {
    const d = new Driver();
    toResult(d);
    const resultT = d.t;
    const track = d.outs.at(-1)?.trackId;
    // Person keeps standing there: never holds again inside the guard.
    while (d.t - resultT < 20_000 - DT) {
      const out = d.step();
      expect(["result", "cooldown"]).toContain(out.state);
      expect(out.trackId).toBe(track);
    }
    // Guard lifts at 20 s: the same track is scanned afresh.
    expect(d.step().state).toBe("adjusting");
    expect(d.untilCapture()).toBe(11 + 800 / DT);
  });

  it("a short absence (< 1.5 s) keeps the track and the guard", () => {
    const d = new Driver();
    toResult(d);
    const track = d.outs.at(-1)?.trackId;
    d.steps(150); // 6 s: past result + cooldown
    expect(d.outs.at(-1)?.state).toBe("cooldown");
    d.wait(1000);
    const back = d.steps(30);
    expect(back).toMatchObject({ state: "cooldown", trackId: track });
  });

  it("a new track after ≥ 1.5 s absence is scanned", () => {
    const d = new Driver();
    toResult(d);
    const track = d.outs.at(-1)?.trackId ?? 0;
    d.steps(150); // result → cooldown
    d.steps(10, []); // walks away (400 ms of empty frames)
    d.wait(1200); // total absence 1.6 s
    const back = d.step();
    expect(back.trackId).toBe(track + 1);
    expect(back.events).toContainEqual(expect.objectContaining({ type: "track", trackId: track + 1 }));
    expect(back.state).toBe("adjusting");
    expect(d.untilCapture()).toBe(11 + 800 / DT);
  });

  it("a different person (IoU < 0.3) is a new track and is scanned right after cooldown", () => {
    const d = new Driver();
    toResult(d);
    const track = d.outs.at(-1)?.trackId ?? 0;
    d.steps(150); // guarded: still cooldown
    expect(d.outs.at(-1)?.state).toBe("cooldown");
    const other = d.step([face(shift(GOOD_BOX, 200))]); // IoU 0.13 with the previous box
    expect(other.trackId).toBe(track + 1);
    expect(other.state).toBe("adjusting");
    expect(d.untilCapture([face(shift(GOOD_BOX, 200))])).toBe(11 + 800 / DT);
  });
});

describe("FaceEngine: overrides", () => {
  it("offline overrides every state and drops the scan in flight", () => {
    const d = new Driver();
    d.steps(15);
    expect(d.outs.at(-1)?.state).toBe("holding");
    expect(d.engine.setOffline(true).state).toBe("offline");
    expect(d.steps(40).state).toBe("offline");
    expect(d.states().slice(-40).every((s) => s === "offline")).toBe(true);
    expect(d.outs.at(-1)?.captureRequest).toBeUndefined();

    const back = d.engine.setOffline(false);
    expect(back.state).toBe("idle");
    expect(back.events).toContainEqual(expect.objectContaining({ type: "state", from: "offline", to: "idle" }));
    expect(d.step().state).toBe("adjusting");
  });

  it("offline during verifying ignores the late result", () => {
    const d = new Driver();
    d.untilCapture();
    d.engine.onCaptured();
    d.engine.setOffline(true);
    expect(d.engine.onResult({ kind: "welcome" }).state).toBe("offline");
    expect(d.engine.setOffline(false).state).toBe("idle");
    expect(d.step().state).toBe("adjusting");
  });

  it("paused overrides until resume; offline beats paused", () => {
    const d = new Driver();
    d.steps(5);
    expect(d.engine.pause().state).toBe("paused");
    expect(d.steps(40).state).toBe("paused");
    expect(d.engine.setOffline(true).state).toBe("offline");
    expect(d.engine.setOffline(false).state).toBe("paused");
    expect(d.engine.resume().state).toBe("idle");
    expect(d.steps(11).state).toBe("adjusting");
    expect(d.step().state).toBe("holding");
  });

  it("reset clears the guard", () => {
    const d = new Driver();
    toResult(d);
    d.steps(150);
    expect(d.outs.at(-1)?.state).toBe("cooldown");
    d.engine.reset();
    expect(d.step().state).toBe("adjusting");
  });
});

describe("FaceEngine: capture failure and verifying watchdog", () => {
  it("captureFailed returns to adjusting, counts the failure, and a fresh hold captures again", () => {
    const d = new Driver();
    d.untilCapture();
    const failed = d.engine.captureFailed();
    expect(failed.state).toBe("adjusting");
    expect(failed.progress).toBe(0);
    expect(failed.events).toContainEqual(expect.objectContaining({ type: "capture_failed", failures: 1 }));
    expect(d.step().state).toBe("adjusting");
    expect(d.untilCapture()).toBe(11 + 800 / DT);
    expect(d.engine.captureFailed().events).toContainEqual(expect.objectContaining({ failures: 2 }));
    // A successful capture resets the count.
    d.untilCapture();
    d.engine.onCaptured();
    d.engine.onResult({ kind: "welcome" });
    expect(d.engine.captureFailed().state).toBe("result"); // no-op outside capturing
  });

  it("a capture that never settles times out back to adjusting after captureTimeoutMs", () => {
    const d = new Driver(new FaceEngine({ captureTimeoutMs: 500 }));
    d.untilCapture();
    const capT = d.t;
    while (d.t - capT < 500 - DT) expect(d.step().state).toBe("capturing");
    const out = d.step();
    expect(out.state).toBe("adjusting");
    expect(out.events).toContainEqual(expect.objectContaining({ type: "capture_failed", failures: 1 }));
  });

  it("the verifying watchdog fires at verifyingTimeoutMs with a timeout result, then cooldown", () => {
    const d = new Driver(new FaceEngine({ verifyingTimeoutMs: 2000 }));
    d.untilCapture();
    const verifyT = d.t;
    d.engine.onCaptured();
    while (d.t - verifyT < 2000 - DT) expect(d.step().state).toBe("verifying");
    const fired = d.step();
    expect(d.t - verifyT).toBe(2000);
    expect(fired).toMatchObject({ state: "result", result: { kind: "timeout" } });
    expect(fired.events).toContainEqual(expect.objectContaining({ type: "timeout", t: d.t }));
    const resultT = d.t;
    while (d.t - resultT < DEFAULT_ENGINE_CONFIG.resultMs - DT) d.step();
    expect(d.step().state).toBe("cooldown");
  });

  it("defaults the watchdog to 12 s", () => {
    expect(DEFAULT_ENGINE_CONFIG.verifyingTimeoutMs).toBe(12_000);
    const d = new Driver();
    d.untilCapture();
    d.engine.onCaptured();
    expect(d.steps(12_000 / DT - 1).state).toBe("verifying");
    expect(d.step().result).toEqual({ kind: "timeout" });
  });

  it("a late result after the watchdog is ignored and the track is not guarded", () => {
    const d = new Driver(new FaceEngine({ verifyingTimeoutMs: 1000 }));
    d.untilCapture();
    d.engine.onCaptured();
    d.steps(1000 / DT);
    expect(d.outs.at(-1)?.result).toEqual({ kind: "timeout" });
    const late = d.engine.onResult({ kind: "welcome" }, d.t);
    expect(late).toMatchObject({ state: "result", result: { kind: "timeout" } });
    // After result + cooldown the same person is scanned again (a timeout sets no rescan guard).
    d.steps((DEFAULT_ENGINE_CONFIG.resultMs + DEFAULT_ENGINE_CONFIG.cooldownMs) / DT);
    expect(d.step().state).toBe("adjusting");
  });
});
