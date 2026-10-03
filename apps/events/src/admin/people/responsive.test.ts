import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./People.module.css", import.meta.url), "utf8");
const block = (query: string) => {
  const from = css.indexOf(query);
  expect(from).toBeGreaterThan(-1);
  return css.slice(from, css.indexOf("\n}\n", from));
};

describe("People, responsive", () => {
  it("the layout follows the page box (its own size container), not the shell's width", () => {
    expect(css).toContain("container: people / inline-size");
    expect(css).not.toContain("@container admin");
  });

  it("a narrow column gets the avatar list and a fading, 44px-tall chip row instead of the four-column table", () => {
    const narrow = block("@container people (max-width: 600px)");
    expect(narrow).toContain(".filterMenu, .compact { display: none; }");
    expect(narrow).toContain(".phoneList { display: block; }");
    expect(narrow).toContain("mask-image: linear-gradient");
    expect(narrow).toContain(".phoneChips a::after");
    expect(narrow).toContain(".search input { font-size: 16px; }");
  });

  it("the toolbar chip row is hidden once the menu or the phone row takes over, whatever the stylesheet order", () => {
    // `.chips` alone ties with FilterChips' own `.chips { display: flex }`: at 390px both chip rows showed.
    const medium = block("@container people (max-width: 820px)");
    expect(medium).toContain(".chips.chips, .desktop { display: none; }");
    expect(css.match(/\.phoneChips \{\s*display: flex/g)).toHaveLength(1);
  });

  it("the compact table keeps its headers on one line", () => {
    expect(css).toContain(".cHead > * { white-space: nowrap; }");
  });
});
