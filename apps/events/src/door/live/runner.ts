// The live door's per-frame engine, loaded after the camera opens (kept out of the door's first-load JS):
// detection passes (worker) → face tracker → per-face recognition (scan API) → the AR store.
import { canvasToJpeg, measureCrop } from "../face/camera";
import type { Box } from "../face/engine";
import { postScan, type ScanReply } from "../kiosk/client";
import type { FaceScan } from "../kiosk/types";
import { recognitionCrop } from "./crop";
import { loadPassDetector, type PassDetector } from "./detector-client";
import { MORE_LIGHT, normalizeLight } from "./light";
import { FpsMeter, frameIntervalMs, LatencyStats } from "./metrics";
import { planPasses, type Frame } from "./passes";
import { DEFAULT_READINESS, GUIDANCE_COPY, readiness, type Guidance } from "./readiness";
import { RecognitionScheduler, type Candidate } from "./scheduler";
import type { LiveFace, LiveStore } from "./store";
import { COME_CLOSER, tagView, type FaceState } from "./tags";
import { FaceTracker, predictBox, type Track } from "./tracker";
import { JPEG_QUALITY, STRICT_LIVENESS_MIN_FACE_PX, type LiveDoorOptions, type LiveMetrics } from "./useLiveDoor";

/** Results that say nothing final about the person: the face is sent again (bounded) when it is ready again. */
const TRANSIENT = new Set<FaceScan["result"]>(["no_face", "inconclusive", "error", "liveness_needed"]);

const clampBox = (b: Box, f: Frame): Box => {
  const x = Math.max(0, Math.floor(b.x)), y = Math.max(0, Math.floor(b.y));
  return { x, y, w: Math.max(0, Math.min(f.width, Math.ceil(b.x + b.w)) - x), h: Math.max(0, Math.min(f.height, Math.ceil(b.y + b.h)) - y) };
};

export interface LiveRun {
  metrics(): LiveMetrics;
  stop(): void;
}

/** Loads the detector and runs the door on `video` until `stop()`. Rejects when the detector can't load. */
export async function runLiveDoor(video: HTMLVideoElement, store: LiveStore, options: () => LiveDoorOptions): Promise<LiveRun> {
  const detector: PassDetector = await loadPassDetector();
  let cancelled = false, timer: ReturnType<typeof setTimeout> | null = null, raf = 0, busy = false, lastRun = -Infinity, cursor = 0, frameNo = 0;
  let frameLuminance = 128, lowBattery = false, slow = false, lastDetect = { ms: 0, passes: 0 };
  // The hook's latest options (offline, blocked, Test mode…), read on every frame.
  const opts = { get current() { return options(); } };
  const measureCanvas = document.createElement("canvas");
  const tracker = new FaceTracker();
  const scheduler = new RecognitionScheduler<FaceScan>();
  const quality = new Map<number, { luminance: number; sharpness: number; guidance: Guidance; ready: boolean }>();
  // Faces whose last crop stayed too dark after normalising: no scan was made, the tag asks for light.
  const dark = new Set<number>();
  const fps = new FpsMeter(), latency = new LatencyStats();
  let scans = 0;

  void (navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener(t: string, f: () => void): void }> }).getBattery?.().then((battery) => {
    const update = () => { lowBattery = !battery.charging && battery.level < 0.2; };
    update();
    battery.addEventListener("levelchange", update);
    battery.addEventListener("chargingchange", update);
  }, () => undefined);

  const faceState = (track: Track): FaceState => {
    const o = opts.current, r = scheduler.status(track.id), q = quality.get(track.id);
    if (r.state === "done") return { state: "done", scan: r.result };
    if (o.offline) return { state: "offline" };
    if (o.blocked) return { state: "idle" };
    if (r.state === "retry" && dark.has(track.id)) return { state: "idle", guidance: MORE_LIGHT };
    if (r.state === "pending" || r.state === "retry") return { state: "checking" };
    if (o.strict && track.box.w < STRICT_LIVENESS_MIN_FACE_PX && track.streak >= DEFAULT_READINESS.minStreak) return { state: "idle", guidance: COME_CLOSER };
    return { state: "idle", guidance: q?.guidance ? GUIDANCE_COPY[q.guidance] : null };
  };

  // Test mode is re-read before every send and before every answer is consumed, not only once per frame: a toggle
  // advances the scheduler's generation at once, so an answer that lands while a detection pass is still running is
  // already stale (a face checked in Test mode is checked again live).
  const syncMode = () => {
    if (scheduler.setMode(opts.current.testMode())) dark.clear();
  };
  syncMode();

  const recognise = async (track: Track, others: Box[], frame: Frame, test: boolean) => {
    const epoch = scheduler.epoch;
    const crop = recognitionCrop(track.box, others, frame);
    const now = () => performance.now();
    const live = () => tracker.current.some((t) => t.id === track.id);
    if (!crop) return scheduler.fail(track.id, now(), live());
    const canvas = document.createElement("canvas");
    canvas.width = crop.width;
    canvas.height = crop.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return scheduler.fail(track.id, now(), live());
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(video, crop.source.x, crop.source.y, crop.source.w, crop.source.h, 0, 0, crop.width, crop.height);
    // Dark crops are brightened before upload; one that stays too dark is never sent (no Didit call).
    const pixels = ctx.getImageData(0, 0, crop.width, crop.height);
    const light = normalizeLight(pixels);
    if (light.tooDark) {
      dark.add(track.id);
      return scheduler.fail(track.id, now(), live());
    }
    dark.delete(track.id);
    if (light.adjusted) ctx.putImageData(pixels, 0, 0);
    let blob: Blob;
    try {
      blob = await canvasToJpeg(canvas, JPEG_QUALITY);
    } catch {
      return scheduler.fail(track.id, now(), live());
    }
    const started = now();
    syncMode();
    if (epoch !== scheduler.epoch) return scheduler.drop(track.id);
    const reply: ScanReply = await postScan(opts.current.base, blob, test, fetch, { trackId: track.id, faceWidth: track.box.w });
    if (cancelled) return;
    // Sent before the mode changed: the answer belongs to the other mode, so it is ignored and the face goes again.
    syncMode();
    if (scheduler.stale(track.id)) return scheduler.drop(track.id);
    latency.add(now() - started);
    scans++;
    if ("session" in reply) {
      scheduler.fail(track.id, now(), live());
      return opts.current.onSession(reply.session);
    }
    if (TRANSIENT.has(reply.result)) scheduler.retry(track.id, reply, now(), live());
    else scheduler.resolve(track.id, reply, now(), live());
    opts.current.onScan(reply, Date.now());
  };

  const step = async () => {
    if (cancelled) return;
    schedule();
    const now = performance.now();
    const interval = frameIntervalMs({ hidden: document.visibilityState === "hidden", lowBattery, slowDetector: slow });
    if (busy || video.readyState < 2 || now - lastRun < interval) return;
    busy = true;
    lastRun = now;
    try {
      const frame = { width: video.videoWidth, height: video.videoHeight };
      if (!frame.width || !frame.height) return;
      const plan = planPasses(frame, tracker.current.map((t) => predictBox(t, now)), cursor, slow ? { tilesPerFrame: 1, maxRois: 4 } : {});
      cursor = plan.cursor;
      const found = await detector.detect(video, frame, plan.rects);
      if (cancelled) return;
      lastDetect = { ms: found.ms, passes: found.passes };
      slow = found.ms > 45;
      const tracks = tracker.update(found.detections, now);
      fps.tick(now);
      if (frameNo++ % 15 === 0) frameLuminance = measureCrop(measureCanvas, video, { x: 0, y: 0, w: frame.width, h: frame.height }).luminance;
      const ids = new Set(tracks.map((t) => t.id));
      for (const id of quality.keys()) if (!ids.has(id)) quality.delete(id);
      for (const id of dark) if (!ids.has(id)) dark.delete(id);
      scheduler.sync(ids);
      const o = opts.current;
      syncMode();
      const test = o.testMode();
      const candidates: Candidate[] = [];
      for (const t of tracks) {
        const r = scheduler.status(t.id);
        if (t.lastSeen !== now || r.state === "pending") continue;
        // Measure only faces still waiting for a result (≤ 6 tiny reads).
        if (r.state !== "done") {
          const m = measureCrop(measureCanvas, video, clampBox(t.box, frame));
          const q = readiness({ box: t.box, keypoints: t.keypoints, streak: t.streak, vx: t.vx, vy: t.vy, luminance: m.luminance, sharpness: m.sharpness, frameLuminance });
          quality.set(t.id, { ...m, ...q });
        }
        const q = quality.get(t.id);
        const closeEnough = !o.strict || t.box.w >= STRICT_LIVENESS_MIN_FACE_PX;
        candidates.push({
          id: t.id,
          ready: !!q?.ready && closeEnough,
          priority: t.box.w,
          again: r.state === "done" && r.result.result === "liveness_needed" && closeEnough,
        });
      }
      for (const id of scheduler.next(candidates, now, o.blocked || o.offline)) {
        const track = tracks.find((t) => t.id === id)!;
        void recognise(track, tracks.filter((t) => t.id !== id).map((t) => predictBox(t, now)), frame, test);
      }
      const faces: LiveFace[] = tracks.map((t) => ({ id: t.id, box: predictBox(t, now), view: tagView(faceState(t)) }));
      store.set(frame, faces, now);
    } finally {
      busy = false;
    }
  };
  function schedule() {
    if (cancelled) return;
    if (document.visibilityState === "hidden") timer = setTimeout(() => void step(), 1000);
    else raf = requestAnimationFrame(() => void step());
  }

  schedule();
  return {
    metrics() {
      const t = performance.now(), l = latency.summary();
      return { fps: fps.fps(t), detectMs: Math.round(lastDetect.ms), passes: lastDetect.passes, p50: l.p50, p95: l.p95, scans, mode: `${detector.mode}/${detector.delegate}` };
    },
    stop() {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      detector.close();
    },
  };
}
