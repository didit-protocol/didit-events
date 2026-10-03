// @vitest-environment jsdom
import { act, useRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { focusables, useFocusTrap } from "./focus";
import { ConfirmDialog, Drawer, Modal } from "./Overlay";

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
  host.remove();
  document.body.innerHTML = "";
});

const render = (el: ReactElement) => act(() => root.render(el));
const byId = (id: string) => document.getElementById(id) as HTMLElement;

function form(value: string) {
  return (
    <>
      <input id="first" defaultValue="" />
      <input id="second" value={value} onChange={() => {}} />
    </>
  );
}

describe("useFocusTrap", () => {
  it("Modal keeps focus in the second field across re-renders with a new inline onClose", () => {
    render(<Modal open title="T" onClose={() => {}}>{form("")}</Modal>);
    expect(document.activeElement).toBe(byId("first"));
    byId("second").focus();
    for (const v of ["a", "ab", "abc"]) {
      render(<Modal open title="T" onClose={() => {}}>{form(v)}</Modal>);
      expect(document.activeElement).toBe(byId("second"));
    }
  });

  it("Drawer keeps focus across re-renders with a new inline onClose", () => {
    render(<Drawer open title="T" onClose={() => {}}>{form("")}</Drawer>);
    byId("second").focus();
    render(<Drawer open title="T" onClose={() => {}}>{form("x")}</Drawer>);
    expect(document.activeElement).toBe(byId("second"));
  });

  it("ConfirmDialog keeps focus when loading toggles and onClose changes identity", () => {
    const dialog = (loading: boolean) => (
      <ConfirmDialog open title="Delete?" description={form("")} confirmLabel="Delete" onConfirm={() => {}} onClose={() => {}} loading={loading} />
    );
    render(dialog(false));
    expect(document.activeElement?.textContent).toBe("Cancel");
    byId("second").focus();
    render(dialog(true));
    expect(document.activeElement).toBe(byId("second"));
    render(dialog(false));
    expect(document.activeElement).toBe(byId("second"));
  });

  it("Escape calls the latest onClose", () => {
    const first = vi.fn();
    const latest = vi.fn();
    render(<Modal open title="T" onClose={first}>{form("")}</Modal>);
    render(<Modal open title="T" onClose={latest}>{form("")}</Modal>);
    act(() => {
      byId("second").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("focus moves in on open and back to the opener on close", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    render(<Modal open={false} title="T" onClose={() => {}}>{form("")}</Modal>);
    render(<Modal open title="T" onClose={() => {}}>{form("")}</Modal>);
    expect(document.activeElement).toBe(byId("first"));
    render(<Modal open={false} title="T" onClose={() => {}}>{form("")}</Modal>);
    expect(document.activeElement).toBe(opener);
  });

  describe("an embedded iframe (the Didit SDK)", () => {
    function Dialog({ active = true }: { active?: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref, active, () => {});
      return (
        <div id="scrim">
          <div ref={ref} id="dialog" role="dialog" tabIndex={-1}>
            <button id="close" type="button">×</button>
            <iframe id="sdk" title="Didit" />
          </div>
        </div>
      );
    }
    const tab = (shiftKey = false) => {
      const e = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
      act(() => void document.activeElement!.dispatchEvent(e));
      return e;
    };
    const guards = () => [...document.querySelectorAll<HTMLElement>("[data-focus-guard]")];

    it("the iframe is part of the Tab order: Tab from Close is left to the browser (it reaches the SDK), Shift+Tab wraps to it", () => {
      render(<Dialog />);
      expect(focusables(byId("dialog")).map((el) => el.id)).toEqual(["close", "sdk"]);
      expect(document.activeElement).toBe(byId("close"));
      expect(tab().defaultPrevented).toBe(false); // no longer forced back onto Close
      expect(document.activeElement).toBe(byId("close"));
      tab(true);
      expect(document.activeElement).toBe(byId("sdk"));
    });

    it("tabbing out of the iframe (keys the page never sees) lands on a guard that sends focus back into the dialog", () => {
      render(<Dialog />);
      const [before, after] = guards();
      expect(before!.nextElementSibling).toBe(byId("dialog"));
      expect(after!.previousElementSibling).toBe(byId("dialog"));
      expect(focusables(byId("dialog"))).not.toContain(after);
      byId("sdk").focus();
      // Tab inside the iframe: the browser moves on to the next stop after the dialog, the trailing guard.
      act(() => after!.focus());
      expect(document.activeElement).toBe(byId("close"));
      // Shift+Tab out of the start: the leading guard wraps to the end (the iframe).
      act(() => before!.focus());
      expect(document.activeElement).toBe(byId("sdk"));
    });

    it("guards go away when the trap ends", () => {
      render(<Dialog />);
      expect(guards()).toHaveLength(2);
      render(<Dialog active={false} />);
      expect(guards()).toHaveLength(0);
    });
  });
});
