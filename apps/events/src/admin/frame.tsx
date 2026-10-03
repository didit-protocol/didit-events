/**
 * Frame helper for the admin: a FrameDef whose render is the design frame box (the design's own
 * `data-screen-label`, exact width and height, 4px corners, white page) on the #E9E9EB canvas.
 */
import type { CSSProperties, ReactNode } from "react";
import type { FrameDef } from "@didit-events/ui/frames/registry";

export const CANVAS = "#E9E9EB";

export interface AdminFrameOptions {
  /** Frame box background (A-01 is #F8F8F8, A-07 is the 24% scrim). */
  background?: string;
  radius?: number;
}

/**
 * `code` is the design's frame id (A-02a, A-02-1024, …); `label` is its data-screen-label, which the pixel gate
 * pairs with the design capture.
 */
export function adminFrame(code: string, label: string, w: number, h: number, render: () => ReactNode, opts: AdminFrameOptions = {}): FrameDef {
  const name = label.slice(label.indexOf(" ") + 1);
  const style: CSSProperties = { width: w, height: h, position: "relative", overflow: "hidden", background: opts.background ?? "#FEFEFE", borderRadius: opts.radius ?? 4 };
  return {
    code,
    name,
    app: "events",
    viewport: { w, h },
    background: CANVAS,
    render: () => (
      <div data-screen-label={label} style={style}>
        {render()}
      </div>
    ),
  };
}
