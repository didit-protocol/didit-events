import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EventPage } from "./components/EventPage";
import { AI_ERA } from "./fixtures";
import type { PublicEvent } from "./types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));

const page = (event: PublicEvent) => renderToStaticMarkup(<EventPage event={event} related={[]} viewer={null} staff={null} card={{ kind: "signed_out" } as never} now={new Date("2026-10-01T10:00:00Z")} actions={{} as never} />);

describe("generated cover copy", () => {
  it("an event without accent, eyebrow or tag never shows the AI Era sample copy", () => {
    const html = page({ ...AI_ERA, title: "QA night", accent: undefined, panels: [], cover: { theme: "aqua" } });
    expect(html).toContain("QA night");
    expect(html).not.toMatch(/AI Era|AN EVENING FOR FOUNDERS|DIDIT EVENTS · BARCELONA/);
    expect(html).toContain("EVENTS BY DIDIT");
  });
});
