// Lazy MediaPipe BlazeFace (short-range) loader, for the page or the door's detection worker. `@mediapipe/tasks-vision` is only reached through the dynamic
// import below, so it lands in its own chunk and stays out of first-load JS. Wasm + model are self-hosted under
// /mediapipe (see scripts/copy-mediapipe.mjs) so the kiosk works without third-party CDNs.
import type { FaceDetector as MpFaceDetector, FaceDetectorResult } from "@mediapipe/tasks-vision";
import type { FaceDetection, FaceKeypoints, Point } from "./engine";

export const MEDIAPIPE_WASM_PATH = "/mediapipe/wasm";
export const BLAZE_FACE_MODEL_PATH = "/mediapipe/blaze_face_short_range.tflite";

export type DetectorDelegate = "GPU" | "CPU";

/** Anything the detector can read pixels from: a video frame, an ImageBitmap or a (offscreen) canvas. */
export type DetectorSource = HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas | ImageBitmap;

export interface FaceDetectorHandle {
  readonly delegate: DetectorDelegate;
  /** Detects faces in one still image (`width`×`height` px); boxes and keypoints come back in its pixels. */
  detect(image: DetectorSource, width: number, height: number): FaceDetection[];
  close(): void;
}

const KEYPOINT_ORDER = ["rightEye", "leftEye", "noseTip", "mouth", "rightEar", "leftEar"] as const;

/** Maps a MediaPipe result (pixel boxes, normalised keypoints) to engine detections in pixel coordinates. */
export function toEngineDetections(result: FaceDetectorResult, width: number, height: number): FaceDetection[] {
  const out: FaceDetection[] = [];
  for (const d of result.detections) {
    const bb = d.boundingBox;
    if (!bb || d.keypoints.length < KEYPOINT_ORDER.length) continue;
    const keypoints = {} as Record<keyof FaceKeypoints, Point>;
    KEYPOINT_ORDER.forEach((name, i) => {
      const kp = d.keypoints[i];
      keypoints[name] = { x: (kp?.x ?? 0) * width, y: (kp?.y ?? 0) * height };
    });
    out.push({
      score: d.categories[0]?.score ?? 0,
      box: { x: bb.originX, y: bb.originY, w: bb.width, h: bb.height },
      keypoints,
    });
  }
  return out;
}

let loading: Promise<FaceDetectorHandle> | null = null;

/**
 * Loads (once per realm: the page or the detection worker) and returns the shared detector, trying the GPU delegate
 * first and falling back to CPU. IMAGE mode: the door runs it on several crops of each frame (see live/passes.ts).
 */
export function loadFaceDetector(base = ""): Promise<FaceDetectorHandle> {
  loading ??= create(base).catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}

async function create(base: string): Promise<FaceDetectorHandle> {
  const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(`${base}${MEDIAPIPE_WASM_PATH}`);
  const make = (delegate: DetectorDelegate) =>
    FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}${BLAZE_FACE_MODEL_PATH}`, delegate },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.55,
    });

  let detector: MpFaceDetector;
  let delegate: DetectorDelegate = "GPU";
  try {
    detector = await make("GPU");
  } catch {
    delegate = "CPU";
    detector = await make("CPU");
  }

  return {
    delegate,
    detect(image, width, height) {
      return toEngineDetections(detector.detect(image), width, height);
    },
    close() {
      detector.close();
      loading = null;
    },
  };
}
