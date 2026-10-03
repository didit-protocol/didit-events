// The live door hook: opens the camera, then loads and runs the per-frame engine (./runner, a separate chunk) that
// detects, tracks and recognises faces into the AR store. React only hears about camera errors, the device list and
// the dev metrics; tag positions go straight from the store to the overlay on each animation frame.
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { getStoredDeviceId, keepAwake, listCameras, openCamera, setStoredDeviceId, stopStream, type CameraError } from "../face/camera";
import type { FaceScan, SessionEnd } from "../kiosk/types";
import type { LiveRun } from "./runner";
import { LiveStore } from "./store";

/** Mirrors the server's STRICT_LIVENESS_MIN_FACE_PX (packages/core/src/door/service.ts; a test keeps them equal). */
export const STRICT_LIVENESS_MIN_FACE_PX = 140;
export const JPEG_QUALITY = 0.9;

export interface LiveMetrics {
  fps: number;
  detectMs: number;
  passes: number;
  p50: number;
  p95: number;
  scans: number;
  mode: string;
}

export interface LiveDoorOptions {
  enabled: boolean;
  base: string;
  /** Read on every frame: a change voids every result so far (faces in frame are checked again in the new mode). */
  testMode: () => boolean;
  /** Nothing is sent (closed door, session ended, budget spent). */
  blocked: boolean;
  /** Offline: undecided faces show "Offline" and nothing is queued. */
  offline: boolean;
  strict: boolean;
  onScan: (scan: FaceScan, at: number) => void;
  onSession: (reason: SessionEnd) => void;
}

export function useLiveDoor(videoRef: RefObject<HTMLVideoElement | null>, options: LiveDoorOptions) {
  const [store] = useState(() => new LiveStore());
  const [cameraError, setCameraError] = useState<CameraError | null>(null);
  const [detectorError, setDetectorError] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(() => getStoredDeviceId());
  const [metrics, setMetrics] = useState<LiveMetrics | null>(null);
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  }, [options]);

  const selectDevice = useCallback((id: string | null) => {
    setStoredDeviceId(id);
    setDeviceId(id);
  }, []);

  const { enabled } = options;
  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !video) return;
    let cancelled = false, stream: MediaStream | null = null, run: LiveRun | null = null;
    const releaseWakeLock = keepAwake();
    const metricsTimer = process.env.NODE_ENV !== "production" ? setInterval(() => run && setMetrics(run.metrics()), 1000) : null;

    void (async () => {
      const opened = await openCamera(deviceId);
      if (cancelled) {
        if (opened.ok) stopStream(opened.stream);
        return;
      }
      if (!opened.ok) {
        setCameraError(opened.error);
        return;
      }
      stream = opened.stream;
      setCameraError(null);
      void listCameras().then((list) => !cancelled && setDevices(list), () => undefined);
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play().catch(() => undefined);
      try {
        const { runLiveDoor } = await import("./runner");
        const started = await runLiveDoor(video, store, () => opts.current);
        if (cancelled) return started.stop();
        run = started;
        setDetectorError(false);
      } catch {
        if (!cancelled) setDetectorError(true);
      }
    })();

    return () => {
      cancelled = true;
      run?.stop();
      if (metricsTimer) clearInterval(metricsTimer);
      releaseWakeLock();
      stopStream(stream);
      video.srcObject = null;
      store.set(null, [], performance.now());
    };
  }, [videoRef, enabled, deviceId, store]);

  return { store, cameraError, detectorError, devices, deviceId, selectDevice, metrics };
}
