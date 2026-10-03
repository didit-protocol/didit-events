// @vitest-environment jsdom
import { act, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MarkdownPreview, parseBlocks, safeHttpsUrl } from "./markdown";
import { MarkdownEditor, insertLink, prefixLines, wrap } from "./MarkdownEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const html = (src: string) => renderToStaticMarkup(<MarkdownPreview source={src} />);

describe("safe Markdown preview", () => {
  it("renders the allowed subset: demoted h1, h2–h4, lists, emphasis, quotes, code, https links and images", () => {
    const out = html("# Title\n## Sub\n#### Deep\n###### Deeper\n\nSome **bold** and _it_ and `code`.\n\n- a\n- b\n\n1. one\n2. two\n\n> quoted\n\n```\nx < y\n```\n\n[Didit](https://didit.me) ![Hall](https://cdn.example.com/a.jpg)");
    expect(out).toContain("<h2>Title</h2>");
    expect(out).toContain("<h2>Sub</h2>");
    expect(out).toContain("<h4>Deep</h4><h4>Deeper</h4>");
    expect(out).not.toContain("<h1");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>it</em>");
    expect(out).toContain("<code>code</code>");
    expect(out).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(out).toContain("<ol><li>one</li><li>two</li></ol>");
    expect(out).toContain("<blockquote>quoted</blockquote>");
    expect(out).toContain("<pre><code>x &lt; y</code></pre>");
    expect(out).toContain('<a href="https://didit.me/" target="_blank" rel="noopener noreferrer nofollow">Didit</a>');
    expect(out).toContain('<img src="https://cdn.example.com/a.jpg" alt="Hall" loading="lazy" referrerPolicy="no-referrer"/>');
  });

  it("never produces markup from the source: raw HTML is text, unsafe URLs are not links", () => {
    const out = html('<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n[x](javascript:alert(1)) [y](http://plain.example) [z](https://user:pw@evil.example) ![i](data:image/png;base64,AAA)');
    expect(out).not.toMatch(/<script|<img src="x"|<[a-z]+[^>]*onerror|href="javascript|href="http:|user:pw|src="data:/);
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).toContain(" y z ");
  });

  it("URL rule and bounded parsing", () => {
    expect(safeHttpsUrl("https://a.example/p?q=1")).toBe("https://a.example/p?q=1");
    for (const bad of ["http://a.example", "javascript:alert(1)", "https://u:p@a.example", "https://a b", "//a.example", "ftp://a"]) expect(safeHttpsUrl(bad)).toBeNull();
    expect(parseBlocks("x".repeat(30_000))[0]).toEqual({ t: "p", lines: ["x".repeat(20_000)] });
  });
});

describe("toolbar edits", () => {
  it("wraps the selection or a placeholder, toggles line prefixes, inserts links and images", () => {
    expect(wrap("hello world", 6, 11, "**", "bold text")).toEqual({ text: "hello **world**", start: 8, end: 13 });
    expect(wrap("", 0, 0, "_", "italic text").text).toBe("_italic text_");
    expect(prefixLines("a\nb\nc", 0, 3, "- ").text).toBe("- a\n- b\nc");
    expect(prefixLines("- a\n- b", 0, 7, "- ").text).toBe("a\nb");
    expect(prefixLines("- item", 0, 0, "## ").text).toBe("## item");
    expect(insertLink("see ", 4, 4, "link", "https://didit.me/", "Didit").text).toBe("see [Didit](https://didit.me/)");
    expect(insertLink("", 0, 0, "image", "https://x.example/a.png", "A [b]").text).toBe("![A b](https://x.example/a.png)");
  });
});

describe("MarkdownEditor", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  function Harness({ initial = "", allowImages = true }: { initial?: string; allowImages?: boolean }) {
    const [v, setV] = useState(initial);
    return <MarkdownEditor label="Full description" name="descriptionMd" value={v} onChange={setV} maxLength={20_000} allowImages={allowImages} />;
  }
  const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const tab = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent === name)!;
  const area = () => host.querySelector("textarea")!;

  it("Bold wraps the selection; Preview shows the safe rendering; the hidden field posts the source", () => {
    act(() => root.render(<Harness initial="hello world" />));
    act(() => area().setSelectionRange(6, 11));
    act(() => button("Bold").click());
    expect(area().value).toBe("hello **world**");
    expect(host.querySelector<HTMLInputElement>('input[name="descriptionMd"]')!.value).toBe("hello **world**");
    act(() => tab("Preview").click());
    expect(tab("Preview").getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('[role="tabpanel"]')!.innerHTML).toContain("<strong>world</strong>");
  });

  it("Link asks for an https URL, rejects others, and inserts at the selection", () => {
    act(() => root.render(<Harness initial="Read the agenda" />));
    act(() => area().setSelectionRange(9, 15));
    act(() => button("Link").click());
    const url = host.querySelector<HTMLInputElement>('input[placeholder="https://"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { setValue.call(url, "javascript:alert(1)"); url.dispatchEvent(new Event("input", { bubbles: true })); });
    const insert = [...host.querySelectorAll("button")].find((b) => b.textContent === "Insert")!;
    act(() => insert.click());
    expect(host.textContent).toContain("Use a full https:// address");
    act(() => { setValue.call(url, "https://didit.me/agenda"); url.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => insert.click());
    expect(area().value).toBe("Read the [agenda](https://didit.me/agenda)");
  });

  it("the image button is hidden where remote images are not allowed (email bodies)", () => {
    act(() => root.render(<Harness allowImages={false} />));
    expect(host.querySelector('button[aria-label="Image from URL"]')).toBeNull();
    expect(button("Heading")).not.toBeNull();
  });
});
