import { describe, expect, it } from "vitest";
import { normalizeLight, type RgbaImage } from "./light";

/** A w×h crop whose grey level ramps from `from` to `to` (a face-like gradient), tinted like skin. */
function ramp(from: number, to: number, w = 64, h = 64): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = from + ((to - from) * (i % w)) / (w - 1);
    data.set([v * 1.1, v, v * 0.85, 255], i * 4);
  }
  return { data, width: w, height: h };
}

describe("door crop low light", () => {
  it("leaves a well-lit crop untouched", () => {
    const img = ramp(60, 220), copy = img.data.slice();
    const result = normalizeLight(img);
    expect(result).toMatchObject({ adjusted: false, tooDark: false });
    expect(img.data).toEqual(copy);
  });
  it("brightens a dim crop to about the target and keeps it scannable", () => {
    const img = ramp(25, 110);
    const result = normalizeLight(img);
    expect(result.before).toBeLessThan(80);
    expect(result).toMatchObject({ adjusted: true, tooDark: false });
    expect(result.after).toBeGreaterThan(110);
    expect(result.after).toBeLessThan(135);
    // Hue survives: red stays above green above blue on a mid pixel.
    const o = (32 * 64 + 32) * 4;
    expect(img.data[o]!).toBeGreaterThanOrEqual(img.data[o + 1]!);
    expect(img.data[o + 1]!).toBeGreaterThan(img.data[o + 2]!);
  });
  it.each([
    ["a near-black crop", ramp(0, 30)],
    ["a flat dark crop (only noise to stretch)", ramp(40, 55)],
  ] as const)("refuses %s without touching it", (_name, img) => {
    const copy = img.data.slice();
    expect(normalizeLight(img)).toMatchObject({ tooDark: true, adjusted: false });
    expect(img.data).toEqual(copy);
  });
  it("an empty crop is not refused for light", () => {
    expect(normalizeLight({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toMatchObject({ tooDark: false, adjusted: false });
  });
});
