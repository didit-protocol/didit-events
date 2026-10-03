// The live door's per-frame state, outside React: the overlay reads face positions from it every animation frame
// and re-renders its tags only when their content changes (`content` is a new object only then).
import type { Box } from "../face/engine";
import type { Frame } from "./passes";
import type { TagView } from "./tags";

export interface LiveFace {
  id: number;
  /** Camera px. */
  box: Box;
  view: TagView;
}

export interface LiveContent {
  frame: Frame | null;
  faces: ReadonlyArray<{ id: number; view: TagView }>;
  /** Nobody in front of the door for a moment: the idle prompt shows. */
  idle: boolean;
}

/** No face for this long shows the idle prompt. */
export const IDLE_AFTER_MS = 1500;

const sameContent = (a: LiveContent, b: LiveContent) =>
  a.idle === b.idle && a.frame?.width === b.frame?.width && a.frame?.height === b.frame?.height &&
  a.faces.length === b.faces.length && a.faces.every((f, i) => f.id === b.faces[i]!.id && JSON.stringify(f.view) === JSON.stringify(b.faces[i]!.view));

export class LiveStore {
  faces: LiveFace[] = [];
  frame: Frame | null = null;
  private lastFaceAt = -Infinity;
  private snapshot: LiveContent = { frame: null, faces: [], idle: true };
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  content = (): LiveContent => this.snapshot;

  set(frame: Frame | null, faces: LiveFace[], t: number): void {
    this.frame = frame;
    this.faces = faces;
    if (faces.length) this.lastFaceAt = t;
    const next: LiveContent = { frame, faces: faces.map((f) => ({ id: f.id, view: f.view })), idle: !faces.length && t - this.lastFaceAt >= IDLE_AFTER_MS };
    if (sameContent(next, this.snapshot)) return;
    this.snapshot = next;
    for (const l of this.listeners) l();
  }

  box(id: number): Box | null {
    return this.faces.find((f) => f.id === id)?.box ?? null;
  }
}
