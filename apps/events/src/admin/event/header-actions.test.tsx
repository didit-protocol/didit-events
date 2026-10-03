import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EventHeaderActions } from "./EventHeaderActions";
import type { EventHeaderInfo } from "../types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), useSelectedLayoutSegment: () => "settings" }));

const event = (status: EventHeaderInfo["status"]): EventHeaderInfo => ({ id: "e1", name: "E2E Test Event", status, when: "Thu, 1 Oct 2026", requestLink: "events.didit.me/e/e2e-test", guestCount: 0, requestCount: 0 });

describe("event header actions (top right, every tab)", () => {
  it("shows the event link as open + copy icon buttons, not a text field", () => {
    const html = renderToStaticMarkup(<EventHeaderActions event={event("open")} />);
    expect(html).toContain('href="https://events.didit.me/e/e2e-test"');
    expect(html).toContain('aria-label="Open the event page in a new tab"');
    expect(html).toContain('aria-label="Copy the event link"');
    expect(html).not.toContain(">events.didit.me/e/e2e-test<");
  });
  it("opens the event page on APP_URL's own scheme: http on localhost, never a forced https", () => {
    const local = renderToStaticMarkup(<EventHeaderActions event={{ ...event("open"), requestLink: "localhost:3000/e/e2e-test", publicUrl: "http://localhost:3000/e/e2e-test" }} />);
    expect(local).toContain('href="http://localhost:3000/e/e2e-test"');
    expect(local).not.toContain("https://localhost");
  });
  it("offers Publish while draft and Cancel once published; nothing after it ended", () => {
    expect(renderToStaticMarkup(<EventHeaderActions event={event("draft")} />)).toContain("Publish event");
    const open = renderToStaticMarkup(<EventHeaderActions event={event("open")} />);
    expect(open).toContain("Cancel event");
    expect(open).not.toContain("Publish event");
    const ended = renderToStaticMarkup(<EventHeaderActions event={event("ended")} />);
    expect(ended).not.toContain("Cancel event");
    expect(ended).not.toContain("Publish event");
  });
  it("a cancelled event has no door and nothing left to cancel or publish; its link actions stay", () => {
    expect(renderToStaticMarkup(<EventHeaderActions event={event("ended")} />)).toContain("Open door");
    const cancelled = renderToStaticMarkup(<EventHeaderActions event={event("cancelled")} />);
    expect(cancelled).not.toContain("Open door");
    expect(cancelled).not.toContain("Cancel event");
    expect(cancelled).not.toContain("Publish event");
    expect(cancelled).toContain('aria-label="Copy the event link"');
  });
  it("phones: the link actions and Cancel sit in the More panel; Publish stays in the row", () => {
    const open = renderToStaticMarkup(<EventHeaderActions event={event("open")} />);
    expect(open).toMatch(/aria-label="More actions" aria-expanded="false"/);
    const panel = open.slice(open.indexOf('class="morePanel"'));
    expect(panel).toContain("Open event page");
    expect(panel).toContain("Copy event link");
    expect(panel.indexOf("Cancel event")).toBeGreaterThan(panel.indexOf("Copy event link"));
    const draft = renderToStaticMarkup(<EventHeaderActions event={event("draft")} />);
    expect(draft.indexOf("Publish event")).toBeLessThan(draft.indexOf('class="morePanel"'));
  });
  it("shows the Door to every role and lifecycle buttons only to roles that hold them", () => {
    const as = (role: EventHeaderInfo["role"], status: EventHeaderInfo["status"] = "open") => renderToStaticMarkup(<EventHeaderActions event={{ ...event(status), role }} />);
    expect(as("operator")).toContain('href="/admin/events/e1/door"');
    expect(as("operator")).not.toContain("Cancel event");
    expect(as("operator", "draft")).not.toContain("Publish event");
    expect(as("host", "draft")).toContain("Publish event");
    expect(as("host")).not.toContain("Cancel event");
    expect(as("staff")).toContain("Cancel event");
  });
});
