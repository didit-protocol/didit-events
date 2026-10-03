import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FRAMES_APP, FrameView, getFrame } from "../../frames";
import { PUBLIC_FRAME_CODES, publicFrames } from "./frames";

const EXPECTED = [
  "P-01",
  "P-01-mobile",
  ..."abcdefghijklmn".split("").map((l) => `P-02${l}`),
  "P-03a",
  "P-03b",
  ..."abcde".split("").map((l) => `V-01${l}`),
  ..."abcdefghij".split("").map((l) => `G-01${l}`),
  ..."abcde".split("").map((l) => `G-02${l}`),
  ..."abcd".split("").map((l) => `G-03${l}`),
];

describe("U4 frames in /_frames", () => {
  it("registers every frame code of the lane", () => {
    expect([...PUBLIC_FRAME_CODES].sort()).toEqual([...EXPECTED].sort());
  });

  it.each(EXPECTED)("%s server-renders with its design label and viewport", (code) => {
    const def = getFrame(code, FRAMES_APP);
    expect(def, code).toBeDefined();
    const html = renderToStaticMarkup(<FrameView app={FRAMES_APP} code={code} />);
    const label = /data-screen-label="([^"]+)"/.exec(html)?.[1];
    expect(label).toBeDefined();
    // The label's design code matches the frame (variants share it: "P-02 Pending approval" for P-02b).
    expect(code.startsWith(label!.split(" ")[0]!)).toBe(true);
    expect(html).toContain(`width:${def!.viewport.w}px`);
  });

  it("pairs state variants with the design labels in design order", () => {
    const labels = publicFrames.filter((f) => f.code.startsWith("P-02")).map((f) => /data-screen-label="([^"]+)"/.exec(renderToStaticMarkup(<>{f.render()}</>))?.[1]);
    expect(labels).toEqual([
      "P-02 Signed out",
      "P-02 Pending approval",
      "P-02 Approved · verify identity",
      "P-02 Verification started",
      "P-02 In review",
      "P-02 You are in",
      "P-02 Declined · retry",
      "P-02 Waitlist",
      "P-02 Not approved",
      "P-02 Event full",
      "P-02 Registration closed",
      "P-02 Checked in (event day)",
      "P-02 Event ended",
      "P-02 Registration cancelled",
    ]);
  });
});
