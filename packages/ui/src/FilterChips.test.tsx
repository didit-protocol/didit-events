import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FilterChips } from "./index";

describe("FilterChips", () => {
  it("renders link chips in a labelled nav, marks the current one, draws optional counts", () => {
    const html = renderToStaticMarkup(
      <FilterChips
        label="Filter events by status"
        items={[
          { key: "all", label: "All 6", href: "/admin", current: true },
          { key: "live", label: "Live", count: 1, href: "/admin?status=live" },
        ]}
      />,
    );
    expect(html).toContain('<nav aria-label="Filter events by status" class="chips">');
    expect(html).toContain('<a href="/admin" class="chip" aria-current="true">All 6</a>');
    expect(html).toContain('<a href="/admin?status=live" class="chip">Live<span class="count">1</span></a>');
  });
});
