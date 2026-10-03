import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Banner, Button, Drawer, EVENT_PILL_STATUSES, StatusPill, Toast } from "./index";

// Primitives added for the U3 applicant review (design/05 AP-*).

describe("Button xs", () => {
  it("renders the 28px row action class and a small spinner while loading", () => {
    const html = renderToStaticMarkup(
      <Button size="xs" loading>
        Approving
      </Button>,
    );
    expect(html).toMatch(/class="[^"]*\bxs\b/);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Approving");
  });
});

describe("StatusPill event registration states", () => {
  it.each(Object.keys(EVENT_PILL_STATUSES) as (keyof typeof EVENT_PILL_STATUSES)[])("%s renders its label and a dot", (status) => {
    const html = renderToStaticMarkup(<StatusPill status={status} />);
    expect(html).toContain(`data-status="${status}"`);
    expect(html).toContain(EVENT_PILL_STATUSES[status].label);
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("Toast progress tone", () => {
  it("shows a spinner instead of the tone dot and stays a polite status", () => {
    const html = renderToStaticMarkup(<Toast tone="progress" message="Approving 3 of 3… creating Didit links" />);
    expect(html).toContain('role="status"');
    expect(html).toMatch(/class="[^"]*spinner/);
    expect(html).not.toMatch(/class="[^"]*\bdot\b/);
  });
});

describe("Banner neutral tone", () => {
  it("renders a polite status with the neutral class and the action", () => {
    const html = renderToStaticMarkup(<Banner tone="neutral" action={<button type="button">Change</button>}>Auto-promote is on.</Banner>);
    expect(html).toContain('role="status"');
    expect(html).toMatch(/class="[^"]*\bneutral\b/);
    expect(html).toContain("Change");
  });
});

describe("Drawer media + headerFooter + width", () => {
  it("puts the media left of the title block, the footer row last, and sets the width", () => {
    const html = renderToStaticMarkup(
      <Drawer open inline onClose={() => {}} eyebrow="Applicant · 3 of 7" title="Diego Herrera" subtitle="diego@hooli.test" media={<span data-media="">DH</span>} headerFooter={<div data-flag="">Returning guest</div>} width={520}>
        body
      </Drawer>,
    );
    expect(html).toContain("--drawer-w:520px");
    expect(html.indexOf("data-media")).toBeLessThan(html.indexOf("Diego Herrera"));
    expect(html.indexOf("diego@hooli.test")).toBeLessThan(html.indexOf("data-flag"));
    expect(html).toMatch(/aria-labelledby="([^"]+)"[\s\S]*<h2 id="\1"/);
  });
});
