// Browser camera plumbing for the kiosk: getUserMedia, device choice, error mapping (K-02a–c), wake lock, and the
// per-frame crop measurements + JPEG capture the face engine needs.
import type { Box } from "./engine";
import { cropWithMargin, downscaleSize, laplacianVariance, luminance, toGray } from "./quality";

export type CameraError = "permission_denied" | "not_found" | "in_use" | "unknown";

export const CAMERA_DEVICE_STORAGE_KEY = "didit-access:camera-device";
export const CAPTURE_MARGIN = 0.4;
export const CAPTURE_MAX_SIDE = 720;
export const CAPTURE_JPEG_QUALITY = 0.85;

/** Maps a getUserMedia rejection to the kiosk's camera error screens. */
export function mapCameraError(err: unknown): CameraError {
  const name = typeof err === "object" && err !== null && "name" in err ? String(err.name) : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "permission_denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "not_found";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "in_use";
    default:
      return "unknown";
  }
}

export function getStoredDeviceId(): string | null {
  try {
    return globalThis.localStorage?.getItem(CAMERA_DEVICE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setStoredDeviceId(deviceId: string | null): void {
  try {
    if (deviceId) globalThis.localStorage?.setItem(CAMERA_DEVICE_STORAGE_KEY, deviceId);
    else globalThis.localStorage?.removeItem(CAMERA_DEVICE_STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode, quota); the default camera is used then.
  }
}

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  const devices = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
  return devices.filter((d) => d.kind === "videoinput");
}

export type OpenCameraResult = { ok: true; stream: MediaStream } | { ok: false; error: CameraError };

/**
 * Opens the user-facing camera at 1280×720. A stored device that no longer exists falls back to the default camera
 * (and is forgotten).
 */
export async function openCamera(deviceId: string | null = getStoredDeviceId()): Promise<OpenCameraResult> {
  const media = globalThis.navigator?.mediaDevices;
  if (!media?.getUserMedia) return { ok: false, error: "unknown" };
  const constraints = (id: string | null): MediaStreamConstraints => ({
    audio: false,
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      ...(id ? { deviceId: { exact: id } } : { facingMode: "user" }),
    },
  });
  try {
    return { ok: true, stream: await media.getUserMedia(constraints(deviceId)) };
  } catch (err) {
    const error = mapCameraError(err);
    if (!deviceId || error !== "not_found") return { ok: false, error };
    setStoredDeviceId(null);
  }
  try {
    return { ok: true, stream: await media.getUserMedia(constraints(null)) };
  } catch (err) {
    return { ok: false, error: mapCameraError(err) };
  }
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Keeps the screen awake while the kiosk runs; re-acquires after the tab becomes visible again. Returns a release. */
export function keepAwake(): () => void {
  let sentinel: WakeLockSentinel | null = null;
  let released = false;
  const acquire = async () => {
    try {
      if (released || document.visibilityState !== "visible" || !navigator.wakeLock) return;
      sentinel = await navigator.wakeLock.request("screen");
    } catch {
      // Unsupported or denied (battery saver); the kiosk still works.
    }
  };
  const onVisibility = () => void acquire();
  void acquire();
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    released = true;
    document.removeEventListener("visibilitychange", onVisibility);
    sentinel?.release().catch(() => undefined);
    sentinel = null;
  };
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return canvas.getContext("2d", { willReadFrequently: true });
}

/** Luminance + sharpness of `box` inside `source`, measured on a 96-px grey downscale. Reuses `canvas`. */
export function measureCrop(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  box: Box,
): { luminance: number; sharpness: number } {
  const size = downscaleSize(box.w, box.h);
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = context2d(canvas);
  if (!ctx || box.w <= 0 || box.h <= 0) return { luminance: 0, sharpness: 0 };
  ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, size.w, size.h);
  const img = ctx.getImageData(0, 0, size.w, size.h);
  return { luminance: luminance(img), sharpness: laplacianVariance(toGray(img), size.w, size.h) };
}

/** Copies the capture crop (box + 40 % margin) out of `source` at ≤ 720 px long side, into a fresh canvas. */
export function snapshotCrop(
  source: CanvasImageSource,
  frame: { width: number; height: number },
  box: Box,
): HTMLCanvasElement | null {
  const crop = cropWithMargin(box, CAPTURE_MARGIN, frame);
  if (crop.w <= 0 || crop.h <= 0) return null;
  const size = downscaleSize(crop.w, crop.h, CAPTURE_MAX_SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, size.w, size.h);
  return canvas;
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality: number = CAPTURE_JPEG_QUALITY): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("JPEG encoding failed"))), "image/jpeg", quality);
  });
}
