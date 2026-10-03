import type { ReactNode } from "react";

/** Which app's gallery shows a frame. "shared" frames (T-00, C-00, …) show in both. */
export type FrameApp = "shared" | "events";

export interface FrameDef {
  /** Design code, matching the frame's `data-screen-label` prefix (e.g. "A-02", "K-06a"). */
  code: string;
  /** Human name; with the code it forms the data-screen-label ("A-02 Events list"). */
  name: string;
  app: FrameApp;
  /** The design frame's size; the gallery page renders at exactly this width. */
  viewport: { w: number; h: number };
  /** Background behind the frame (the design canvas). */
  background?: string;
  render: () => ReactNode;
}

const frames = new Map<string, FrameDef>();

/** Adds frames (later lanes call this from their app's `frames.ts`). A duplicate code throws. */
export function registerFrames(defs: FrameDef[]): void {
  for (const def of defs) {
    const existing = frames.get(def.code);
    if (existing && existing !== def) throw new Error(`frame ${def.code} is already registered`);
    frames.set(def.code, def);
  }
}

export function getFrame(code: string, app: Exclude<FrameApp, "shared">): FrameDef | undefined {
  const def = frames.get(code);
  return def && (def.app === "shared" || def.app === app) ? def : undefined;
}

export function listFrames(app: Exclude<FrameApp, "shared">): FrameDef[] {
  return [...frames.values()].filter((f) => f.app === "shared" || f.app === app).sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
}

/** The `data-screen-label` the pixel scripts match between design and app. */
export const screenLabel = (f: Pick<FrameDef, "code" | "name">) => `${f.code} ${f.name}`;

/** Test helper. */
export function clearFrames(): void {
  frames.clear();
}
