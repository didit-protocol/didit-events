import { describe, expect, it } from "vitest";
import { recognitionCrop, toDisplay } from "./crop";

const HD = { width: 1280, height: 720 };

describe("recognition crop", () => {
  it("adds a 50 % margin and keeps a mid-size face at native resolution", () => {
    const crop = recognitionCrop({ x: 500, y: 200, w: 200, h: 240 }, [], HD)!;
    expect(crop.source).toEqual({ x: 400, y: 80, w: 400, h: 480 });
    expect(crop).toMatchObject({ width: 400, height: 480, scale: 1 });
  });

  it("upsamples a far (50 px) face to the matcher's minimum and clamps the margin at the frame edge", () => {
    const crop = recognitionCrop({ x: 10, y: 600, w: 50, h: 60 }, [], HD)!;
    expect(crop.source).toEqual({ x: 0, y: 570, w: 85, h: 120 });
    expect(crop.scale).toBeCloseTo(320 / 120);
    expect(crop).toMatchObject({ width: 227, height: 320 });
  });

  it("downscales a face close to the camera to at most 640 px", () => {
    const crop = recognitionCrop({ x: 300, y: 50, w: 500, h: 600 }, [], HD)!;
    expect(Math.max(crop.width, crop.height)).toBe(640);
    expect(crop.scale).toBeLessThan(1);
  });

  it("pulls the margin back from a neighbour so the crop holds one face", () => {
    const me = { x: 400, y: 200, w: 100, h: 120 }, right = { x: 530, y: 210, w: 100, h: 120 }, below = { x: 380, y: 420, w: 120, h: 140 };
    const crop = recognitionCrop(me, [right, below], HD)!;
    expect(crop.source.x + crop.source.w).toBeLessThanOrEqual(530);
    expect(crop.source.y + crop.source.h).toBeLessThanOrEqual(420);
    expect(crop.source.x).toBe(350);
    // A neighbour on the left pulls back the left side.
    const left = recognitionCrop(me, [{ x: 280, y: 200, w: 100, h: 120 }], HD)!;
    expect(left.source.x).toBeGreaterThanOrEqual(380);
  });

  it("refuses a crop when two heads touch (the server would see two faces)", () => {
    expect(recognitionCrop({ x: 400, y: 200, w: 100, h: 120 }, [{ x: 450, y: 210, w: 100, h: 120 }], HD)).toBeNull();
  });
});

describe("display mapping", () => {
  const view = { width: 1920, height: 1080 };
  it("scales a 16:9 frame to a 16:9 stage", () => {
    expect(toDisplay({ x: 100, y: 100, w: 200, h: 200 }, HD, view, false)).toEqual({ x: 150, y: 150, w: 300, h: 300 });
  });
  it("mirrors horizontally when the preview is mirrored", () => {
    expect(toDisplay({ x: 100, y: 100, w: 200, h: 200 }, HD, view, true)).toEqual({ x: 1920 - 150 - 300, y: 150, w: 300, h: 300 });
  });
  it("accounts for object-fit: cover cropping on a portrait stage", () => {
    const portrait = { width: 1080, height: 1920 };
    // scale = 1920/720 = 2.667; the frame is 3413 px wide, centred: offset −1166.7.
    const box = toDisplay({ x: 640 - 50, y: 360 - 50, w: 100, h: 100 }, HD, portrait, false);
    expect(box.x + box.w / 2).toBeCloseTo(540);
    expect(box.y + box.h / 2).toBeCloseTo(960);
    expect(box.w).toBeCloseTo(266.67, 1);
    const mirrored = toDisplay({ x: 700, y: 300, w: 100, h: 100 }, HD, portrait, true);
    expect(mirrored.x + mirrored.w / 2).toBeCloseTo(540 - 110 * (1920 / 720));
  });
});
