// The detection pyramid. BlazeFace short-range sees a face reliably when it fills a decent part of its 128-px input,
// so one full-frame pass only finds people near the door. To find faces ~50 px wide in a 1280×720 stream (3–4 m),
// each frame also runs the detector on (a) a window around every small tracked face, and (b) two tiles of a
// rotating sweep over the frame at two scales; a new far face is found within one sweep (~9 frames) and is then
// followed by its own window every frame. Pure: rectangles in, rectangles out.
import type { Box, FaceDetection } from "../face/engine";
import { iou } from "../face/quality";

export interface Frame {
  width: number;
  height: number;
}

export interface PassPlanOptions {
  /** Sweep tiles run per frame. */
  tilesPerFrame: number;
  /** Tracked faces narrower than this (camera px) get their own window. */
  roiBelowPx: number;
  maxRois: number;
}

export const DEFAULT_PASS_OPTIONS: Readonly<PassPlanOptions> = Object.freeze({ tilesPerFrame: 2, roiBelowPx: 180, maxRois: 6 });
/** Long side of the canvas a pass is drawn into before detection (the model's input is 128 px). */
export const PASS_SIDE = 320;

function positions(length: number, size: number, stride: number): number[] {
  if (size >= length) return [0];
  const out: number[] = [];
  for (let p = 0; p + size < length; p += stride) out.push(p);
  out.push(length - size);
  return [...new Set(out.map(Math.round))];
}

/** The sweep: square tiles of ~half the short side, then ~quarter-width tiles, each overlapping its neighbours by 25 %. */
export function sweepTiles(frame: Frame): Box[] {
  const short = Math.min(frame.width, frame.height);
  const tiles: Box[] = [];
  for (const size of [Math.round(short * 0.9), Math.round(frame.width / 4)]) {
    const stride = Math.round(size * 0.75);
    for (const y of positions(frame.height, size, stride)) for (const x of positions(frame.width, size, stride)) tiles.push({ x, y, w: Math.min(size, frame.width), h: Math.min(size, frame.height) });
  }
  return tiles;
}

/** A square window around a small face (4× its width, 192–640 px), shifted to stay inside the frame. */
export function roiFor(box: Box, frame: Frame): Box {
  const side = Math.round(Math.min(Math.max(box.w * 4, 192), 640, frame.width, frame.height));
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const x = Math.round(Math.min(Math.max(0, cx - side / 2), frame.width - side));
  const y = Math.round(Math.min(Math.max(0, cy - side / 2), frame.height - side));
  return { x, y, w: side, h: side };
}

export interface PassPlan {
  rects: Box[];
  /** Sweep position for the next frame. */
  cursor: number;
}

/** This frame's passes: the full frame first, then the small faces' windows, then the next sweep tiles. */
export function planPasses(frame: Frame, tracked: readonly Box[], cursor: number, options: Partial<PassPlanOptions> = {}): PassPlan {
  const o = { ...DEFAULT_PASS_OPTIONS, ...options };
  const rects: Box[] = [{ x: 0, y: 0, w: frame.width, h: frame.height }];
  const small = tracked.filter((b) => b.w < o.roiBelowPx).sort((a, b) => a.w - b.w).slice(0, o.maxRois);
  for (const b of small) {
    const roi = roiFor(b, frame);
    // Two faces side by side share one window.
    if (!rects.slice(1).some((r) => iou(r, roi) > 0.6)) rects.push(roi);
  }
  const tiles = sweepTiles(frame);
  let next = tiles.length ? cursor % tiles.length : 0;
  for (let i = 0; i < Math.min(o.tilesPerFrame, tiles.length); i++) {
    rects.push(tiles[next]!);
    next = (next + 1) % tiles.length;
  }
  return { rects, cursor: next };
}

/** The canvas size a pass rectangle is drawn at: long side ≤ PASS_SIDE (a small window is never upscaled). */
export function passCanvasSize(rect: Box, side = PASS_SIDE): { w: number; h: number } {
  const scale = Math.min(1, side / Math.max(rect.w, rect.h, 1));
  return { w: Math.max(1, Math.round(rect.w * scale)), h: Math.max(1, Math.round(rect.h * scale)) };
}

/** Maps a detection made on a pass canvas (`canvas` px) back to camera px. */
export function toFrame(d: FaceDetection, rect: Box, canvas: { w: number; h: number }): FaceDetection {
  const sx = rect.w / canvas.w, sy = rect.h / canvas.h;
  const p = (pt: { x: number; y: number }) => ({ x: rect.x + pt.x * sx, y: rect.y + pt.y * sy });
  const k = d.keypoints;
  return {
    score: d.score,
    box: { x: rect.x + d.box.x * sx, y: rect.y + d.box.y * sy, w: d.box.w * sx, h: d.box.h * sy },
    keypoints: { rightEye: p(k.rightEye), leftEye: p(k.leftEye), noseTip: p(k.noseTip), mouth: p(k.mouth), rightEar: p(k.rightEar), leftEar: p(k.leftEar) },
  };
}

/**
 * Merges the passes' detections: one face seen by several passes (or cut by a tile edge) is kept once. A detection
 * touching its tile's inner edge is a partial face; it loses to any overlapping one.
 */
export function mergeDetections(found: ReadonlyArray<FaceDetection & { partial?: boolean }>, threshold = 0.3): FaceDetection[] {
  const ranked = [...found].sort((a, b) => Number(!!a.partial) - Number(!!b.partial) || b.score - a.score);
  const kept: FaceDetection[] = [];
  for (const d of ranked) {
    const contained = (a: Box, b: Box) => {
      const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      return (x * y) / Math.max(1, Math.min(a.w * a.h, b.w * b.h));
    };
    if (kept.some((k) => iou(k.box, d.box) > threshold || contained(k.box, d.box) > 0.7)) continue;
    const { partial: _partial, ...face } = d;
    kept.push(face);
  }
  return kept;
}

/** True when `box` touches an edge of `rect` that is inside the frame (the face may continue beyond the tile). */
export function touchesInnerEdge(box: Box, rect: Box, frame: Frame, slack = 2): boolean {
  return (rect.x > 0 && box.x <= rect.x + slack) || (rect.y > 0 && box.y <= rect.y + slack) ||
    (rect.x + rect.w < frame.width && box.x + box.w >= rect.x + rect.w - slack) || (rect.y + rect.h < frame.height && box.y + box.h >= rect.y + rect.h - slack);
}
