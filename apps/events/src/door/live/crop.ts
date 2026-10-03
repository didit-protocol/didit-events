// Geometry between the camera frame, the recognition crop and the mirrored, cover-fitted preview.
import type { Box } from "../face/engine";

export interface Size {
  width: number;
  height: number;
}

export interface CropOptions {
  /** Context around the face, × its size on every side (shrunk when another face is near). */
  margin: number;
  /** Never shrink the context below this × the face size. */
  minMargin: number;
  /** Small faces are upsampled so the crop's long side is at least this (the matcher's practical minimum)… */
  minSide: number;
  /** …and large ones downscaled to at most this. */
  maxSide: number;
}

export const DEFAULT_CROP: Readonly<CropOptions> = Object.freeze({ margin: 0.5, minMargin: 0.12, minSide: 320, maxSide: 640 });

export interface RecognitionCrop {
  /** Source rectangle in camera px. */
  source: Box;
  /** Output size of the JPEG. */
  width: number;
  height: number;
  /** Output px per camera px (> 1 = upsampled). */
  scale: number;
}

const overlapArea = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * The crop sent to the scan API for `face`: the face plus margin, clamped to the frame, pulled back from every other
 * tracked face so the crop holds ONE face (the server rejects multi-face crops), then scaled to [minSide, maxSide].
 * Null when another face cannot be kept out (two heads touching): the door waits for them to separate.
 */
export function recognitionCrop(face: Box, others: readonly Box[], frame: Size, options: Partial<CropOptions> = {}): RecognitionCrop | null {
  const o = { ...DEFAULT_CROP, ...options };
  let x1 = Math.max(0, face.x - face.w * o.margin), y1 = Math.max(0, face.y - face.h * o.margin);
  let x2 = Math.min(frame.width, face.x + face.w * (1 + o.margin)), y2 = Math.min(frame.height, face.y + face.h * (1 + o.margin));
  const minL = Math.max(0, face.x - face.w * o.minMargin), minT = Math.max(0, face.y - face.h * o.minMargin);
  const minR = Math.min(frame.width, face.x + face.w * (1 + o.minMargin)), minB = Math.min(frame.height, face.y + face.h * (1 + o.minMargin));
  for (const other of others) {
    if (overlapArea({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, other) <= 0) continue;
    // Pull back the side facing the other face, on the axis where they are further apart.
    const dx = other.x + other.w / 2 - (face.x + face.w / 2), dy = other.y + other.h / 2 - (face.y + face.h / 2);
    if (Math.abs(dx) / (face.w + other.w) >= Math.abs(dy) / (face.h + other.h)) {
      if (dx > 0) x2 = Math.max(minR, Math.min(x2, other.x));
      else x1 = Math.min(minL, Math.max(x1, other.x + other.w));
    } else if (dy > 0) y2 = Math.max(minB, Math.min(y2, other.y));
    else y1 = Math.min(minT, Math.max(y1, other.y + other.h));
  }
  const source = { x: Math.floor(x1), y: Math.floor(y1), w: Math.ceil(x2) - Math.floor(x1), h: Math.ceil(y2) - Math.floor(y1) };
  if (source.w <= 0 || source.h <= 0) return null;
  // Whatever is left of another face must be a sliver, not a second face for the matcher.
  if (others.some((other) => overlapArea(source, other) > 0.2 * other.w * other.h)) return null;
  const long = Math.max(source.w, source.h);
  const scale = long < o.minSide ? o.minSide / long : long > o.maxSide ? o.maxSide / long : 1;
  return { source, width: Math.max(1, Math.round(source.w * scale)), height: Math.max(1, Math.round(source.h * scale)), scale };
}

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Maps a camera-px box to the preview: the video is `object-fit: cover` in a `view`-sized box and, with `mirror`,
 * flipped horizontally (CSS scaleX(-1)), so the overlay boxes sit on the faces people see.
 */
export function toDisplay(box: Box, frame: Size, view: Viewport, mirror: boolean): Box {
  const scale = Math.max(view.width / Math.max(1, frame.width), view.height / Math.max(1, frame.height));
  const ox = (view.width - frame.width * scale) / 2, oy = (view.height - frame.height * scale) / 2;
  const w = box.w * scale, h = box.h * scale, y = box.y * scale + oy;
  const x = box.x * scale + ox;
  return { x: mirror ? view.width - x - w : x, y, w, h };
}
