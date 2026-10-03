// The page side of detection: a Web Worker when the browser can run one (OffscreenCanvas + createImageBitmap),
// the main thread otherwise. On the main thread a frame's passes stop after MAIN_THREAD_BUDGET_MS so a frame never
// blocks the page for longer than one display frame (the sweep just advances more slowly).
import type { FaceDetection, Box } from "../face/engine";
import type { DetectorDelegate } from "../face/detector";
import type { Frame } from "./passes";
import type { WorkerReply, WorkerRequest } from "./detect.worker";

export const MAIN_THREAD_BUDGET_MS = 12;
export const WORKER_READY_TIMEOUT_MS = 15_000;

export interface PassDetector {
  readonly mode: "worker" | "main";
  readonly delegate: DetectorDelegate | string;
  detect(video: HTMLVideoElement, frame: Frame, rects: Box[]): Promise<{ detections: FaceDetection[]; passes: number; ms: number }>;
  close(): void;
}

export function workerSupported(scope: Partial<typeof globalThis> = globalThis): boolean {
  return typeof scope.Worker === "function" && typeof scope.OffscreenCanvas === "function" && typeof scope.createImageBitmap === "function";
}

async function workerDetector(): Promise<PassDetector> {
  const worker = new Worker(new URL("./detect.worker.ts", import.meta.url), { type: "module", name: "door-detector" });
  const pending = new Map<number, (reply: Extract<WorkerReply, { type: "result" }>) => void>();
  let nextId = 1;
  const delegate = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("worker timeout")), WORKER_READY_TIMEOUT_MS);
    worker.addEventListener("error", (e) => { clearTimeout(timer); reject(e.error ?? new Error("worker error")); });
    worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
      const m = event.data;
      if (m.type === "ready") { clearTimeout(timer); resolve(m.delegate); }
      else if (m.type === "failed") { clearTimeout(timer); reject(new Error(m.error)); }
      else if (m.type === "result") { pending.get(m.id)?.(m); pending.delete(m.id); }
    });
    worker.postMessage({ type: "init", origin: window.location.origin } satisfies WorkerRequest);
  }).catch((error: unknown) => {
    worker.terminate();
    throw error;
  });
  return {
    mode: "worker",
    delegate,
    async detect(video, frame, rects) {
      const bitmap = await createImageBitmap(video);
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, ({ detections, passes, ms }) => resolve({ detections, passes, ms }));
        worker.postMessage({ type: "detect", id, bitmap, frame, rects } satisfies WorkerRequest, [bitmap]);
      });
    },
    close() {
      worker.terminate();
      for (const resolve of pending.values()) resolve({ type: "result", id: 0, detections: [], passes: 0, ms: 0 });
      pending.clear();
    },
  };
}

async function mainThreadDetector(): Promise<PassDetector> {
  const [{ loadFaceDetector }, { runPasses }] = await Promise.all([import("../face/detector"), import("./detect-core")]);
  const detector = await loadFaceDetector();
  const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
  return {
    mode: "main",
    delegate: detector.delegate,
    async detect(video, frame, rects) {
      return runPasses(detector, video, frame, rects, canvas, MAIN_THREAD_BUDGET_MS);
    },
    close() {
      detector.close();
    },
  };
}

/** The worker detector, or the main-thread one when workers can't run MediaPipe here. */
export async function loadPassDetector(): Promise<PassDetector> {
  if (workerSupported()) {
    try {
      return await workerDetector();
    } catch {
      // Fall through: same detector, on the page.
    }
  }
  return mainThreadDetector();
}
