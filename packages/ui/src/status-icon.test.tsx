import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { StatusIcon } from "./index";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("StatusIcon", () => {
  it("every tone draws an SVG mark (no text glyph) and is decorative", () => {
    for (const tone of ["success", "pending", "info", "warning", "error", "review", "neutral"] as const) {
      const out = html(<StatusIcon tone={tone} />);
      expect(out).toMatch(new RegExp(`^<span class="icon" style="width:56px;height:56px" aria-hidden="true" data-status-icon="${tone}"( data-animate="")?><svg viewBox="0 0 24 24"`));
      expect(out).toContain('focusable="false"');
      expect(out.replace(/<[^>]+>/g, "")).toBe("");
    }
  });

  it("tones pick their own mark; an icon overrides it", () => {
    expect(html(<StatusIcon tone="pending" />)).toContain("M12 7.5V12l3 2");
    expect(html(<StatusIcon tone="error" />)).toContain('d="M7 7l10 10M17 7 7 17"');
    expect(html(<StatusIcon tone="review" />)).toContain("a2.75 2.75");
    expect(html(<StatusIcon tone="info" />)).toContain('d="M12 6.75h.01M12 11v7"');
    expect(html(<StatusIcon tone="info" icon="mail" />)).toContain("M3.5 7l8.5 6 8.5-6");
    expect(html(<StatusIcon tone="neutral" icon="question" size={64} />)).toContain("width:64px;height:64px");
  });

  it("success animates the check (pathLength 1) unless turned off; other tones never animate", () => {
    const ok = html(<StatusIcon tone="success" size={88} />);
    expect(ok).toContain('data-status-icon="success" data-animate=""');
    expect(ok).toMatch(/<path d="M5 12.5l4.5 4.5L19 7.5" pathLength="1"/);
    expect(html(<StatusIcon tone="success" animate={false} />)).not.toMatch(/data-animate|pathLength/);
    expect(html(<StatusIcon tone="neutral" icon="check" />)).not.toMatch(/data-animate|pathLength/);
  });

  it("the animation is ~450 ms and off under prefers-reduced-motion", () => {
    const css = readFileSync(new URL("./components/StatusIcon.module.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.icon\[data-animate\] \{ animation: pop 300ms/);
    expect(css).toMatch(/draw 260ms [^;]* 190ms forwards/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.icon\[data-animate\] \{ animation: none; \}\s*\.icon\[data-animate\] path \{ animation: none; stroke-dashoffset: 0; \}/);
  });
});
