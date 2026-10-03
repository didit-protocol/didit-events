// When a tracked face may be sent for recognition, and what framing help its tag shows meanwhile. Pure.
import type { Box, FaceKeypoints } from "../face/engine";
import { MORE_LIGHT } from "./light";

export interface ReadinessConfig {
  /** Consecutive detected frames before a face is sent. */
  minStreak: number;
  /** Narrowest face sent (camera px); smaller ones are upsampled up to here only. */
  minFacePx: number;
  /** Accepted range of |rightEye.x − nose.x| / |leftEye.x − nose.x| (looking roughly at the camera). */
  frontalMin: number;
  frontalMax: number;
  /** Laplacian variance of the face on a ≤96-px grey sample. */
  minSharpness: number;
  /** Centre speed above this × the face width per 100 ms is motion blur. */
  maxSpeed: number;
  minLuminance: number;
  /** Face luma below this × the frame's luma (in a bright frame) = light behind the person. */
  backlitRatio: number;
}

export const DEFAULT_READINESS: Readonly<ReadinessConfig> = Object.freeze({
  minStreak: 3,
  minFacePx: 40,
  frontalMin: 0.45,
  frontalMax: 2.2,
  minSharpness: 18,
  maxSpeed: 0.35,
  minLuminance: 45,
  backlitRatio: 0.5,
});

export interface FaceSample {
  box: Box;
  keypoints: FaceKeypoints;
  streak: number;
  /** Centre velocity, camera px per ms. */
  vx: number;
  vy: number;
  luminance: number;
  sharpness: number;
  /** Mean luma of the whole frame. */
  frameLuminance: number;
}

export type Guidance = "too_dark" | "backlit" | "too_far" | null;

export const GUIDANCE_COPY: Record<Exclude<Guidance, null>, string> = {
  too_dark: MORE_LIGHT,
  backlit: "Light behind you: turn to the room",
  too_far: "Come a little closer",
};

export function frontal(k: FaceKeypoints, config: Pick<ReadinessConfig, "frontalMin" | "frontalMax"> = DEFAULT_READINESS): boolean {
  const right = Math.abs(k.rightEye.x - k.noseTip.x), left = Math.abs(k.leftEye.x - k.noseTip.x);
  if (left < 1e-3 || right < 1e-3) return false;
  const ratio = right / left;
  return ratio >= config.frontalMin && ratio <= config.frontalMax;
}

export interface Readiness {
  ready: boolean;
  guidance: Guidance;
}

export function readiness(face: FaceSample, config: ReadinessConfig = DEFAULT_READINESS): Readiness {
  const dark = face.luminance < config.minLuminance;
  const backlit = !dark && face.frameLuminance > 110 && face.luminance < face.frameLuminance * config.backlitRatio;
  const guidance: Guidance = face.box.w < config.minFacePx ? "too_far" : dark ? "too_dark" : backlit ? "backlit" : null;
  const speed = (Math.hypot(face.vx, face.vy) * 100) / Math.max(1, face.box.w);
  const ready = face.streak >= config.minStreak && face.box.w >= config.minFacePx && frontal(face.keypoints, config) &&
    face.sharpness >= config.minSharpness && speed <= config.maxSpeed && face.luminance >= config.minLuminance * 0.75;
  return { ready, guidance };
}
