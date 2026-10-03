import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { listFrames } from "@didit-events/ui/frames";
import "../../../frames";
import { KIOSK_FRAME_SPECS } from "./frames";

/** Every door frame: K-01…K-13 (design), K-14…K-21 (design-prompt §3) and D-01…D-03 (the door inside Events), landscape and portrait. */
const EXPECTED = [
  "K-01", "K-02a", "K-02b", "K-02c", "K-03a", "K-03b", "K-03c", "K-03d", "K-03e", "K-03f",
  "K-04", "K-05a", "K-05b", "K-06", "K-07", "K-08", "K-09", "K-10", "K-11", "K-12a", "K-12b", "K-12c", "K-13",
  "K-14", "K-15", "K-16", "K-17", "K-18", "K-19", "K-21", "K-12d", "K-17b",
  "D-01a", "D-01b", "D-01c", "D-01d", "D-01e", "D-02a", "D-02b", "D-03a", "D-03b", "D-03c",
  "L-01", "L-02", "L-03",
];

const kiosk = () => listFrames("events").filter((f) => /^[KDL]-\d/.test(f.code));

describe("kiosk /_frames registry", () => {
  it("registers every K code in both orientations at the design viewport", () => {
    const codes = kiosk().map((f) => f.code);
    for (const id of EXPECTED) {
      expect(codes).toContain(id);
      expect(codes).toContain(`${id}-portrait`);
    }
    expect(codes).toHaveLength(EXPECTED.length * 2);
    for (const f of kiosk()) {
      expect(f.app).toBe("events");
      expect(f.viewport).toEqual(f.code.endsWith("-portrait") ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 });
    }
  });

  it.each(kiosk().map((f) => [f.code, f] as const))("%s server-renders with its design label", (code, f) => {
    const out = renderToStaticMarkup(<>{f.render()}</>);
    const spec = KIOSK_FRAME_SPECS.find((s) => code === s.id || code === `${s.id}-portrait`)!;
    const label = code.endsWith("-portrait") ? `${spec.label} · portrait` : spec.label;
    const attr = label.replace(/'/g, "&#x27;");
    expect(out).toContain(`data-screen-label="${attr}"`);
    expect(out).toContain(`width:${f.viewport.w}px;height:${f.viewport.h}px`);
    expect(out).toContain("19:42");
  });

  it("design copy lands exactly", () => {
    const render = (code: string) => renderToStaticMarkup(<>{kiosk().find((f) => f.code === code)!.render()}</>);
    expect(render("K-01")).not.toContain("Welcome to");
    expect(render("K-01")).toContain("Barcelona Office Opening"); // the event name, in the top bar
    // The guest-facing arrival counter is removed; staff see the count in the operator panel.
    expect(render("K-01")).not.toContain("arrived");
    expect(render("D-01a")).toContain("Doors open Thu 8 Oct, 18:30");
    expect(render("D-03a")).toContain("TEST MODE — nobody is being checked in");
    expect(render("D-03b")).toContain("Test mode: would be checked in. Nobody was.");
    expect(render("D-02a")).toContain("Door session expired");
    expect(render("K-12d")).toContain("ref req_4f2a9c");
    expect(render("K-06")).toContain("Checked in at 19:42");
    expect(render("K-13")).toContain("OPERATOR · MAIN DOOR");
    expect(render("K-13")).toContain("Standard 80");
    expect(render("K-14")).toContain("Staffed entry");
    expect(render("K-21")).toContain("Manual check-in in the admin");
    expect(render("K-21")).toMatch(/<svg[^>]*aria-label="QR code/);
    // v5 live door: names on the tags (long ones cut), the blue badge, status chips, the rail; never a full-screen result.
    const live = render("L-01");
    expect(live).toContain("Maria García");
    expect(live).toContain("Maximiliana Alessandra Fi…");
    expect(live).toContain("data-verified-badge");
    expect(live).toContain("Checked in");
    expect(live).toContain("Checking…");
    expect(live).toContain("Not on the list");
    expect(live).toContain("Unknown");
    expect(live).toContain('aria-label="Arrivals"');
    expect(live).not.toContain("Welcome,");
    expect(render("L-02")).toContain("Offline · reconnecting in 5s");
    expect(render("L-03")).toContain("Walk up — we’ll recognise you");
  });
});
