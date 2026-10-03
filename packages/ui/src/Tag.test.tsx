import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Tag } from "./index";

describe("Tag", () => {
  it("renders a dot-less tag in every tone", () => {
    for (const tone of ["success", "soft", "neutral", "dark", "warning", "feature", "danger", "brand"] as const) {
      const html = renderToStaticMarkup(<Tag tone={tone}>Welcomed</Tag>);
      expect(html).toBe(`<span class="tag ${tone}" data-tone="${tone}">Welcomed</span>`);
    }
  });

  it("defaults to the soft tone and passes title and className", () => {
    const html = renderToStaticMarkup(
      <Tag title="19:42 · María García" className="x">
        Welcome back
      </Tag>,
    );
    expect(html).toContain('class="tag soft x"');
    expect(html).toContain('title="19:42 · María García"');
  });
});
