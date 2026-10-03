import { renderToStaticMarkup } from "react-dom/server";
import type * as EmailModule from "@didit-events/core/email";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FrameView, getFrame, listFrames, screenLabel } from "@didit-events/ui/frames";
import "../../frames";
import { EMAIL_FRAME_VIEWPORT, emailFrame, emailFrames } from "./frames";

const CODES = [...Array.from({ length: 29 }, (_, i) => `M-${String(i + 1).padStart(2, "0")}`), "E-01", "E-02", "E-03", "T-01"];

/** The design's data-screen-label for each frame with a design counterpart (M-17 redrawn, M-23/M-24 new). */
// Model v2 confirms admission separately from checks and names renewal explicitly.
const DESIGN_LABELS: Record<string, string[]> = {
  "M-01": ["M-01 Sign-in code · Didit Events"],
  "M-02": ["M-02 Request received"],
  "M-06": ["M-06 You’re in"],
  "M-13": ["M-13 Welcome · checked in"],
  "M-16": ["M-16 Event update · time change"],
  "M-22": ["M-22 Account deleted"],
  "E-01": ["E-01 Renew a required check · desktop 600", "E-01 Renew a required check · mobile 390"],
  "E-02": ["E-02 Welcome · checked in · desktop 600", "E-02 Welcome · checked in · mobile 390"],
  "E-03": ["E-03 Request received · desktop 600", "E-03 Request received · mobile 390"],
};

describe("email frames", () => {
  it("registers every U6 code in the events gallery", () => {
    expect(emailFrames.map((f) => f.code).sort()).toEqual([...CODES].sort());
    const listed = listFrames("events").map((f) => f.code);
    for (const code of CODES) {
      expect(listed, code).toContain(code);

    }
  });

  it.each(CODES)("%s server-renders with its label, header and the email iframe", (code) => {
    const frame = getFrame(code, "events")!;
    // Design email frames are 680 wide with a content-driven height (see EMAIL_FRAME_VIEWPORT).
    expect(frame.viewport).toEqual({ w: 680, h: 1400 });
    expect(frame.viewport).toEqual(EMAIL_FRAME_VIEWPORT);
    const out = renderToStaticMarkup(<FrameView app="events" code={code} />);
    expect(out).toContain(`data-frame="${code}"`);
    const labels = [...out.matchAll(/data-screen-label="([^"]+)"/g)].map((m) => m[1]);
    expect(labels.length).toBe(code.startsWith("E-") ? 2 : 1);
    expect(labels[0]!.startsWith(code)).toBe(true);
    if (!code.startsWith("E-")) expect(labels[0]).toBe(screenLabel(frame));
    for (const l of DESIGN_LABELS[code] ?? []) expect(labels, code).toContain(l);
    // Two renderings (600 desktop + 390 mobile), each a sandboxed srcdoc iframe of the full email.
    expect(out.match(/<iframe /g)?.length).toBe(2);
    expect(out).toMatch(/srcDoc="&lt;!DOCTYPE html&gt;/);
    expect(out).toContain("didit-logo.png");
  });
});

describe("email frames are lazy and isolated", () => {
  afterEach(() => {
    vi.doUnmock("@didit-events/core/email");
    vi.resetModules();
  });

  it("a throwing loader shows an error tile for that frame only", () => {
    const broken = emailFrame("M-05", () => {
      throw new Error("template exploded");
    });
    const out = renderToStaticMarkup(<>{broken.render()}</>);
    expect(out).toContain('data-frame-error="M-05"');
    expect(out).toContain("M-05 failed to render: template exploded");
    expect(out).not.toContain("data-screen-label");
  });

  it("importing the registry renders no email; a throwing template breaks neither the import nor other frames", async () => {
    vi.resetModules();
    const rendered: string[] = [];
    vi.doMock("@didit-events/core/email", async (importOriginal) => {
      const real = await importOriginal<typeof EmailModule>();
      return {
        ...real,
        renderEmail: ((code, data) => {
          rendered.push(code);
          if (code === "M-05") throw new Error("M-05 template exploded");
          return real.renderEmail(code, data);
        }) as typeof real.renderEmail,
      };
    });
    const ui = await import("@didit-events/ui/frames");
    await import("../../frames");
    expect(rendered).toEqual([]);
    expect(ui.listFrames("events").map((f) => f.code)).toEqual(expect.arrayContaining(CODES));

    const broken = renderToStaticMarkup(<ui.FrameView app="events" code="M-05" />);
    expect(broken).toContain('data-frame="M-05"');
    expect(broken).toContain("M-05 failed to render: M-05 template exploded");
    expect(rendered).toEqual(["M-05"]);

    const ok = renderToStaticMarkup(<ui.FrameView app="events" code="M-06" />);
    expect(ok).toContain('data-screen-label="M-06 You’re in"');
    expect(ok.match(/<iframe /g)?.length).toBe(2);
    expect(rendered).toEqual(["M-05", "M-06"]);
  });
});
