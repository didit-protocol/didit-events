// The door's detection worker: MediaPipe BlazeFace runs here, off the main thread, on an ImageBitmap of each camera
// frame. Protocol: `init` → `ready` | `failed`; `detect` (bitmap transferred) → `result`.
import { loadFaceDetector, type FaceDetectorHandle } from "../face/detector";
import type { Box } from "../face/engine";
import { runPasses } from "./detect-core";
import type { Frame } from "./passes";

export type WorkerRequest =
  | { type: "init"; origin: string }
  | { type: "detect"; id: number; bitmap: ImageBitmap; frame: Frame; rects: Box[] };
export type WorkerReply =
  | { type: "ready"; delegate: string }
  | { type: "failed"; error: string }
  | { type: "result"; id: number; detections: ReturnType<typeof runPasses>["detections"]; passes: number; ms: number };

interface WorkerScope {
  postMessage(message: WorkerReply): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void): void;
  import?: (url: string) => Promise<void>;
}
const scope = globalThis as unknown as WorkerScope;

// MediaPipe loads its classic wasm loader with importScripts, which a module worker refuses; it then calls
// `self.import`. The loader is a classic script that declares a global `ModuleFactory`, so it runs as global code
// (indirect eval) rather than as a module (where the declaration would stay module-scoped).
scope.import = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MediaPipe loader: HTTP ${res.status}`);
  const code = await res.text();
  (0, eval)(code);
};

let detector: FaceDetectorHandle | null = null;
let canvas: OffscreenCanvas | null = null;

scope.addEventListener("message", (event) => {
  const m = event.data;
  if (m.type === "init") {
    loadFaceDetector(m.origin).then(
      (d) => {
        detector = d;
        canvas = new OffscreenCanvas(1, 1);
        scope.postMessage({ type: "ready", delegate: d.delegate });
      },
      (error: unknown) => scope.postMessage({ type: "failed", error: String(error) }),
    );
    return;
  }
  if (m.type === "detect") {
    try {
      if (!detector || !canvas) {
        scope.postMessage({ type: "result", id: m.id, detections: [], passes: 0, ms: 0 });
        return;
      }
      const run = runPasses(detector, m.bitmap, m.frame, m.rects, canvas);
      scope.postMessage({ type: "result", id: m.id, ...run });
    } finally {
      m.bitmap.close();
    }
  }
});
