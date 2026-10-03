import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventPage } from "./components/EventPage";
import { AI_ERA } from "./fixtures";
import { agendaTime } from "./format";
import type { PublicEvent } from "./types";

const page = (event: PublicEvent) =>
  renderToStaticMarkup(<EventPage event={event} related={[]} viewer={null} card={{ kind: "signed_out" }} now={new Date("2026-09-30T12:00:00Z")} actions={{ verify: async () => {}, subscribe: async () => {} }} />);

describe("agenda end times", () => {
  it("renders 19:10–20:00 when an item has an end after its start, else 19:10", () => {
    expect(agendaTime({ at: "2026-10-23T17:10:00.000Z", endAt: "2026-10-23T18:00:00.000Z" }, "Europe/Madrid")).toBe("19:10–20:00");
    expect(agendaTime({ at: "2026-10-23T17:10:00.000Z" }, "Europe/Madrid")).toBe("19:10");
    expect(agendaTime({ at: "2026-10-23T17:10:00.000Z", endAt: "2026-10-23T17:00:00.000Z" }, "Europe/Madrid")).toBe("19:10");
  });
  it("the event page shows the range in the time column", () => {
    const html = page({ ...AI_ERA, timeZone: "Europe/Madrid", agenda: [{ at: "2026-10-23T17:10:00.000Z", endAt: "2026-10-23T18:00:00.000Z", label: "Talk" }, { at: "2026-10-23T18:00:00.000Z", label: "Drinks" }] });
    expect(html).toMatch(/>19:10–20:00<\/td><td[^>]*>Talk</);
    expect(html).toMatch(/>20:00<\/td><td[^>]*>Drinks</);
  });
  it("the mobile layout shows the same Markdown description and agenda (with end times) as desktop, not the summary", () => {
    const html = page({ ...AI_ERA, timeZone: "Europe/Madrid", summary: "Short summary only", descriptionHtml: "<p>Full <strong>Markdown</strong> description</p>",
      agenda: [{ at: "2026-10-23T17:10:00.000Z", endAt: "2026-10-23T18:00:00.000Z", label: "Talk" }, { at: "2026-10-23T22:30:00.000Z", label: "After midnight" }] });
    // Both layouts are rendered (a container query picks one): every piece appears once in each.
    const count = (re: RegExp) => html.match(new RegExp(re.source, "g"))?.length ?? 0;
    expect(count(/<p>Full <strong>Markdown<\/strong> description<\/p>/)).toBe(2);
    expect(count(/>19:10–20:00<\/td><td[^>]*>Talk</)).toBe(2);
    expect(count(/>00:30<\/td><td[^>]*>After midnight</)).toBe(2);
    expect(count(/>Agenda<\/h2>/)).toBe(2);
    expect(html).not.toContain("Short summary only");
  });
  it("the agenda is one table per layout: a time cell and an item cell per row, emphasis rows marked", () => {
    const html = page({ ...AI_ERA, timeZone: "Europe/Madrid", agenda: [{ at: "2026-10-23T17:10:00.000Z", endAt: "2026-10-23T18:00:00.000Z", label: "Panel", emphasis: true }, { at: "2026-10-23T18:00:00.000Z", label: "Drinks" }] });
    const tables = html.match(/<table[\s\S]*?<\/table>/g) ?? [];
    expect(tables).toHaveLength(2);
    for (const table of tables) {
      expect(table).toMatch(/<thead[^>]*><tr><th scope="col">Time<\/th><th scope="col">Item<\/th><\/tr><\/thead>/);
      expect(table.match(/<tr class=/g)).toHaveLength(2);
      const [strong, plain] = [/<td class="([^"]*)">Panel</.exec(table)![1]!, /<td class="([^"]*)">Drinks</.exec(table)![1]!];
      expect(strong.split(" ")).toHaveLength(plain.split(" ").length + 1);
    }
  });
});
