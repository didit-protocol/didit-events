import { describe, expect, it } from "vitest";
import type { Box, FaceDetection } from "../face/engine";
import { FaceTracker, predictBox } from "./tracker";

const face = (x: number, y: number, w = 100, score = 0.9): FaceDetection => {
  const box: Box = { x, y, w, h: w * 1.2 };
  const p = (fx: number, fy: number) => ({ x: x + w * fx, y: y + w * 1.2 * fy });
  return { score, box, keypoints: { rightEye: p(0.3, 0.35), leftEye: p(0.7, 0.35), noseTip: p(0.5, 0.55), mouth: p(0.5, 0.75), rightEar: p(0.05, 0.4), leftEar: p(0.95, 0.4) } };
};

describe("FaceTracker", () => {
  it("keeps one id per face while it moves, and counts its detected streak", () => {
    const tracker = new FaceTracker();
    let tracks = tracker.update([face(100, 100)], 0);
    const id = tracks[0]!.id;
    for (let i = 1; i <= 10; i++) tracks = tracker.update([face(100 + i * 12, 100 + i * 4)], i * 50);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ id, hits: 11, streak: 11 });
    // Velocity is learnt: ~12 px per 50 ms.
    expect(tracks[0]!.vx).toBeGreaterThan(0.15);
  });

  it("keeps two faces apart and stable when they move past each other vertically offset", () => {
    const tracker = new FaceTracker();
    let tracks = tracker.update([face(100, 100), face(600, 300)], 0);
    const [a, b] = tracks.map((t) => t.id);
    for (let i = 1; i <= 8; i++) tracks = tracker.update([face(100 + i * 30, 100), face(600 - i * 30, 300)], i * 40);
    const byId = new Map(tracks.map((t) => [t.id, t]));
    expect(byId.get(a!)!.box.x).toBe(340);
    expect(byId.get(b!)!.box.x).toBe(360);
  });

  it("coasts through a short miss with the same id, then drops the track after 0.8 s; the face comes back as a new id", () => {
    const tracker = new FaceTracker();
    const first = tracker.update([face(200, 200)], 0)[0]!.id;
    tracker.update([face(210, 200)], 50);
    expect(tracker.update([], 300)).toHaveLength(1);
    expect(tracker.update([face(230, 200)], 500)[0]).toMatchObject({ id: first, streak: 1 });
    expect(tracker.update([], 1200)).toHaveLength(1);
    expect(tracker.update([], 1301)).toHaveLength(0);
    const again = tracker.update([face(230, 200)], 1400)[0]!;
    expect(again.id).not.toBe(first);
  });

  it("tracks at most 6 faces, the largest ones", () => {
    const tracker = new FaceTracker();
    const faces = Array.from({ length: 9 }, (_, i) => face(i * 140, 50, 40 + i * 5));
    const tracks = tracker.update(faces, 0);
    expect(tracks).toHaveLength(6);
    expect(Math.min(...tracks.map((t) => t.box.w))).toBe(55);
  });

  it("does not hand a track to a much bigger face at the same spot (someone stepping in front)", () => {
    const tracker = new FaceTracker();
    const far = tracker.update([face(500, 200, 50)], 0)[0]!.id;
    const tracks = tracker.update([face(470, 170, 160)], 40);
    expect(tracks.find((t) => t.box.w === 160)!.id).not.toBe(far);
  });

  it("predicts a coasting box from its velocity, capped at 300 ms", () => {
    const box = { x: 0, y: 0, w: 10, h: 10 };
    expect(predictBox({ box, vx: 1, vy: 0.5, lastSeen: 0 }, 100)).toEqual({ x: 100, y: 50, w: 10, h: 10 });
    expect(predictBox({ box, vx: 1, vy: 0, lastSeen: 0 }, 1000).x).toBe(300);
  });
});
