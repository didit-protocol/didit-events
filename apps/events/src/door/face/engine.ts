// Kiosk face engine: a pure, framework-free state machine (implementation-plan §6.2). It never touches the DOM, the
// camera or the clock; the caller feeds one `EngineFrame` per processed video frame (with its own timestamp) and
// reacts to the returned output. This is framing guidance only, NOT liveness, and must never be described as such.
import type { HintCode } from "./hints";
import { iou } from "./quality";

export { HINT_COPY, HINT_PRIORITY, type HintCode } from "./hints";

export type EngineState =
  | "idle"
  | "adjusting"
  | "holding"
  | "capturing"
  | "verifying"
  | "result"
  | "cooldown"
  | "paused"
  | "offline";

export interface Point {
  x: number;
  y: number;
}

/** Pixel box in frame coordinates (top-left origin). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** BlazeFace keypoints in pixel frame coordinates ("right"/"left" are the subject's, as MediaPipe reports them). */
export interface FaceKeypoints {
  rightEye: Point;
  leftEye: Point;
  noseTip: Point;
  mouth: Point;
  rightEar: Point;
  leftEar: Point;
}

export interface FaceDetection {
  score: number;
  box: Box;
  keypoints: FaceKeypoints;
}

export interface EngineFrame {
  /** Monotonic timestamp in ms. */
  t: number;
  width: number;
  height: number;
  detections: FaceDetection[];
  /** Mean luma (0–255) of the primary face crop. */
  luminance: number;
  /** Laplacian variance of the primary face crop on a 96-px grey downscale. */
  sharpness: number;
}

export interface EngineConfig {
  /** A detection counts as a face from this score up. */
  minScore: number;
  /** Face box height as a fraction of the frame height. */
  minHeightRatio: number;
  maxHeightRatio: number;
  /** Oval guide, centred in the frame; radii as fractions of the frame width / height. */
  ovalRx: number;
  ovalRy: number;
  /** Accepted range of |rightEye.x − nose.x| / |leftEye.x − nose.x|. */
  frontalMin: number;
  frontalMax: number;
  luminanceMin: number;
  luminanceMax: number;
  sharpnessMin: number;
  /** Consecutive all-gates-pass frames (each with IoU ≥ stableIou to the previous one) before holding. */
  stableFrames: number;
  stableIou: number;
  /** Hold duration; progress fills 0 → 1 over it. */
  holdMs: number;
  /** Minimum IoU between consecutive frames for a face to keep its track. */
  trackIou: number;
  /** A face absent this long starts a new track (and lifts the rescan guard). */
  trackLostMs: number;
  /** A track that already has a result is scanned again after this long. */
  rescanAfterMs: number;
  resultMs: number;
  cooldownMs: number;
  /** Watchdog: a match result that has not arrived this long after `verifying` began becomes a `timeout` result. */
  verifyingTimeoutMs: number;
  /** Max time in `capturing` waiting for the encoded crop before falling back to adjusting. */
  captureTimeoutMs: number;
}

export const DEFAULT_ENGINE_CONFIG: Readonly<EngineConfig> = Object.freeze({
  minScore: 0.8,
  minHeightRatio: 0.28,
  maxHeightRatio: 0.7,
  ovalRx: 0.22,
  ovalRy: 0.36,
  frontalMin: 0.65,
  frontalMax: 1.5,
  luminanceMin: 60,
  luminanceMax: 200,
  sharpnessMin: 40,
  stableFrames: 12,
  stableIou: 0.85,
  holdMs: 800,
  trackIou: 0.3,
  trackLostMs: 1500,
  rescanAfterMs: 20_000,
  resultMs: 4000,
  cooldownMs: 1000,
  verifyingTimeoutMs: 12_000,
  captureTimeoutMs: 3_000,
});

/** Synthetic result the engine shows when the verifying watchdog fires (kiosk K-05b / K-12). */
export interface VerifyTimeout {
  kind: "timeout";
}

export type EngineEvent =
  | { type: "state"; from: EngineState; to: EngineState; t: number }
  | { type: "track"; trackId: number; t: number }
  | { type: "sharpest"; box: Box; sharpness: number; t: number }
  | { type: "capture"; box: Box; trackId: number; t: number }
  /** The caller could not produce the capture (no crop / encode failed); `failures` counts consecutive ones. */
  | { type: "capture_failed"; failures: number; t: number }
  | { type: "timeout"; trackId: number | null; t: number };

export interface EngineOutput<R = unknown> {
  state: EngineState;
  hint: HintCode | null;
  progress: number;
  /** Track of the face in the current frame; null when no face is visible. */
  trackId: number | null;
  /** Primary face box in the current frame, for overlays. */
  box: Box | null;
  /** Present only on the frame that enters `capturing`: crop this box (the sharpest one seen while holding). */
  captureRequest?: { box: Box };
  result?: R | VerifyTimeout;
  events: EngineEvent[];
}

export interface GateResult {
  hint: HintCode | null;
  faces: FaceDetection[];
}

/** |rightEye.x − nose.x| / |leftEye.x − nose.x|; 1 when looking straight at the camera. NaN/∞ for degenerate input. */
export function frontalRatio(kp: FaceKeypoints): number {
  return Math.abs(kp.rightEye.x - kp.noseTip.x) / Math.abs(kp.leftEye.x - kp.noseTip.x);
}

/** Runs every gate and returns the highest-priority failing hint (null when all pass). */
export function evaluateGates(frame: EngineFrame, config: EngineConfig = DEFAULT_ENGINE_CONFIG): GateResult {
  const faces = frame.detections.filter((d) => d.score >= config.minScore);
  if (faces.length > 1) return { hint: "multiple_faces", faces };
  const face = faces[0];
  if (!face) return { hint: "no_face", faces };

  const { box } = face;
  const heightRatio = box.h / frame.height;
  if (heightRatio < config.minHeightRatio) return { hint: "too_far", faces };
  if (heightRatio > config.maxHeightRatio) return { hint: "too_close", faces };

  const dx = (box.x + box.w / 2 - frame.width / 2) / (config.ovalRx * frame.width);
  const dy = (box.y + box.h / 2 - frame.height / 2) / (config.ovalRy * frame.height);
  if (dx * dx + dy * dy > 1) return { hint: "off_center", faces };

  const ratio = frontalRatio(face.keypoints);
  if (!(ratio >= config.frontalMin && ratio <= config.frontalMax)) return { hint: "not_frontal", faces };

  if (!(frame.luminance >= config.luminanceMin)) return { hint: "too_dark", faces };
  if (frame.luminance > config.luminanceMax) return { hint: "too_bright", faces };
  if (!(frame.sharpness >= config.sharpnessMin)) return { hint: "blurry", faces };
  return { hint: null, faces };
}

function primaryFace(frame: EngineFrame, config: EngineConfig): FaceDetection | null {
  let best: FaceDetection | null = null;
  for (const d of frame.detections) {
    if (d.score >= config.minScore && (!best || d.score > best.score)) best = d;
  }
  return best;
}

export class FaceEngine<R = unknown> {
  readonly config: EngineConfig;

  private state: EngineState = "idle";
  private hint: HintCode | null = null;
  private progress = 0;
  private paused = false;
  private offline = false;
  private lastT = 0;

  // Tracking
  private nextTrackId = 1;
  private trackId: number | null = null;
  private trackBox: Box | null = null;
  private trackSeenT = 0;
  private visible = false;
  private currentBox: Box | null = null;

  // Stability and hold
  private prevBox: Box | null = null;
  private streak = 0;
  private stateSince = 0;
  private holdStart = 0;
  private sharpest: { box: Box; sharpness: number } | null = null;

  // Capture, result and rescan guard
  private capturedTrackId: number | null = null;
  private result: R | VerifyTimeout | undefined;
  private captureFailures = 0;
  private scanned: { trackId: number; t: number } | null = null;

  private events: EngineEvent[] = [];
  private reported: EngineState = "idle";

  constructor(config: Partial<EngineConfig> = {}) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
  }

  step(frame: EngineFrame): EngineOutput<R> {
    const { config } = this;
    const { t } = frame;
    this.lastT = t;

    const face = primaryFace(frame, config);
    this.updateTrack(face, t);
    const prevBox = this.prevBox;
    this.prevBox = face?.box ?? null;
    this.currentBox = face?.box ?? null;

    if (this.offline || this.paused) return this.output();

    let captureRequest: { box: Box } | undefined;
    switch (this.state) {
      case "capturing":
        // Encoding should take milliseconds; if it never settles, treat it as a failed capture.
        if (t - this.stateSince >= config.captureTimeoutMs) this.failCapture();
        break;
      case "verifying":
        if (t - this.stateSince >= config.verifyingTimeoutMs) this.timeout(t);
        break;
      case "result":
        if (t - this.stateSince >= config.resultMs) this.enter("cooldown", t);
        break;
      case "cooldown":
        if (t - this.stateSince >= config.cooldownMs) captureRequest = this.scan(frame, face, prevBox);
        break;
      default:
        captureRequest = this.scan(frame, face, prevBox);
    }
    return this.output(captureRequest);
  }

  /** The caller has the capture (encoded crop) in hand: now waiting for the match result. */
  onCaptured(): EngineOutput<R> {
    if (this.effectiveState === "capturing") {
      this.captureFailures = 0;
      this.enter("verifying", this.lastT);
    }
    return this.output();
  }

  /** The caller could not produce the capture: back to adjusting for a fresh hold (counted in `capture_failed`). */
  captureFailed(): EngineOutput<R> {
    if (this.effectiveState === "capturing") this.failCapture();
    return this.output();
  }

  private failCapture(): void {
    this.captureFailures++;
    this.events.push({ type: "capture_failed", failures: this.captureFailures, t: this.lastT });
    this.resetStability();
    this.hint = null;
    this.capturedTrackId = null;
    this.enter("adjusting", this.lastT);
  }

  /** Match result for the capture in flight. Ignored unless verifying (e.g. after an offline/pause override). */
  onResult(result: R, t: number = this.lastT): EngineOutput<R> {
    if (this.effectiveState === "verifying") {
      this.result = result;
      if (this.capturedTrackId !== null) this.scanned = { trackId: this.capturedTrackId, t };
      this.enter("result", t);
    }
    return this.output();
  }

  /** Overrides every state until resume(); a scan in flight is dropped. */
  pause(): EngineOutput<R> {
    if (!this.paused) {
      this.paused = true;
      this.restartScan();
    }
    return this.output();
  }

  resume(): EngineOutput<R> {
    if (this.paused) {
      this.paused = false;
      this.restartScan();
    }
    return this.output();
  }

  /** Offline overrides every state (and pause); a scan in flight is dropped: no admission while offline. */
  setOffline(offline: boolean): EngineOutput<R> {
    if (offline !== this.offline) {
      this.offline = offline;
      this.restartScan();
    }
    return this.output();
  }

  /** Back to a fresh engine: clears tracks, the rescan guard and any pause/offline override. */
  reset(): EngineOutput<R> {
    this.paused = false;
    this.offline = false;
    this.trackId = null;
    this.trackBox = null;
    this.visible = false;
    this.currentBox = null;
    this.prevBox = null;
    this.scanned = null;
    this.restartScan();
    return this.output();
  }

  get effectiveState(): EngineState {
    if (this.offline) return "offline";
    if (this.paused) return "paused";
    return this.state;
  }

  private updateTrack(face: FaceDetection | null, t: number): void {
    const { config } = this;
    if (!face) {
      this.visible = false;
      return;
    }
    const continues =
      this.trackId !== null &&
      this.trackBox !== null &&
      t - this.trackSeenT < config.trackLostMs &&
      iou(face.box, this.trackBox) >= config.trackIou;
    if (!continues) {
      this.trackId = this.nextTrackId++;
      this.events.push({ type: "track", trackId: this.trackId, t });
    }
    this.trackBox = face.box;
    this.trackSeenT = t;
    this.visible = true;
  }

  private isGuarded(t: number): boolean {
    const { scanned } = this;
    return (
      this.visible && scanned !== null && scanned.trackId === this.trackId && t - scanned.t < this.config.rescanAfterMs
    );
  }

  /** idle / adjusting / holding logic; returns a capture request on the frame that enters `capturing`. */
  private scan(frame: EngineFrame, face: FaceDetection | null, prevBox: Box | null): { box: Box } | undefined {
    const { config } = this;
    const { t } = frame;

    if (this.isGuarded(t)) {
      this.resetStability();
      this.hint = null;
      this.enter("cooldown", t);
      return undefined;
    }

    const gates = evaluateGates(frame, config);
    if (gates.hint !== null || !face) {
      this.resetStability();
      this.hint = gates.hint;
      this.enter(gates.faces.length === 0 ? "idle" : "adjusting", t);
      return undefined;
    }

    this.hint = null;
    const steady = prevBox !== null && iou(face.box, prevBox) >= config.stableIou;
    this.streak = steady ? this.streak + 1 : 1;

    if (this.state === "holding") {
      if (!steady) {
        this.progress = 0;
        this.sharpest = null;
        this.enter("adjusting", t);
        return undefined;
      }
      this.noteSharpness(face.box, frame.sharpness, t);
      this.progress = Math.min(1, (t - this.holdStart) / config.holdMs);
      if (this.progress >= 1) return this.capture(face.box, t);
      return undefined;
    }

    if (this.streak >= config.stableFrames) {
      this.enter("holding", t);
      this.holdStart = t;
      this.progress = 0;
      this.sharpest = null;
      this.noteSharpness(face.box, frame.sharpness, t);
      return undefined;
    }
    this.enter("adjusting", t);
    return undefined;
  }

  private capture(fallback: Box, t: number): { box: Box } {
    const box = this.sharpest?.box ?? fallback;
    this.capturedTrackId = this.trackId;
    this.enter("capturing", t);
    this.events.push({ type: "capture", box, trackId: this.trackId ?? 0, t });
    return { box };
  }

  private timeout(t: number): void {
    this.events.push({ type: "timeout", trackId: this.capturedTrackId, t });
    this.result = { kind: "timeout" };
    this.capturedTrackId = null;
    this.resetStability();
    this.enter("result", t);
  }

  private noteSharpness(box: Box, sharpness: number, t: number): void {
    if (this.sharpest && this.sharpest.sharpness >= sharpness) return;
    this.sharpest = { box, sharpness };
    this.events.push({ type: "sharpest", box, sharpness, t });
  }

  private resetStability(): void {
    this.streak = 0;
    this.progress = 0;
    this.sharpest = null;
  }

  private restartScan(): void {
    this.resetStability();
    this.hint = null;
    this.result = undefined;
    this.capturedTrackId = null;
    this.enter("idle", this.lastT);
  }

  private enter(to: EngineState, t: number): void {
    if (to === this.state) return;
    this.state = to;
    this.stateSince = t;
  }

  private output(captureRequest?: { box: Box }): EngineOutput<R> {
    const state = this.effectiveState;
    if (state !== this.reported) {
      this.events.push({ type: "state", from: this.reported, to: state, t: this.lastT });
      this.reported = state;
    }
    const scanning = state === "idle" || state === "adjusting";
    const out: EngineOutput<R> = {
      state,
      hint: scanning ? this.hint : null,
      progress: state === "holding" ? this.progress : state === "capturing" || state === "verifying" ? 1 : 0,
      trackId: this.visible ? this.trackId : null,
      box: this.currentBox,
      events: this.events,
    };
    if (captureRequest && state === "capturing") out.captureRequest = captureRequest;
    if (state === "result" && this.result !== undefined) out.result = this.result;
    this.events = [];
    return out;
  }
}
