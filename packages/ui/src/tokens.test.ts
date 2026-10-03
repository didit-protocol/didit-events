import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = import.meta.dirname;

describe("ui tokens + fonts", () => {
  it("tokens.css carries the brand tokens and routes Inter through next/font", () => {
    const css = readFileSync(resolve(here, "tokens.css"), "utf8");
    expect(css).toMatch(/--brand:\s*#2567FF/i);
    expect(css).toContain(".t-display-sm");
    expect(css).toContain("--font-sans: var(--font-inter)");
    expect(css).not.toContain("url(");
  });

  it.each(["Inter-Variable.woff2", "Inter-Italic-Variable.woff2"])("%s is a woff2 under 350 KB", (file) => {
    const path = resolve(here, "../fonts", file);
    expect(readFileSync(path).subarray(0, 4).toString("latin1")).toBe("wOF2");
    expect(statSync(path).size).toBeLessThanOrEqual(350 * 1024);
  });
});
