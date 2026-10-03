import { describe, expect, it } from "vitest";
import { cropWithMargin, downscaleSize, iou, laplacianVariance, luminance, toGray } from "./quality";

function rgba(w: number, h: number, value: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = value(x, y);
      data[o + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

/** 3×3 box blur, applied `passes` times. */
function blur(gray: Float32Array, w: number, h: number, passes: number): Float32Array {
  let src = gray;
  for (let p = 0; p < passes; p++) {
    const dst = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            sum += src[yy * w + xx] ?? 0;
            n++;
          }
        }
        dst[y * w + x] = sum / n;
      }
    }
    src = dst;
  }
  return src;
}

describe("iou", () => {
  it("is 1 for identical boxes, 0 for disjoint ones", () => {
    const a = { x: 10, y: 10, w: 100, h: 100 };
    expect(iou(a, a)).toBe(1);
    expect(iou(a, { x: 200, y: 200, w: 50, h: 50 })).toBe(0);
    expect(iou(a, { x: 110, y: 10, w: 100, h: 100 })).toBe(0); // touching edges
  });

  it("matches the analytic overlap", () => {
    // Shift by half the width: inter 50×100, union 150×100.
    expect(iou({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 0, w: 100, h: 100 })).toBeCloseTo(1 / 3);
    // Contained box: inter = small area.
    expect(iou({ x: 0, y: 0, w: 100, h: 100 }, { x: 25, y: 25, w: 50, h: 50 })).toBeCloseTo(0.25);
  });

  it("is 0 for degenerate boxes", () => {
    expect(iou({ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 0, h: 0 })).toBe(0);
  });
});

describe("luminance", () => {
  it("returns mean Rec.601 luma", () => {
    expect(luminance(rgba(8, 8, () => 0))).toBe(0);
    expect(luminance(rgba(8, 8, () => 200))).toBeCloseTo(200, 3);
    expect(luminance(rgba(8, 8, (x) => (x < 4 ? 0 : 100)))).toBeCloseTo(50, 3);
  });

  it("weights channels by Rec.601", () => {
    const red = { data: new Uint8ClampedArray([255, 0, 0, 255]), width: 1, height: 1 };
    const green = { data: new Uint8ClampedArray([0, 255, 0, 255]), width: 1, height: 1 };
    expect(luminance(red)).toBeCloseTo(76.245, 2);
    expect(luminance(green)).toBeCloseTo(149.685, 2);
  });

  it("is 0 for an empty crop", () => {
    expect(luminance({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toBe(0);
  });
});

describe("laplacianVariance", () => {
  const W = 96;
  const H = 96;
  // Checkerboard of 4-px squares: lots of edges.
  const sharp = toGray(rgba(W, H, (x, y) => ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 230 : 20)));

  it("is 0 on a flat image", () => {
    expect(laplacianVariance(new Float32Array(W * H).fill(128), W, H)).toBe(0);
  });

  it("drops sharply when the same image is blurred", () => {
    const sharpVar = laplacianVariance(sharp, W, H);
    const soft = laplacianVariance(blur(sharp, W, H, 1), W, H);
    const softer = laplacianVariance(blur(sharp, W, H, 4), W, H);
    expect(sharpVar).toBeGreaterThan(1000);
    expect(soft).toBeLessThan(sharpVar / 2);
    expect(softer).toBeLessThan(soft);
    expect(softer).toBeLessThan(sharpVar / 20);
  });

  it("returns 0 for images smaller than the kernel", () => {
    expect(laplacianVariance([1, 2, 3, 4], 2, 2)).toBe(0);
  });
});

describe("downscaleSize", () => {
  it("fits the long side into 96 px by default and never upscales", () => {
    expect(downscaleSize(260, 324)).toEqual({ w: 77, h: 96 });
    expect(downscaleSize(1280, 720, 720)).toEqual({ w: 720, h: 405 });
    expect(downscaleSize(50, 40)).toEqual({ w: 50, h: 40 });
  });
});

describe("cropWithMargin", () => {
  const frame = { width: 1280, height: 720 };

  it("grows the box by the margin on every side", () => {
    expect(cropWithMargin({ x: 500, y: 200, w: 200, h: 250 }, 0.4, frame)).toEqual({ x: 420, y: 100, w: 360, h: 450 });
  });

  it("clamps to the frame", () => {
    expect(cropWithMargin({ x: 10, y: 10, w: 200, h: 250 }, 0.4, frame)).toEqual({ x: 0, y: 0, w: 290, h: 360 });
    expect(cropWithMargin({ x: 1150, y: 500, w: 120, h: 200 }, 0.4, frame)).toEqual({
      x: 1102,
      y: 420,
      w: 178,
      h: 300,
    });
  });
});
