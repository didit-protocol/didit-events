// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, useRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterAnimations, usePresence } from "./components/motion";
import { Button, MarkLoader, Modal, Skeleton, Spinner } from "./index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = (file: string) => readFileSync(resolve(import.meta.dirname, file), "utf8");
/** Every rule that animates, in a file with a reduced-motion block, is answered there. */
const reducedBlock = (file: string) => file.slice(file.lastIndexOf("@media (prefers-reduced-motion: reduce)"));

describe("motion tokens (v9)", () => {
  const tokens = css("tokens.css");

  it("three durations and three easings, and the older names point at them", () => {
    expect(tokens).toMatch(/--duration-fast: 120ms;/);
    expect(tokens).toMatch(/--duration-base: 200ms;/);
    expect(tokens).toMatch(/--duration-slow: 280ms;/);
    for (const ease of ["standard", "emphasized", "exit"]) expect(tokens).toMatch(new RegExp(`--ease-${ease}:\\s+cubic-bezier\\(`));
    expect(tokens).toMatch(/--motion-ui:\s+var\(--duration-base\);/);
    expect(tokens).toMatch(/--press-scale:\s+0\.98;/);
  });

  it("route changes cross-fade, lists stagger on first paint, and both stand still under reduced motion", () => {
    // No cross-document opt-in: a redirecting full load would abort it and throw (2026-10-02).
    expect(tokens).not.toMatch(/@view-transition\s*\{/);
    expect(tokens).toMatch(/::view-transition-new\(\.page\) \{ animation: var\(--duration-base\)/);
    expect(tokens).toMatch(/\[data-stagger\] > \* \{ animation: motion-rise var\(--duration-slow\) var\(--ease-emphasized\) backwards; \}/);
    const reduced = reducedBlock(tokens);
    expect(reduced).toMatch(/::view-transition-old\(\*\)[^{]*\{ animation-duration: 0s !important;/);
    expect(reduced).toContain("[data-stagger] > * { animation: none; }");
  });

  it.each(["Button", "Overlay", "DropdownMenu", "Toast", "MarkLoader", "Spinner", "Display"])("%s animates with the tokens and has a reduced-motion variant", (name) => {
    const file = css(`components/${name}.module.css`);
    expect(file).toContain("@media (prefers-reduced-motion: reduce)");
    // No literal UI durations left where the tokens apply (loops such as the loader's lap keep their own).
    expect(file).not.toMatch(/(animation|transition): [^;]*\b(150|180|200)ms/);
  });

  it("buttons press to .98; modals fade and scale, drawers slide, both in and out", () => {
    const button = css("components/Button.module.css");
    expect(button).toMatch(/\.button:active:not\([^)]*\)[^{]*\{ background: var\(--bg-pressed\); transform: scale\(var\(--press-scale\)\); \}/);
    expect(reducedBlock(button)).toMatch(/transform: none;/);
    const overlay = css("components/Overlay.module.css");
    expect(overlay).toMatch(/@keyframes rise \{ from \{ opacity: 0; transform: scale\(0\.96\); \} \}/);
    expect(overlay).toMatch(/@keyframes slide \{ from \{ transform: translateX\(100%\); \} \}/);
    expect(overlay).toMatch(/\.scrim\[data-leaving\] \.modal \{ animation: sink var\(--duration-fast\) var\(--ease-exit\) forwards; \}/);
    expect(overlay).toMatch(/\.scrim\[data-leaving\] \.drawer \{ animation: slideOut var\(--duration-fast\) var\(--ease-exit\) forwards; \}/);
    expect(reducedBlock(overlay)).toMatch(/animation: fadeOut var\(--duration-fast\) linear forwards;/);
  });

  it("a drawer swapping its record in place fades the new content with the fast token (opacity/translate), none under reduced motion", () => {
    const overlay = css("components/Overlay.module.css");
    expect(overlay).toMatch(/\.drawerSwapHead\[data-swap\], \.drawerSwap\[data-swap\] \{ animation: swap var\(--duration-fast\) var\(--ease-standard\); \}/);
    expect(overlay).toMatch(/@keyframes swap \{ from \{ opacity: 0; transform: translateY\(4px\); \} \}/);
    expect(reducedBlock(overlay)).toMatch(/\.drawerSwapHead\[data-swap\], \.drawerSwap\[data-swap\] \{ animation: none; \}/);
  });
});

describe("MarkLoader", () => {
  it("is the Didit mark as an inline SVG with a fixed box (no layout shift), decorative unless labelled", () => {
    const plain = renderToStaticMarkup(<MarkLoader size={28} />);
    expect(plain).toContain('data-mark-loader="brand"');
    expect(plain).toContain('aria-hidden="true"');
    expect(plain).toMatch(/style="width:22px;height:28px;--mark-len:[\d.]+px"/);
    expect(plain).toContain("<linearGradient");
    expect(plain).not.toContain("<img");
    const labelled = renderToStaticMarkup(<MarkLoader label="Loading" />);
    expect(labelled).toContain('role="status"');
    expect(labelled).toContain('aria-label="Loading"');
  });

  it("inside buttons it is the same ring in the text colour, drawn in CSS (no script per button)", () => {
    const spinner = renderToStaticMarkup(<Spinner size={14} />);
    expect(spinner).toBe('<span aria-hidden="true" class="spinner" style="width:11px;height:14px"></span>');
    const button = renderToStaticMarkup(
      <Button size="lg" block loading>
        Sending code…
      </Button>,
    );
    expect(button).toContain('class="spinner"');
    expect(button).toContain('aria-busy="true"');
    const file = css("components/Spinner.module.css");
    expect(file).toMatch(/\.spinner \{[^}]*border: 2px solid currentColor;\s*border-radius: 999px;/);
    expect(file).toMatch(/mask: conic-gradient\(from var\(--mark-turn\)/);
    expect(reducedBlock(file)).toMatch(/\.spinner \{ -webkit-mask: none; mask: none; animation: pulse /);
  });

  it("stops travelling under reduced motion and pulses in opacity instead", () => {
    const file = css("components/MarkLoader.module.css");
    const reduced = reducedBlock(file);
    expect(reduced).toMatch(/\.run \{ stroke-dasharray: none; animation: none; \}/);
    expect(reduced).toMatch(/\.loader \{ animation: pulse /);
    expect(file).toMatch(/@keyframes pulse \{ 50% \{ opacity: 0\.45; \} \}/);
  });

  it("skeletons shimmer by default", () => {
    expect(renderToStaticMarkup(<Skeleton />)).toContain("shimmer");
    expect(renderToStaticMarkup(<Skeleton shimmer={false} />)).not.toContain("shimmer");
  });
});

describe("leaving animations", () => {
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
  const render = (el: ReactElement) => act(async () => root.render(el));

  it("afterAnimations: at once with nothing running, otherwise when every animation has finished", async () => {
    const now = vi.fn();
    afterAnimations([document.createElement("div"), null, undefined], now);
    expect(now).toHaveBeenCalledTimes(1);

    let finish!: () => void;
    const finished = new Promise<void>((r) => (finish = r));
    const el = Object.assign(document.createElement("div"), { getAnimations: () => [{ finished }] });
    const later = vi.fn();
    afterAnimations([el], later);
    expect(later).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(later).toHaveBeenCalledTimes(1));
  });

  it("usePresence keeps a closed layer mounted, marked as leaving, until its animation ends", async () => {
    let finish!: () => void;
    const finished = new Promise<void>((r) => (finish = r));
    function Layer({ open }: { open: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      const present = usePresence(open, ref);
      return present ? <div ref={(el) => void (ref.current = el && Object.assign(el, { getAnimations: () => (open ? [] : [{ finished }]) }))} data-layer="" data-leaving={open ? undefined : ""} /> : null;
    }
    await render(<Layer open />);
    expect(host.querySelector("[data-layer]")).not.toBeNull();
    await render(<Layer open={false} />);
    expect(host.querySelector("[data-layer][data-leaving]")).not.toBeNull();
    await act(async () => finish());
    expect(host.querySelector("[data-layer]")).toBeNull();
  });

  it("a Modal that closes keeps showing what it showed (its owner's props are already empty), then goes", async () => {
    let finish!: () => void;
    const finished = new Promise<void>((r) => (finish = r));
    const proto = Element.prototype as { getAnimations?: () => unknown[] };
    proto.getAnimations = function (this: Element) {
      return this.hasAttribute("data-leaving") ? [{ finished }] : [];
    };
    try {
      await render(<Modal open onClose={() => undefined} title="Remove María García?" />);
      expect(document.body.textContent).toContain("Remove María García?");
      await render(<Modal open={false} onClose={() => undefined} title="" />);
      const scrim = document.body.querySelector("[data-leaving]");
      expect(scrim).not.toBeNull();
      expect(scrim!.textContent).toContain("Remove María García?");
      await act(async () => finish());
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      delete proto.getAnimations;
    }
  });

  it("without Web Animations (old browsers) a closed Modal is gone at once", async () => {
    await render(<Modal open onClose={() => undefined} title="Hello" />);
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    await render(<Modal open={false} onClose={() => undefined} title="Hello" />);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
