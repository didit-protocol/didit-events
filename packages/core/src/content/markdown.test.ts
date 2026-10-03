import { JSDOM } from "jsdom";
import { expect,it } from "vitest";
import { interpolateEditorial,renderSafeMarkdown,sanitizeRenderedMarkdown } from "./markdown.ts";

it("renders bounded CommonMark with raw HTML disabled and HTTPS-only destinations", () => {
  const html = renderSafeMarkdown('# Title\n\n## Section\n\n- **Strong**\n- *Emphasis*\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n[x](https://user:pass@example.com/)\n\n![image](https://example.com/a.png)');
  expect(html).toContain("<h2>Title</h2>");
  expect(html).not.toMatch(/<script|<h1|href="javascript:|href="https:\/\/user/);
  expect(html).toContain('referrerpolicy="no-referrer"');
  expect(html).toContain('loading="lazy"');
  expect(renderSafeMarkdown('[a](https://example.com/)')).toContain('rel="noopener noreferrer nofollow"');
  expect(renderSafeMarkdown('![a](https://example.com/a)', { email: true })).not.toContain("<img");
  expect(() => renderSafeMarkdown("a".repeat(20001))).toThrow("MarkdownTooLarge");
});

it("interpolates editorial values once without interpreting injected Markdown or variables", () => {
  const source = interpolateEditorial("Hello {{first_name}}", { first_name: "[click](https://evil.test/) {{event_name}} <script>x</script>" }, true);
  const html = renderSafeMarkdown(source);
  expect(html).not.toMatch(/<a|<script/);
  expect(html).toContain("{{event_name}}");
});

it("turns a line that is only a YouTube link into a youtube-nocookie embed on the page and a link in emails", () => {
  const embed = (id: string, q = "") => `<iframe src="https://www.youtube-nocookie.com/embed/${id}${q}" title="YouTube video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" style="display:block;width:100%;aspect-ratio:16 / 9;height:auto;border:0;border-radius:12px"></iframe>`;
  expect(renderSafeMarkdown("Intro\n\nhttps://youtu.be/ksi8eAmbTTc\n")).toBe(`<p>Intro</p>\n${embed("ksi8eAmbTTc")}\n`);
  for (const url of ["https://www.youtube.com/watch?v=ksi8eAmbTTc&list=PL1", "https://youtube.com/shorts/ksi8eAmbTTc", "https://m.youtube.com/watch?v=ksi8eAmbTTc", "  https://youtu.be/ksi8eAmbTTc?si=abc  "])
    expect(renderSafeMarkdown(url)).toBe(`${embed("ksi8eAmbTTc")}\n`);
  expect(renderSafeMarkdown("https://youtu.be/ksi8eAmbTTc?t=90s")).toBe(`${embed("ksi8eAmbTTc", "?start=90")}\n`);
  // A URL line inside a paragraph splits it: text, video, text.
  expect(renderSafeMarkdown("Watch **this**:\nhttps://youtu.be/ksi8eAmbTTc\nThen join.")).toBe(`<p>Watch <strong>this</strong>:</p>\n${embed("ksi8eAmbTTc")}\n<p>Then join.</p>\n`);
  // Not a line of its own, another host, a bad id, http, a list item, a quote or code: no embed.
  for (const source of ["See https://youtu.be/ksi8eAmbTTc", "https://youtu.be/ksi8eAmbTTc now", "https://vimeo.com/123456789", "https://youtube.com.evil.test/watch?v=ksi8eAmbTTc", "https://youtu.be/short", "http://youtu.be/ksi8eAmbTTc",
    "https://user@youtu.be/ksi8eAmbTTc", "- https://youtu.be/ksi8eAmbTTc", "> https://youtu.be/ksi8eAmbTTc", "    https://youtu.be/ksi8eAmbTTc", "```\nhttps://youtu.be/ksi8eAmbTTc\n```"])
    expect(renderSafeMarkdown(source)).not.toContain("<iframe");
  // Raw HTML from the author stays text, whatever it points at.
  for (const source of ['<iframe src="https://www.youtube-nocookie.com/embed/ksi8eAmbTTc"></iframe>', '<iframe src="https://evil.test/"></iframe>', 'https://youtu.be/ksi8eAmbTTc"><script>alert(1)</script>'])
    expect(renderSafeMarkdown(source)).not.toMatch(/<iframe|<script/);
  const email = renderSafeMarkdown("Intro\n\nhttps://youtu.be/ksi8eAmbTTc", { email: true });
  expect(email).not.toContain("<iframe");
  expect(email).toContain('<a href="https://youtu.be/ksi8eAmbTTc" rel="noopener noreferrer nofollow">https://youtu.be/ksi8eAmbTTc</a>');
});

// What a browser builds from the output, not what the string looks like: only allowlisted elements, no handlers, and
// HTTPS destinations only.
const ALLOWED = new Set(["p", "h2", "h3", "h4", "ul", "ol", "li", "strong", "em", "blockquote", "code", "pre", "a", "br", "img", "iframe"]);
function expectInert(html: string) {
  const { document } = new JSDOM(`<!doctype html><body><div id="root">${html}</div>`).window;
  // Nothing closed the wrapper early and nothing landed outside it.
  expect([...document.body.children].map(node => node.id)).toEqual(["root"]);
  for (const node of document.querySelectorAll("#root *")) {
    expect(ALLOWED.has(node.localName), node.localName).toBe(true);
    expect(node.namespaceURI).toBe("http://www.w3.org/1999/xhtml");
    for (const { name, value } of node.attributes) {
      expect(name).not.toMatch(/^on|^srcdoc$|^formaction$|^action$|^xlink/i);
      if (name === "href" || name === "src") expect(new URL(value).protocol).toBe("https:");
    }
  }
}

it("keeps javascript:, data: and other non-HTTPS destinations out of links and images", () => {
  for (const url of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "&#106;avascript:alert(1)", "data:text/html,<script>alert(1)</script>", "data:image/svg+xml;base64,PHN2Zz4=", "vbscript:x", "http://example.com/", "//example.com/", "/relative", "blob:https://example.com/x"]) {
    const html = renderSafeMarkdown(`[x](${url})\n\n[x](<${url}>)\n\n![x](${url})\n\n<${url}>`);
    expect(html).not.toMatch(/(?:href|src)="/);
    expect(html).not.toContain("<img");
    expectInert(html);
    for (const hostile of [`<a href="${url}">x</a>`, `<img src="${url}">`, `<iframe src="${url}"></iframe>`]) expect(sanitizeRenderedMarkdown(hostile)).not.toMatch(/(?:href|src)=|<img|<iframe/);
  }
  // Attributes the sanitizer once let a scheme through: none is on the allowlist, on any tag.
  const out = sanitizeRenderedMarkdown('<form action="javascript:alert(1)"><button formaction="javascript:alert(1)">x</button></form><object data="javascript:alert(1)"></object><video poster="javascript:alert(1)"></video><p background="javascript:alert(1)" onclick="alert(1)" style="background:url(javascript:alert(1))">x</p><a href="https://example.com/" onmouseover="alert(1)" target="_blank">y</a>');
  expect(out).toBe('x<p>x</p><a href="https://example.com/" rel="noopener noreferrer nofollow">y</a>');
});

it("drops SVG and SMIL, whatever their URI lists point at", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.com/"><animate attributeName="href" values="https://example.com/;javascript:alert(1)" from="javascript:alert(1)" to="javascript:alert(1)"/><set attributeName="xlink:href" to="javascript:alert(1)"/><text>click</text></a><script>alert(1)</script><use href="data:image/svg+xml,<svg id=x>"/></svg><math><maction actiontype="statusline" xlink:href="javascript:alert(1)">m</maction></math>';
  const element = /<(?:svg|animate|set|use|script|math|maction|text)[\s>/]/i;
  // As rendered HTML: the elements and every attribute go, only the HTTPS link around them stays.
  for (const html of [sanitizeRenderedMarkdown(svg), sanitizeRenderedMarkdown(svg, { email: true })]) {
    expect(html).not.toMatch(element);
    expect(html).not.toMatch(/javascript:|data:|values=|attributeName=|xlink/i);
    expect(html).toBe('<a href="https://example.com/" rel="noopener noreferrer nofollow">click</a>m');
    expectInert(html);
  }
  // As Markdown source: raw HTML is never parsed, it is shown as text.
  for (const html of [renderSafeMarkdown(svg), renderSafeMarkdown(`Text\n\n${svg}\n\nMore`)]) {
    expect(html).not.toMatch(element);
    expect(html).not.toMatch(/<a[\s>]/);
    expect(html).toContain("&lt;svg");
    expectInert(html);
  }
});

it("does not let a textarea, or any other raw-text element, smuggle markup past the allowlist", () => {
  for (const tag of ["textarea", "title", "style", "xmp", "noscript", "noembed", "noframes", "iframe", "script", "plaintext", "option", "select"])
    for (const close of [`</${tag}>`, `</${tag}/>`, `</${tag} >`, `</${tag}\n>`, `</${tag.toUpperCase()}/>`]) {
      const hostile = `<${tag}>${close}<img src=x onerror=alert(1)><script>alert(1)</script><a href="javascript:alert(1)">x</a>${close}<svg onload=alert(1)>`;
      const element = /<(?:textarea|title|style|xmp|noscript|noembed|noframes|iframe|script|plaintext|option|select|img|svg)[\s>/]/i;
      for (const html of [sanitizeRenderedMarkdown(hostile), sanitizeRenderedMarkdown(hostile, { email: true })]) {
        expect(html).not.toMatch(element);
        expectInert(html);
      }
      // As Markdown source the whole payload is text: no element of any kind survives, allowed or not.
      const rendered = renderSafeMarkdown(hostile);
      expect(rendered).not.toMatch(element);
      expect(rendered).not.toMatch(/<a[\s>]/);
      expectInert(rendered);
    }
});

it("accepts only the YouTube embed the renderer builds as an iframe", () => {
  const ok = sanitizeRenderedMarkdown('<iframe src="https://www.youtube-nocookie.com/embed/ksi8eAmbTTc?start=90" srcdoc="<script>alert(1)</script>" onload="alert(1)" sandbox="" name="x" width="9999"></iframe>');
  expect(ok).toBe('<iframe src="https://www.youtube-nocookie.com/embed/ksi8eAmbTTc?start=90" title="YouTube video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" style="display:block;width:100%;aspect-ratio:16 / 9;height:auto;border:0;border-radius:12px"></iframe>');
  for (const src of ["https://www.youtube.com/embed/ksi8eAmbTTc", "https://youtube-nocookie.com/embed/ksi8eAmbTTc", "https://www.youtube-nocookie.com.evil.test/embed/ksi8eAmbTTc", "https://www.youtube-nocookie.com@evil.test/embed/ksi8eAmbTTc", "https://evil.test/https://www.youtube-nocookie.com/embed/ksi8eAmbTTc",
    "http://www.youtube-nocookie.com/embed/ksi8eAmbTTc", "//www.youtube-nocookie.com/embed/ksi8eAmbTTc", "/embed/ksi8eAmbTTc", "https://www.youtube-nocookie.com/embed/ksi8eAmbTTc?autoplay=1", "https://www.youtube-nocookie.com/embed/ksi8eAmbTTc/../../x", "https://www.youtube-nocookie.com/embed/short",
    "javascript:alert(1)", "data:text/html,<script>alert(1)</script>", ""])
    expect(sanitizeRenderedMarkdown(`<p>a</p><iframe src="${src}"></iframe><iframe srcdoc="<script>alert(1)</script>"></iframe>`)).toBe("<p>a</p>");
  // Emails never carry an iframe or an image.
  expect(sanitizeRenderedMarkdown('<iframe src="https://www.youtube-nocookie.com/embed/ksi8eAmbTTc"></iframe><img src="https://example.com/a.png">', { email: true })).toBe("");
});

it("stays linear on the inputs that were quadratic in older parsers, within the size cap", () => {
  const cap = (unit: string) => unit.repeat(Math.floor(20_000 / unit.length));
  const started = performance.now();
  for (const source of [cap('"'), cap("'a"), cap("a@b.co "), cap("http://a.co?"), cap("www.a.co_"), cap("*a "), cap("[a]("), cap("> "), cap("<a@")]) renderSafeMarkdown(source);
  expect(performance.now() - started).toBeLessThan(5_000);
  expect(() => renderSafeMarkdown("é".repeat(20_001))).toThrow("MarkdownTooLarge");
  expect(() => renderSafeMarkdown("😀".repeat(20_001))).toThrow("MarkdownTooLarge");
});
