import { createElement } from "react";
import { C00Components } from "./C00";
import { registerFrames, type FrameDef } from "./registry";
import { T00Tokens } from "./T00";

export { registerFrames, getFrame, listFrames, screenLabel, clearFrames, type FrameDef, type FrameApp } from "./registry";
export { framesEnabled } from "./guard";

/** Frames from design/00 Foundations.dc.html, shown in both apps' galleries. */
export const foundationFrames: FrameDef[] = [
  { code: "T-00", name: "Tokens", app: "shared", viewport: { w: 1440, h: 1600 }, background: "var(--canvas)", render: () => createElement(T00Tokens) },
  { code: "C-00", name: "Components", app: "shared", viewport: { w: 1440, h: 2700 }, background: "var(--canvas)", render: () => createElement(C00Components) },
];

registerFrames(foundationFrames);
export { FrameIndex, FrameView } from "./Gallery";
