"use client";

import { useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { KIOSK_SIZES, type KioskOrientation } from "@didit-events/ui/kiosk";

const subscribe = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};
const snapshot = () => `${window.innerWidth}x${window.innerHeight}`;
const serverSnapshot = () => "";

export interface Stage {
  orientation: KioskOrientation;
  /** Stage size in design px (≥ the design frame on both axes). */
  width: number;
  height: number;
  style: CSSProperties;
}

/** Pure part of useStage: fits the design stage into a `vw`×`vh` screen and grows it along the spare axis. */
export function fitStage(vw: number, vh: number): Stage {
  const orientation: KioskOrientation = vh > vw ? "portrait" : "landscape";
  const base = KIOSK_SIZES[orientation];
  const scale = Math.min(vw / base.w, vh / base.h);
  return {
    orientation,
    width: vw / scale,
    height: vh / scale,
    style: { position: "fixed", top: 0, left: 0, transform: `scale(${scale})`, transformOrigin: "0 0" },
  };
}

/**
 * The kiosk is laid out in the design's px (1920×1080 or 1080×1920 by screen orientation) and scaled to the screen,
 * so the live screen and the /_frames frames share one geometry. Hidden until the viewport is known.
 */
export function useStage(): Stage {
  const vp = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  if (!vp) {
    const { w, h } = KIOSK_SIZES.landscape;
    return { orientation: "landscape", width: w, height: h, style: { position: "fixed", top: 0, left: 0, visibility: "hidden" } };
  }
  const [w, h] = vp.split("x").map(Number) as [number, number];
  return fitStage(w, h);
}
