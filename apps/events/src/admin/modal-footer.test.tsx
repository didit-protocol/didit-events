// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BulkApproveDialog, CapacityDialog, RejectDialog } from "./applicants/Dialogs";
import { DEFAULT_REQUIREMENTS, SHARE_LINKS } from "./applicants/fixtures";
import { InviteModal } from "./applicants/InviteModal";
import { RequirementsModal } from "./applicants/RequirementsModal";
import { LeaveGuard } from "./form/LeaveGuard";
import { AddGuests } from "./guests/AddGuests";
import { GuestDialogs } from "./guests/GuestDrawer";
import { DeleteEventDialog } from "./settings/DeleteEventDialog";
import { LifecycleControls } from "./settings/LifecycleControls";
import { SessionExpiredModal } from "./system/SessionExpiredModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = { bfcacheId: "test", push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() };
const css = (file: string) => readFileSync(resolve(import.meta.dirname, file), "utf8");
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
const render = (el: ReactElement) => act(async () => root.render(<AppRouterContext.Provider value={router as never}>{el}</AppRouterContext.Provider>));

/**
 * The dialog's actions are its footer slot (the kit's `.footer`, the dialog's last child): these labels in this order
 * (the primary one last / right), and no other action button in the body over it (the × stays in the head).
 */
function expectFooter(labels: string[], scope: ParentNode = host) {
  const dialogs = scope.querySelectorAll('[role="dialog"], [role="alertdialog"]');
  expect(dialogs.length).toBe(1);
  const dialog = dialogs[0]!;
  const foot = dialog.lastElementChild!;
  expect(foot.className.split(" ")).toContain("footer");
  expect([...foot.querySelectorAll("button, a")].map((b) => b.textContent?.trim())).toEqual(labels);
  const loose = [...dialog.querySelectorAll(".button")].filter((b) => !foot.contains(b) && b.getAttribute("aria-label") !== "Close").map((b) => b.textContent?.trim());
  expect(loose, "action buttons outside the footer").toEqual([]);
  return foot;
}

describe("admin dialogs: every terminal action is in the Modal footer slot", () => {
  it("approve over capacity", async () => {
    await render(<CapacityDialog inline onClose={noop} names={["Ana Ruiz"]} approved={80} capacity={80} releaseOn="7 Oct" onWaitlist={noop} onApprove={noop} />);
    const foot = expectFooter(["Waitlist instead", "Approve anyway"]);
    // The tip is the body.
    expect(foot.textContent).not.toContain("Tip:");
    expect(host.textContent).toContain("Tip: waitlist instead");
  });

  it("bulk approve", async () => {
    await render(<BulkApproveDialog inline onClose={noop} rows={[{ verified: true }, { verified: false }]} approved={10} capacity={80} onConfirm={noop} />);
    const foot = expectFooter(["Cancel", "Approve 2"]);
    expect(foot.querySelector('input, [role="switch"]')).toBeNull();
    expect(host.querySelector('[role="dialog"] [role="switch"], [role="dialog"] input')).not.toBeNull();
  });

  it("reject: the reason, the note and the toggles scroll in the body; Cancel and Reject stay in the footer", async () => {
    await render(<RejectDialog inline onClose={noop} names={["Kwame Mensah"]} onConfirm={noop} error="Couldn’t reject. Try again." />);
    const foot = expectFooter(["Cancel", "Reject"]);
    expect(foot.querySelector("select, textarea, input, [role=alert]")).toBeNull();
    expect(foot.lastElementChild!.className).toContain("destructive");
    // The server error is over the footer, not under the buttons.
    const alert = host.querySelector('[role="alert"]')!;
    expect(alert.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("invite guests: compose, share a link, sending and sent", async () => {
    const invite = (props: Partial<Parameters<typeof InviteModal>[0]> = {}) => <InviteModal inline eventId="ai-era" tab="email" closeHref="/x" existingEmails={[]} links={SHARE_LINKS} {...props} />;
    await render(invite({ initial: { emails: ["a@example.test", "b@example.test"] } }));
    expectFooter(["Cancel", "Send 2 invites"]);

    await act(async () => root.unmount());
    root = createRoot(host);
    await render(invite({ tab: "link" }));
    let foot = expectFooter(["Done"]);
    expect(foot.querySelector("[role=tabpanel]")).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(host);
    await render(invite({ initial: { step: { kind: "sending", done: 1, total: 3 } } }));
    foot = expectFooter(["Sending…"]);
    expect(host.querySelector('[role="progressbar"]')!.closest(".footer")).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(host);
    await render(invite({ initial: { step: { kind: "sent", summary: { invited: 2, approvedExisting: 0, waitlisted: 0, skippedInvalid: 0 } } } }));
    expectFooter(["Invite more", "Done"]);
  });

  it("what guests must verify", async () => {
    await render(<RequirementsModal inline eventId="ai-era" initial={DEFAULT_REQUIREMENTS} closeHref="/x" />);
    const foot = expectFooter(["Cancel", "Save requirements"]);
    expect(foot.querySelector('[role="switch"], select')).toBeNull();
  });

  it("session expired: the one CTA is the footer", async () => {
    await render(<SessionExpiredModal open inline />);
    const foot = expectFooter(["Continue with Google"]);
    expect(foot.firstElementChild!.matches("a.block")).toBe(true);
  });

  it("delete event and the guest dialogs (manual check-in, undo, revoke)", async () => {
    await render(<DeleteEventDialog eventId="bcn" name="Barcelona Office Opening" guestCount={124} open inline />);
    let foot = expectFooter(["Cancel", "Delete event"]);
    expect(foot.querySelector("input")).toBeNull();

    const dialogs = (dialog: "checkin" | "undo" | "revoke") => <GuestDialogs name="María García" dialog={dialog} inline note="" onNote={noop} pending={false} onClose={noop} onCheckIn={noop} onUndo={noop} onRevoke={noop} />;
    for (const [dialog, labels] of [["checkin", ["Cancel", "Check in"]], ["undo", ["Cancel", "Undo check-in"]], ["revoke", ["Cancel", "Revoke invite"]]] as const) {
      await act(async () => root.unmount());
      root = createRoot(host);
      await render(dialogs(dialog));
      foot = expectFooter([...labels]);
      expect(foot.querySelector("textarea")).toBeNull();
    }
  });

  it("add guests: every step's buttons are the footer", async () => {
    await render(<AddGuests eventId="bcn" closeHref="/x" existingEmails={[]} inline />);
    const foot = expectFooter(["Cancel", "Add guest"]);
    expect(foot.querySelector("input, textarea")).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(host);
    await render(<AddGuests eventId="bcn" closeHref="/x" existingEmails={[]} initial={{ step: "paste" }} inline />);
    expectFooter(["Cancel", "Add guests"]);
  });

  it("cancel event (a portal dialog): the reason is the body, Keep event and Confirm cancellation the footer", async () => {
    await render(<LifecycleControls eventId="bcn" status="published" />);
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Cancel event")!.click());
    const foot = expectFooter(["Keep event", "Confirm cancellation"], document.body);
    expect(foot.querySelector("input")).toBeNull();
    expect(document.querySelector('[role="dialog"] input')).not.toBeNull();
  });

  it("leave without saving (a portal alert dialog)", async () => {
    await render(
      <>
        <a href="/elsewhere/page" id="out">
          Kiosks
        </a>
        <LeaveGuard dirty unpublished={false} onSaveDraft={() => true} outcome={{ status: "idle" }} saved={false} saving={false} />
      </>,
    );
    act(() => {
      document.getElementById("out")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    const foot = expectFooter(["Keep editing", "Discard", document.querySelector('[role="alertdialog"] .footer button:last-child')!.textContent!.trim()], document.body);
    expect(foot.lastElementChild!.querySelectorAll("button")).toHaveLength(3);
  });

  it("consumers that change the dialog's padding tell the footer (--modal-pad), so it still ends on the edge", () => {
    expect(css("applicants/Applicants.module.css")).toMatch(/\.modal \{ --modal-pad: 24px; padding: 24px; gap: 14px; \}/);
    expect(css("system/System.module.css")).toMatch(/\.modal\.modal \{ --modal-pad: 28px; gap: 12px; padding: 28px; \}/);
    expect(css("settings/Settings.module.css")).toMatch(/\.deleteModal\.deleteModal \{ --modal-pad: 24px; max-width: 480px; padding: 24px; gap: 14px; \}/);
    // The old in-body button row is gone.
    expect(css("applicants/Applicants.module.css")).not.toMatch(/\.btns \{/);
    // Drawers: the footer clears the home indicator on phones.
    expect(css("guests/Drawer.module.css")).toMatch(/padding: 16px 24px max\(16px, env\(safe-area-inset-bottom\)\);/);
  });
});

describe("door PIN: the two actions are the card's footer", () => {
  const app = css("../door/DoorApp.tsx");
  const kiosk = css("../door/kiosk/kiosk.module.css");

  it("the field and its error are over a footer with Cancel then End door mode (primary last)", () => {
    const form = /<form className=\{`\$\{styles\.notice\} \$\{styles\.pinCard\}`\}[\s\S]*?<\/form>/.exec(app)![0];
    const foot = /<div className=\{styles\.pinFoot\} data-pin-footer="">([\s\S]*?)<\/div>/.exec(form)![1]!;
    expect([...foot.matchAll(/<button type="(\w+)"[^\n]*>([^<>]+)<\/button>/g)].map((m) => [m[1], m[2]])).toEqual([["button", "Cancel"], ["submit", "End door mode"]]);
    // No button outside the footer; the input and the error come before it.
    expect(form.replace(foot, "")).not.toContain("<button");
    expect(form.indexOf("<input")).toBeLessThan(form.indexOf("styles.pinFoot"));
    expect(form.indexOf("styles.error")).toBeLessThan(form.indexOf("styles.pinFoot"));
    expect(kiosk).toMatch(/\.pinCard \{ flex-direction: column; align-items: stretch; gap: 12px; \}/);
    expect(kiosk).toMatch(/\.pinFoot \{ display: flex; justify-content: flex-end; gap: 12px; padding-top: 12px; border-top: 1px solid var\(--border\); \}/);
  });
});
