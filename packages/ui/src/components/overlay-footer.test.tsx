// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Button } from "./Button";
import { ConfirmDialog, Drawer, Modal } from "./Overlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync(resolve(import.meta.dirname, "Overlay.module.css"), "utf8");
const noop = () => {};

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

describe("Modal / ConfirmDialog / Drawer: the actions are a footer on the bottom edge", () => {
  it("Modal: the footer slot is the dialog's last child, after the title, the text and the body", () => {
    act(() =>
      root.render(
        <Modal inline open onClose={noop} title="Delete event?" description="It can't be undone." footer={<Button>Delete</Button>}>
          <input name="confirm" />
        </Modal>,
      ),
    );
    const dialog = host.querySelector('[role="dialog"]')!;
    const foot = dialog.lastElementChild!;
    expect(foot.className).toBe("footer");
    expect([...foot.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Delete"]);
    // Nothing of the body is in the footer, and no button is left over it.
    expect(foot.querySelector("input, h2, p")).toBeNull();
    expect([...dialog.querySelectorAll("button")].every((b) => foot.contains(b))).toBe(true);
    expect([...dialog.children].map((c) => c.tagName)).toEqual(["H2", "P", "INPUT", "DIV"]);
  });

  it("Modal without a footer renders none (a notice with nothing to press)", () => {
    act(() => root.render(<Modal inline open onClose={noop} title="Sending…" />));
    expect(host.querySelector(".footer")).toBeNull();
  });

  it("ConfirmDialog: Cancel then the confirming action (primary last / right), both in the footer", () => {
    act(() => root.render(<ConfirmDialog inline open onClose={noop} onConfirm={noop} destructive title="Revoke invite?" description="Their link stops working." confirmLabel="Revoke" />));
    const dialog = host.querySelector('[role="alertdialog"]')!;
    const foot = dialog.lastElementChild!;
    expect(foot.className).toBe("footer");
    const buttons = [...foot.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Cancel", "Revoke"]);
    expect(buttons[0]!.className).toContain("secondary");
    expect(buttons[1]!.className).toContain("destructive");
    expect(dialog.querySelectorAll("button")).toHaveLength(2);
  });

  it("Drawer: head, scrolling body, then the footer with its actions", () => {
    act(() =>
      root.render(
        <Drawer inline open onClose={noop} title="María García" footer={<><Button variant="secondary">Reject</Button><Button>Approve</Button></>}>
          <p>Body</p>
        </Drawer>,
      ),
    );
    const panel = host.querySelector('[role="dialog"]')!;
    expect([...panel.children].map((c) => c.className)).toEqual(["drawerHead", "drawerBody", "drawerFoot"]);
    expect([...panel.lastElementChild!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Reject", "Approve"]);
    expect(panel.querySelector(".drawerBody button")).toBeNull();
  });

  it("the modal footer is sticky on the bottom edge and bleeds through the padding (--modal-pad), with the Drawer footer's spacing", () => {
    expect(css).toMatch(/\.modal \{\s*--modal-pad: 20px;[^}]*overflow: auto; padding: var\(--modal-pad\);/);
    const foot = /\.footer \{([^}]*)\}/.exec(css)![1]!;
    expect(foot).toContain("position: sticky; bottom: 0;");
    expect(foot).toContain("display: flex; justify-content: flex-end; gap: 8px;");
    expect(foot).toContain("margin: -6px calc(-1 * var(--modal-pad)) calc(-1 * var(--modal-pad)); padding: 12px var(--modal-pad) var(--modal-pad);");
    expect(foot).toContain("background: var(--white);");
    const drawer = /\.drawerFoot \{([^}]*)\}/.exec(css)![1]!;
    expect(drawer).toContain("justify-content: flex-end; gap: 8px;");
    expect(drawer).toContain("border-top: 1px solid var(--border);");
    // Phones: the drawer is full height, so its footer clears the home indicator.
    expect(drawer).toContain("padding: 12px 20px max(12px, env(safe-area-inset-bottom));");
  });

  it("the modal footer's top rule shows only while the body scrolls under it", () => {
    expect(css).toMatch(/@supports \(animation-timeline: scroll\(\)\) \{\s*\.footer \{ animation: footRule linear both; animation-timeline: scroll\(nearest block\); animation-range: calc\(100% - 12px\) 100%; \}\s*\}/);
    expect(css).toMatch(/@keyframes footRule \{ from \{ box-shadow: inset 0 1px 0 var\(--border\); \} to \{ box-shadow: inset 0 1px 0 transparent; \} \}/);
  });
});
