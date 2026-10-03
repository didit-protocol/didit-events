// Runs one frame's detection passes (live/passes.ts) through a still-image detector: each pass rectangle is drawn
// into a small canvas, detected, mapped back to camera px, and the passes are merged. Shared by the detection
// worker and the main-thread fallback (which stops early when a frame's time budget is spent).
import type { FaceDetection } from "../face/engine";
import type { DetectorSource, FaceDetectorHandle } from "../face/detector";
import { mergeDetections, passCanvasSize, toFrame, touchesInnerEdge, type Frame } from "./passes";
import type { Box } from "../face/engine";

type Canvas2D = HTMLCanvasElement | OffscreenCanvas;
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface PassRun {
  detections: FaceDetection[];
  /** Passes actually run (the main thread may skip the last sweep tiles). */
  passes: number;
  ms: number;
}

export function runPasses(
  detector: Pick<FaceDetectorHandle, "detect">,
  source: DetectorSource,
  frame: Frame,
  rects: readonly Box[],
  canvas: Canvas2D,
  budgetMs = Infinity,
  now: () => number = () => performance.now(),
): PassRun {
  const started = now();
  const ctx = canvas.getContext("2d") as Context2D | null;
  const found: Array<FaceDetection & { partial?: boolean }> = [];
  let passes = 0;
  for (const rect of rects) {
    // The full frame always runs; later passes only while the budget lasts.
    if (passes > 0 && now() - started > budgetMs) break;
    const size = passCanvasSize(rect);
    if (!ctx) break;
    if (canvas.width !== size.w) canvas.width = size.w;
    if (canvas.height !== size.h) canvas.height = size.h;
    ctx.drawImage(source as CanvasImageSource, rect.x, rect.y, rect.w, rect.h, 0, 0, size.w, size.h);
    const full = rect.x === 0 && rect.y === 0 && rect.w === frame.width && rect.h === frame.height;
    for (const d of detector.detect(canvas, size.w, size.h)) {
      const mapped = toFrame(d, rect, size);
      found.push(full ? mapped : { ...mapped, partial: touchesInnerEdge(mapped.box, rect, frame) });
    }
    passes++;
  }
  return { detections: mergeDetections(found), passes, ms: now() - started };
}
