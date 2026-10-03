import { describe, expect, it } from "vitest";
import { FpsMeter, frameIntervalMs, LatencyStats, percentile } from "./metrics";
import { frontal, readiness, type FaceSample } from "./readiness";

const keypoints = (yaw = 0) => ({
  rightEye: { x: 130 + yaw, y: 140 }, leftEye: { x: 170 + yaw, y: 140 }, noseTip: { x: 150 + yaw * 2, y: 160 },
  mouth: { x: 150, y: 180 }, rightEar: { x: 105, y: 145 }, leftEar: { x: 195, y: 145 },
});
const sample = (extra: Partial<FaceSample> = {}): FaceSample => ({
  box: { x: 100, y: 100, w: 100, h: 120 }, keypoints: keypoints(), streak: 5, vx: 0, vy: 0, luminance: 120, sharpness: 80, frameLuminance: 120, ...extra,
});

describe("face readiness", () => {
  it("a steady, frontal, sharp, lit face is ready", () => {
    expect(readiness(sample())).toEqual({ ready: true, guidance: null });
  });
  it("waits for 3 frames, a minimum size, a frontal pose, sharpness and slow motion", () => {
    expect(readiness(sample({ streak: 2 })).ready).toBe(false);
    expect(readiness(sample({ box: { x: 0, y: 0, w: 30, h: 36 } }))).toEqual({ ready: false, guidance: "too_far" });
    expect(readiness(sample({ keypoints: keypoints(18) })).ready).toBe(false);
    expect(readiness(sample({ sharpness: 5 })).ready).toBe(false);
    expect(readiness(sample({ vx: 0.5 })).ready).toBe(false); // 50 px per 100 ms on a 100-px face: motion blur
  });
  it("guides a dark or backlit face", () => {
    expect(readiness(sample({ luminance: 30 })).guidance).toBe("too_dark");
    expect(readiness(sample({ luminance: 70, frameLuminance: 200 })).guidance).toBe("backlit");
  });
  it("frontal ratio", () => {
    expect(frontal(keypoints())).toBe(true);
    expect(frontal(keypoints(25))).toBe(false);
  });
});

describe("door metrics", () => {
  it("fps over a sliding second", () => {
    const m = new FpsMeter();
    for (let t = 0; t <= 2000; t += 50) m.tick(t);
    expect(m.fps(2000)).toBe(21);
  });
  it("latency p50/p95 over the last samples", () => {
    const s = new LatencyStats(100);
    for (let i = 1; i <= 100; i++) s.add(i * 10);
    s.add(Number.NaN);
    expect(s.summary()).toEqual({ p50: 500, p95: 950, n: 100 });
    expect(percentile([], 50)).toBe(0);
  });
  it("adaptive frame rate", () => {
    expect(frameIntervalMs({ hidden: false, lowBattery: false, slowDetector: false })).toBe(33);
    expect(frameIntervalMs({ hidden: false, lowBattery: true, slowDetector: false })).toBe(100);
    expect(frameIntervalMs({ hidden: true, lowBattery: false, slowDetector: false })).toBe(1000);
  });
});
