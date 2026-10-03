// Pure image-quality helpers for the face engine. No DOM: pixel inputs are ImageData-shaped objects.
import type { Box } from "./engine";

/** Long side of the grey downscale the sharpness and luminance gates are measured on. */
export const QUALITY_SAMPLE_SIDE = 96;

export interface PixelData {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

export function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Rec.601 luma of RGBA pixels, one value per pixel. */
export function toGray(img: PixelData): Float32Array {
  const n = img.width * img.height;
  const gray = new Float32Array(n);
  const { data } = img;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    gray[i] = 0.299 * (data[o] ?? 0) + 0.587 * (data[o + 1] ?? 0) + 0.114 * (data[o + 2] ?? 0);
  }
  return gray;
}

/** Mean luma (0–255) of an RGBA crop. */
export function luminance(img: PixelData): number {
  const n = img.width * img.height;
  if (n === 0) return 0;
  const gray = toGray(img);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += gray[i] ?? 0;
  return sum / n;
}

/** Variance of the 4-neighbour Laplacian over interior pixels; higher = sharper. 0 for images under 3×3. */
export function laplacianVariance(gray: ArrayLike<number>, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v =
        (gray[i - 1] ?? 0) + (gray[i + 1] ?? 0) + (gray[i - w] ?? 0) + (gray[i + w] ?? 0) - 4 * (gray[i] ?? 0);
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Size of a downscale whose long side is at most `side` px (never upscales). */
export function downscaleSize(w: number, h: number, side: number = QUALITY_SAMPLE_SIDE): { w: number; h: number } {
  const scale = Math.min(1, side / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** Grows `box` by `margin` × its size on every side, clamped to the frame, in whole pixels. */
export function cropWithMargin(box: Box, margin: number, frame: { width: number; height: number }): Box {
  const x1 = Math.max(0, Math.floor(box.x - box.w * margin));
  const y1 = Math.max(0, Math.floor(box.y - box.h * margin));
  const x2 = Math.min(frame.width, Math.ceil(box.x + box.w * (1 + margin)));
  const y2 = Math.min(frame.height, Math.ceil(box.y + box.h * (1 + margin)));
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}
