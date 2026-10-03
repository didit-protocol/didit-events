import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FRAMES_APP, FrameView, getFrame } from "../../frames";
import { ACCOUNT_FRAME_CODES, accountFrames } from "./frames";

const range = (prefix: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}-${String(from + i).padStart(2, "0")}`);
const EXPECTED = [...range("R", 1, 34), ...range("U", 1, 42), ...range("DA", 1, 5), ...range("O", 1, 13), ...range("Q", 1, 12), ...range("DG", 1, 8)];

describe("U5 frames in /_frames", () => {
  it("registers every frame code of the lane, once", () => {
    expect([...ACCOUNT_FRAME_CODES].sort()).toEqual([...EXPECTED].sort());
    expect(new Set(ACCOUNT_FRAME_CODES).size).toBe(ACCOUNT_FRAME_CODES.length);
  });

  it.each(EXPECTED)("%s server-renders at its design viewport with its label", (code) => {
    const def = getFrame(code, FRAMES_APP);
    expect(def, code).toBeDefined();
    const html = renderToStaticMarkup(<FrameView app={FRAMES_APP} code={code} />);
    expect(html).toContain(`data-screen-label="${code} ${def!.name}"`);
    expect(html).toContain(`width:${def!.viewport.w}px`);
    expect(html).toContain(`height:${def!.viewport.h}px`);
    expect(def!.viewport).toEqual(code.startsWith("DA-") || code.startsWith("DG-") ? { w: 1440, h: 900 } : { w: 390, h: 844 });
  });

  it("uses the design labels for the frames page 04 and 05 already draw", () => {
    const names = Object.fromEntries(accountFrames.map((f) => [f.code, f.name]));
    expect(names["R-01"]).toBe("Register · empty");
    expect(names["R-19"]).toBe("You are in · face ticket");
    expect(names["U-20"]).toBe("My events");
    expect(names["U-42"]).toBe("Selfie expired · re-verify only that");
    expect(names["DA-01"]).toBe("Sign in · choose");
  });

  it("every sign-in surface carries the Secured by Didit caption (design-prompt §2)", async () => {
    for (const code of ["U-01", "U-04", "U-06", "U-08", "U-09", "U-10", "U-11", "U-12", "U-23", "R-01", "R-04", "R-05", "R-06", "R-07", "R-33", "DA-01", "DA-03", "DA-05", "R-10", "R-21", "U-14", "U-39", "U-42", ...range("O", 1, 11), "O-13", "DG-03", "Q-05", "Q-07"]) {
      // The extra-check step now streams only when needed.
      const stream=await renderToReadableStream(<FrameView app={FRAMES_APP} code={code} />);await stream.allReady;
      expect(await new Response(stream).text(),code).toContain("Secured by Didit");
    }
  });

  it("magic-link frames are drawn as 6-digit Didit code entry, never as links", () => {
    for (const code of ["U-08", "U-10", "U-12", "DA-03"]) {
      const html = renderToStaticMarkup(<FrameView app={FRAMES_APP} code={code} />);
      expect(html, code).toContain('autoComplete="one-time-code"');
      expect(html, code).not.toMatch(/sign-in link/i);
    }
  });
});
