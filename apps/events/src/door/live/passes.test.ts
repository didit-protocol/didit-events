import { describe, expect, it } from "vitest";
import type { FaceDetection } from "../face/engine";
import { mergeDetections, passCanvasSize, planPasses, roiFor, sweepTiles, toFrame, touchesInnerEdge } from "./passes";

const HD = { width: 1280, height: 720 };
const det = (x: number, y: number, w: number, score = 0.9): FaceDetection => {
  const p = { x: x + w / 2, y: y + w / 2 };
  return { score, box: { x, y, w, h: w }, keypoints: { rightEye: p, leftEye: p, noseTip: p, mouth: p, rightEar: p, leftEar: p } };
};

describe("detection passes", () => {
  it("sweeps the whole 720p frame with overlapping tiles at two scales, small enough for a 50-px face", () => {
    const tiles = sweepTiles(HD);
    const small = tiles.filter((t) => t.w === 320);
    expect(small.length).toBeGreaterThanOrEqual(12);
    // Every point of the frame is inside some small tile, and each tile stays inside the frame.
    for (let x = 0; x < 1280; x += 37) for (let y = 0; y < 720; y += 41) expect(small.some((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h)).toBe(true);
    for (const t of tiles) expect(t.x >= 0 && t.y >= 0 && t.x + t.w <= 1280 && t.y + t.h <= 720).toBe(true);
    // A 50-px face fills ≥ 15 % of a small tile: within BlazeFace short-range's working size.
    expect(50 / 320).toBeGreaterThanOrEqual(0.15);
  });

  it("plans the full frame, a window per small tracked face, then the next two sweep tiles", () => {
    const tiles = sweepTiles(HD);
    const plan = planPasses(HD, [{ x: 100, y: 100, w: 50, h: 60 }, { x: 600, y: 300, w: 400, h: 480 }], 0);
    expect(plan.rects[0]).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    expect(plan.rects).toHaveLength(1 + 1 + 2); // the big face needs no window
    expect(plan.rects.slice(2)).toEqual(tiles.slice(0, 2));
    expect(plan.cursor).toBe(2);
    // The sweep wraps around.
    expect(planPasses(HD, [], tiles.length - 1).rects.slice(1)).toEqual([tiles[tiles.length - 1], tiles[0]]);
  });

  it("windows stay inside the frame and are at least 192 px", () => {
    expect(roiFor({ x: 2, y: 3, w: 30, h: 36 }, HD)).toEqual({ x: 0, y: 0, w: 192, h: 192 });
    expect(roiFor({ x: 1250, y: 690, w: 30, h: 30 }, HD)).toEqual({ x: 1088, y: 528, w: 192, h: 192 });
    expect(roiFor({ x: 500, y: 300, w: 100, h: 120 }, HD).w).toBe(400);
  });

  it("maps a pass detection back to camera px and draws passes at most 320 px", () => {
    expect(passCanvasSize({ x: 0, y: 0, w: 1280, h: 720 })).toEqual({ w: 320, h: 180 });
    expect(passCanvasSize({ x: 0, y: 0, w: 192, h: 192 })).toEqual({ w: 192, h: 192 });
    const mapped = toFrame(det(10, 20, 30), { x: 640, y: 320, w: 640, h: 400 }, { w: 320, h: 200 });
    expect(mapped.box).toEqual({ x: 660, y: 360, w: 60, h: 60 });
    expect(mapped.keypoints.noseTip).toEqual({ x: 690, y: 390 });
  });

  it("merges one face seen by several passes, prefers whole faces over tile-cut ones", () => {
    const whole = det(100, 100, 60, 0.8), dup = det(103, 98, 58, 0.95), cut = { ...det(98, 100, 40, 0.99), partial: true }, other = det(400, 100, 60);
    const merged = mergeDetections([cut, whole, dup, other]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.score).toBe(0.95);
    expect(merged.some((d) => d.box.x === 400)).toBe(true);
  });

  it("knows when a box touches a tile edge inside the frame (not the frame border)", () => {
    const tile = { x: 320, y: 0, w: 320, h: 320 };
    expect(touchesInnerEdge({ x: 321, y: 50, w: 40, h: 40 }, tile, HD)).toBe(true);
    expect(touchesInnerEdge({ x: 400, y: 0, w: 40, h: 40 }, tile, HD)).toBe(false);
    expect(touchesInnerEdge({ x: 400, y: 50, w: 40, h: 40 }, tile, HD)).toBe(false);
  });
});
