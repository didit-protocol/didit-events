import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toEngineDetections } from "./detector";

describe("toEngineDetections", () => {
  it("maps MediaPipe boxes and normalised keypoints to pixel detections", () => {
    const kps = [
      [0.45, 0.4],
      [0.55, 0.4],
      [0.5, 0.5],
      [0.5, 0.6],
      [0.4, 0.42],
      [0.6, 0.42],
    ].map(([x, y]) => ({ x: x ?? 0, y: y ?? 0 }));
    const out = toEngineDetections(
      {
        detections: [
          {
            categories: [{ score: 0.93, index: 0, categoryName: "", displayName: "" }],
            boundingBox: { originX: 500, originY: 200, width: 260, height: 300, angle: 0 },
            keypoints: kps,
          },
          { categories: [], keypoints: [] }, // no box: skipped
        ],
      },
      1280,
      720,
    );
    expect(out).toEqual([
      {
        score: 0.93,
        box: { x: 500, y: 200, w: 260, h: 300 },
        keypoints: {
          rightEye: { x: 576, y: 288 },
          leftEye: { x: 704, y: 288 },
          noseTip: { x: 640, y: 360 },
          mouth: { x: 640, y: 432 },
          rightEar: { x: 512, y: 302.4 },
          leftEar: { x: 768, y: 302.4 },
        },
      },
    ]);
  });

  it("reaches @mediapipe/tasks-vision only through a dynamic import", () => {
    const src = readFileSync(new URL("./detector.ts", import.meta.url), "utf8");
    expect(src).toMatch(/await import\("@mediapipe\/tasks-vision"\)/);
    expect(src).not.toMatch(/^import (?!type)[^;]*@mediapipe/m);
  });
});
