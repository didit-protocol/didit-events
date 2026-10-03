import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventsList } from "./EventsList";
import { ADMIN_EVENTS } from "./fixtures";
import { statusCounts } from "./filter";

const css = readFileSync(new URL("./EventsList.module.css", import.meta.url), "utf8");

describe("A-02 Events list, responsive", () => {
  it("the status filter is one chip row at every width (never hidden without a replacement)", () => {
    const html = renderToStaticMarkup(<EventsList events={ADMIN_EVENTS} counts={statusCounts(ADMIN_EVENTS)} q="" status="all" />);
    expect(html.match(/aria-label="Filter events by status"/g)).toHaveLength(1);
    expect(css).not.toMatch(/\.chips\s*\{[^}]*display:\s*none/);
    // Compact: the chips scroll sideways under the search and the row shows its counts line.
    const compact = css.slice(css.indexOf("@container eventslist (max-width: 880px)"));
    expect(compact).toMatch(/\.chips\.chips \{[^}]*overflow-x: auto/);
    expect(compact).toMatch(/\.counts \{ display: block/);
    expect(compact).not.toContain(".search svg");
  });

  it("a cancelled event's pill reads CANCELLED, never ENDED", () => {
    const rows = [{ ...ADMIN_EVENTS[0]!, id: "cancelled-one", status: "cancelled" as const }];
    const html = renderToStaticMarkup(<EventsList events={rows} counts={statusCounts(rows)} q="" status="all" />);
    expect(html).toContain('data-status="cancelled"');
    expect(html).toContain(">Cancelled<");
    expect(html).not.toContain('data-status="ended"');
  });

  it("the layout follows the page box (its own size container), not the shell's width", () => {
    const html = renderToStaticMarkup(<EventsList events={ADMIN_EVENTS} counts={statusCounts(ADMIN_EVENTS)} q="" status="all" />);
    expect(html).toMatch(/^<div class="[^"]*\bpage\b[^"]*\bpage\b/);
    expect(css).toContain(".page { container: eventslist / inline-size; }");
    expect(css).not.toContain("@container admin");
    // Phones: a 16px search input (no iOS zoom on focus).
    expect(css.slice(css.indexOf("@container eventslist (max-width: 560px)"))).toContain(".search input { font-size: 16px; }");
  });
});
