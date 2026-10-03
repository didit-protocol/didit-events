// @vitest-environment jsdom
import { act, useEffect, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Drawer } from "./Overlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const render = (el: ReactElement) => act(() => root.render(el));
const panel = () => document.querySelector<HTMLElement>('[role="dialog"]');
const swapped = () => [...document.querySelectorAll("[data-swap]")];

let mounts = 0;
function Body({ id }: { id: string }) {
  useEffect(() => {
    mounts++;
  }, []);
  return <a href={`#${id}`}>{id}</a>;
}
const drawer = (id: string | undefined, open = true) => (
  <Drawer open={open} onClose={() => {}} eyebrow="Applicant" title={`Name ${id}`} media={<i />} headerActions={<button type="button">next</button>} footer={<button type="button">Approve</button>} contentKey={id}>
    <Body id={id ?? "none"} />
  </Drawer>
);

describe("Drawer contentKey: another record in the same panel", () => {
  it("keeps the panel (same node, no second enter), swaps the title block and body with a fade, and resets the scroll", () => {
    mounts = 0;
    render(drawer("a"));
    const first = panel()!;
    const scrim = first.parentElement!;
    const body = first.children[1] as HTMLElement;
    // Opening is the panel sliding in: its content does not fade as well.
    expect(swapped()).toHaveLength(0);
    body.scrollTop = 240;

    render(drawer("b"));
    expect(panel()).toBe(first);
    expect(first.parentElement).toBe(scrim);
    expect(first.children[1]).toBe(body);
    expect(first.textContent).toContain("Name b");
    expect(first.textContent).not.toContain("Name a");
    // Title block + body, nothing else: the eyebrow row (its actions, close) and the footer update in place.
    expect(swapped()).toHaveLength(2);
    expect(swapped().some((el) => el.contains(first.querySelector("h2")))).toBe(true);
    expect(swapped().some((el) => el.querySelector("button"))).toBe(false);
    expect(body.scrollTop).toBe(0);
    // The body content is the new record's (its own state starts fresh).
    expect(mounts).toBe(2);

    // The same record re-rendering (its detail arrived) is not a swap: nothing remounts, nothing replays.
    const head = swapped()[0];
    render(drawer("b"));
    expect(swapped()[0]).toBe(head);
    expect(mounts).toBe(2);
  });

  it("keeps focus on the ‹ › control across a swap, and brings focus back to the panel when the focused control left", () => {
    render(drawer("a"));
    const next = [...panel()!.querySelectorAll("button")].find((b) => b.textContent === "next")!;
    act(() => next.focus());
    render(drawer("b"));
    expect(document.activeElement).toBe(next);
    act(() => panel()!.querySelector<HTMLElement>('a[href="#b"]')!.focus());
    render(drawer("c"));
    expect(document.activeElement).toBe(panel());
  });

  it("reopening on another record is an open, not a swap; without a key the markup has no swap wrappers", () => {
    render(drawer("a"));
    render(drawer("a", false));
    expect(panel()).toBeNull();
    render(drawer("b"));
    expect(panel()!.textContent).toContain("Name b");
    expect(swapped()).toHaveLength(0);
    render(drawer(undefined));
    expect(panel()!.children[1]!.firstElementChild!.tagName).toBe("A");
  });
});
