// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { LeaveGuard, guardedHref, type LeaveGuardProps } from "./LeaveGuard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const push = vi.fn();
const router = { push, refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), replace: vi.fn(), prefetch: vi.fn() };

beforeEach(() => {
  push.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const base: LeaveGuardProps = { dirty: true, unpublished: false, onSaveDraft: () => true, outcome: { status: "idle" }, saved: false, saving: false };
function render(p: Partial<LeaveGuardProps> = {}) {
  act(() =>
    root.render(
      <AppRouterContext.Provider value={router as never}>
        <a href="/elsewhere/page" id="out">Kiosks</a>
        <a href="#emails" id="hash">Emails</a>
        <a href="/admin/team" id="blank" target="_blank">Team</a>
        <LeaveGuard {...base} {...p} />
      </AppRouterContext.Provider>,
    ),
  );
}
const click = (id: string, init: MouseEventInit = {}) => {
  const e = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  act(() => { document.getElementById(id)!.dispatchEvent(e); });
  return e;
};
const dialog = () => document.querySelector('[role="alertdialog"]');
const btn = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent === label)!;

describe("leave-page guard", () => {
  it("dirty: an in-app link opens Save draft / Discard / Keep editing instead of navigating", () => {
    render();
    const e = click("out");
    expect(e.defaultPrevented).toBe(true);
    expect(dialog()?.textContent).toContain("Leave without saving?");
    expect([...dialog()!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Keep editing", "Discard", "Save draft"]);
    act(() => btn("Keep editing").click());
    expect(dialog()).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("Discard leaves to the clicked link", () => {
    render();
    click("out");
    act(() => btn("Discard").click());
    expect(push).toHaveBeenCalledWith("/elsewhere/page");
  });

  it("Save draft waits for the save: success leaves, a failed save stays with the dialog closed", () => {
    const onSaveDraft = vi.fn(() => true);
    render({ onSaveDraft });
    click("out");
    act(() => btn("Save draft").click());
    expect(onSaveDraft).toHaveBeenCalledOnce();
    render({ onSaveDraft, saving: true });
    expect(push).not.toHaveBeenCalled();
    render({ onSaveDraft, saving: false, outcome: { status: "invalid" }, saved: false });
    expect(push).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();

    click("out");
    act(() => btn("Save draft").click());
    render({ onSaveDraft, saving: false, outcome: { status: "saved" }, saved: true, dirty: false });
    expect(push).toHaveBeenCalledWith("/elsewhere/page");
  });

  it("Save draft with invalid values closes the dialog so the field errors show", () => {
    render({ onSaveDraft: () => false });
    click("out");
    act(() => btn("Save draft").click());
    expect(dialog()).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("an unpublished event without changes offers Leave as draft / Keep editing", () => {
    render({ dirty: false, unpublished: true });
    click("out");
    expect(dialog()?.textContent).toContain("This event isn’t published yet");
    act(() => btn("Leave as draft").click());
    expect(push).toHaveBeenCalledWith("/elsewhere/page");
  });

  it("published and clean: links navigate normally; hash links, new tabs and modified clicks are never intercepted", () => {
    render({ dirty: false });
    expect(click("out").defaultPrevented).toBe(false);
    render();
    expect(click("hash").defaultPrevented).toBe(false);
    expect(click("blank").defaultPrevented).toBe(false);
    expect(click("out", { metaKey: true }).defaultPrevented).toBe(false);
    expect(dialog()).toBeNull();
  });

  it("beforeunload uses the browser's native warning only while dirty", () => {
    render();
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    render({ dirty: false, unpublished: true });
    const e2 = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(false);
  });

  it("guardedHref resolves same-origin paths and ignores other origins and downloads", () => {
    const a = document.createElement("a");
    document.body.appendChild(a);
    const ev = (href: string, attrs: Record<string, string> = {}) => {
      a.href = href;
      for (const k of ["download", "data-leave-guard"]) a.removeAttribute(k);
      for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
      return guardedHref({ target: a, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false }, window.location);
    };
    expect(ev("/admin/events/x?tab=1")).toBe("/admin/events/x?tab=1");
    expect(ev("https://elsewhere.example/")).toBeNull();
    expect(ev("/export.csv", { download: "" })).toBeNull();
    expect(ev("/admin", { "data-leave-guard": "off" })).toBeNull();
    a.remove();
  });
});
