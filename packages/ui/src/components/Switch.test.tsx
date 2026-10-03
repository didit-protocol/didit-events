import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Switch } from "./Switch";
import { VerifiedBadge } from "./VerifiedBadge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Switch", () => {
  it("is a native checkbox with role=switch inside its label, with an optional hint", () => {
    const html = renderToStaticMarkup(<Switch label="Age 18+" hint="Events serving alcohol" defaultChecked />);
    expect(html).toMatch(/^<label[^>]*><span[^>]*><input type="checkbox" role="switch"[^>]*checked=""/);
    expect(html).toContain("Age 18+");
    expect(html).toContain("Events serving alcohol");
    expect(renderToStaticMarkup(<Switch aria-label="Scanning" />)).toContain('aria-label="Scanning"');
  });

  it("clicking the label toggles it; disabled stays put", async () => {
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM("<!doctype html><div id=r></div>");
    const g = globalThis as Record<string, unknown>;
    Object.assign(g, { window: dom.window, document: dom.window.document });
    const host = dom.window.document.getElementById("r")!;
    const root = createRoot(host);
    act(() => root.render(<><Switch label="Full name" /><Switch label="Locked" disabled defaultChecked /></>));
    const [free, locked] = Array.from(host.querySelectorAll("label"));
    act(() => free!.querySelector("span:last-child")!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    expect((free!.querySelector("input") as HTMLInputElement).checked).toBe(true);
    act(() => locked!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    expect((locked!.querySelector("input") as HTMLInputElement).checked).toBe(true);
    act(() => root.unmount());
  });
});

describe("VerifiedBadge", () => {
  it("names itself, is focusable and is described by every tooltip line", () => {
    const html = renderToStaticMarkup(<VerifiedBadge label="Verified by Didit · 1 Oct 2026" details={["Selfie liveness", "Email verified 12 Feb 2026", ""]} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Verified by Didit"');
    expect(html).toContain('tabindex="0"');
    const id = /aria-describedby="([^"]+)"/.exec(html)![1]!;
    expect(html).toContain(`id="${id}"`);
    for (const t of ["Verified by Didit · 1 Oct 2026", "Selfie liveness", "Email verified 12 Feb 2026"]) expect(html).toContain(t);
    expect(html).toContain('fill="#1D9BF0"');
  });
});
