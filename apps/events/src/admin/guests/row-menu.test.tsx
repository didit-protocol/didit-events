// @vitest-environment jsdom
// Regression (2026-10-01): the guests table "⋯" opened an empty white box. The menu was absolutely positioned inside a
// table cell with overflow:hidden (and the table's own clip/scroll), so only a sliver of it showed. It is now portalled
// to <body> with fixed positioning; these tests pin the entries, the placement, the keyboard and the dismissal.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { menuPlacement } from "@didit-events/ui";
import { BCN_GUESTS } from "./fixtures";
import { GuestsTable } from "./GuestsTable";
import type { GuestQuery, GuestRow } from "./types";
import { parseGuestQuery } from "./query";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("../../../app/admin/(events)/events/[id]/(tabs)/guests/actions", () => ({ bulkGuestsAction: vi.fn() }));
vi.mock("../useAdminRouter", () => ({ useAdminRouter: () => router }));
// v11: a row opens the drawer by moving the URL (the drawer host swaps in place), not by pushing the page.
const drawerGo = vi.hoisted(() => vi.fn());
vi.mock("../drawer/url", () => ({ drawerGo }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  host.style.overflow = "hidden";
  document.body.appendChild(host);
  root = createRoot(host);
  router.push.mockReset();
  drawerGo.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const query: GuestQuery = parseGuestQuery({});
const guest: GuestRow = { ...BCN_GUESTS[0]!, status: "link-sent" };
const render = (manage = true) => act(() => root.render(<GuestsTable eventId="bcn-opening" query={query} rows={[guest]} total={1} loading={false} manage={manage} />));
const trigger = () => host.querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${guest.name}"]`)!;
const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const labels = () => [...menu()!.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent);
const key = (el: Element, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });

describe("guests table row menu", () => {
  it("opens with the row's actions, outside the clipping table, next to the trigger", () => {
    render();
    expect(menu()).toBeNull();
    act(() => trigger().click());
    const m = menu()!;
    expect(m).not.toBeNull();
    expect(host.contains(m)).toBe(false); // portalled out of the overflow:hidden cell
    expect(m.parentElement).toBe(document.body);
    expect(labels()).toEqual(["Open profile", "Copy verification link", "Send link by email", "Resend link", "View in Didit ↗", "Manual check-in", "Undo check-in", "Revoke invite"]);
    expect(m.style.visibility).not.toBe("hidden");
    expect(m.style.top).not.toBe("");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-controls")).toBe(m.id);
    expect(document.activeElement?.textContent).toBe("Open profile");
  });

  it("is keyboard operable: arrows move, Enter selects, Esc closes back to the trigger", () => {
    render();
    act(() => trigger().focus());
    key(trigger(), "ArrowDown");
    expect(document.activeElement?.textContent).toBe("Open profile");
    key(menu()!, "ArrowDown");
    expect(document.activeElement?.textContent).toBe("Copy verification link");
    key(menu()!, "End");
    expect(document.activeElement?.textContent).toBe("Revoke invite");
    key(menu()!, "Escape");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    key(trigger(), "Enter");
    act(() => (document.activeElement as HTMLElement).click());
    // Exactly one navigation: the click inside the portal does not also reach the row's own onClick.
    expect(drawerGo).toHaveBeenCalledTimes(1);
    expect(drawerGo).toHaveBeenCalledWith(`/admin/events/bcn-opening/guests?guest=${guest.id}`);
    expect(router.push).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });

  it("a press inside the menu does not dismiss it; an outside press does", () => {
    render();
    act(() => trigger().click());
    const item = [...menu()!.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent === "Manual check-in")!;
    act(() => { item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(menu()).not.toBeNull();
    act(() => item.click());
    expect(drawerGo).toHaveBeenCalledWith(`/admin/events/bcn-opening/guests?guest=${guest.id}&checkin=1`);
    act(() => trigger().click());
    expect(menu()).not.toBeNull();
    act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(menu()).toBeNull();
  });

  it("without guests.invite the link and revoke actions are not offered", () => {
    render(false);
    act(() => trigger().click());
    expect(labels()).toEqual(["Open profile", "View in Didit ↗", "Manual check-in", "Undo check-in"]);
  });
});

describe("menuPlacement", () => {
  const viewport = { width: 1280, height: 800 };
  it("sits under the trigger, right-aligned for align=end", () => {
    expect(menuPlacement({ top: 100, bottom: 132, left: 1180, right: 1212 }, 300, "end", viewport)).toEqual({ top: 136, right: 68 });
    expect(menuPlacement({ top: 100, bottom: 132, left: 20, right: 52 }, 300, "start", viewport)).toEqual({ top: 136, left: 20 });
  });
  it("flips above the trigger near the bottom of the viewport", () => {
    expect(menuPlacement({ top: 700, bottom: 732, left: 1180, right: 1212 }, 300, "end", viewport)).toEqual({ top: 396, right: 68 });
  });
});
