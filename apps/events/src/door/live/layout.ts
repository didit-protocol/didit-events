// Where an AR tag sits: centred above its face, flipped below it near the top edge, clamped inside the screen, and
// eased towards its target so it follows the face smoothly. Pure: boxes in stage px.
import type { Box } from "../face/engine";

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TagPlacement {
  x: number;
  y: number;
  placement: "above" | "below";
}

/** Gap between the face box and its tag (stage px). */
export const TAG_GAP = 14;

export function placeTag(face: Box, tag: { w: number; h: number }, bounds: Bounds, gap = TAG_GAP): TagPlacement {
  const width = Math.min(tag.w, bounds.right - bounds.left);
  const x = Math.min(Math.max(face.x + face.w / 2 - width / 2, bounds.left), bounds.right - width);
  const above = face.y - gap - tag.h;
  if (above >= bounds.top) return { x, y: above, placement: "above" };
  const below = Math.min(face.y + face.h + gap, bounds.bottom - tag.h);
  return { x, y: Math.max(bounds.top, below), placement: "below" };
}

/** Exponential easing of `from` towards `to` over `dtMs` (time constant `tauMs`); a far jump snaps. */
export function ease(from: number, to: number, dtMs: number, tauMs = 90, snapPx = 400): number {
  if (!Number.isFinite(from) || Math.abs(to - from) > snapPx) return to;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
  return from + (to - from) * k;
}

export function easeBox(from: Box | null, to: Box, dtMs: number, tauMs = 90): Box {
  if (!from) return to;
  return { x: ease(from.x, to.x, dtMs, tauMs), y: ease(from.y, to.y, dtMs, tauMs), w: ease(from.w, to.w, dtMs, tauMs), h: ease(from.h, to.h, dtMs, tauMs) };
}

/** A first guess of a tag's size (stage px) before it is measured: name row 36 px, chip 22 px, padding 20/14. */
export function estimateTagSize(view: { kind: string; name?: string; verified?: boolean; chip?: { text: string }; guidance?: string | null }): { w: number; h: number } {
  if (view.kind === "checking") return { w: 210, h: 52 };
  if (view.kind === "guidance" || view.kind === "offline") return { w: 36 + 12.5 * (view.guidance ?? view.chip?.text ?? "").length, h: 52 };
  const name = view.name ? 40 + 19 * Math.min(view.name.length, 26) + (view.verified ? 40 : 0) : 0;
  const chip = view.chip ? 68 + 11.5 * view.chip.text.length : 0;
  return { w: Math.min(620, Math.max(name, chip)), h: (view.name ? 42 : 0) + (view.chip ? 34 : 0) + (view.name && view.chip ? 10 : 0) + 28 };
}
