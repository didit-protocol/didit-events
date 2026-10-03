// @vitest-environment jsdom
// v11: the guest drawer (Guests tab and check-in log) opens once: one panel from the row's data to the loaded detail
// and from one guest to the next; opening and closing move the URL with the History API.
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawerGo } from "../drawer/url";
import { detailForRow, DESIGN_GUESTS } from "./fixtures";
import { GuestDrawerHost } from "./GuestDrawerHost";
import { GuestsTable } from "./GuestsTable";
import { parseGuestQuery } from "./query";
import type { GuestDetail, GuestRow } from "./types";

const actions = vi.hoisted(() => ({ bulkGuestsAction: vi.fn(), manualCheckInAction: vi.fn(), resolveEmailMismatchAction: vi.fn(), undoCheckInAction: vi.fn() }));
vi.mock("../../../app/admin/(events)/events/[id]/(tabs)/guests/actions", () => actions);
const toast = vi.hoisted(() => vi.fn());
vi.mock("@didit-events/ui", async (orig) => ({ ...(await orig<object>()), toast }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "/admin/events/bcn-opening/guests";
const A: GuestRow = { ...DESIGN_GUESTS[0]!, status: "verified" };
const B: GuestRow = { ...DESIGN_GUESTS[1]!, status: "link-sent" };
const ROWS = [A, B];
const detail = (row: GuestRow): GuestDetail => ({ ...detailForRow(row), status: row.status });

const router = { bfcacheId: "test", push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() };
let asked: string[] = [];
let waiting = new Map<string, (data: GuestDetail | null) => void>();
const fetchMock = vi.fn((url: string) => {
  const id = /guests\/([^/?]+)$/.exec(url)![1]!;
  asked.push(id);
  return new Promise((resolve) => waiting.set(id, (data) => resolve({ ok: true, status: 200, json: async () => ({ ok: true, data }) })));
});
const tick = () => new Promise((r) => setTimeout(r, 0));
const answer = (id: string, data: GuestDetail | null) =>
  act(async () => {
    waiting.get(id)!(data);
    waiting.delete(id);
    await tick();
  });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  asked = [];
  waiting = new Map();
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", BASE);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const view = (props: Partial<Parameters<typeof GuestDrawerHost>[0]> = {}): ReactElement => (
  <AppRouterContext.Provider value={router}>
    <GuestDrawerHost eventId="bcn-opening" closeHref={BASE} rows={ROWS} dialogs {...props} />
  </AppRouterContext.Provider>
);
/** Renders and lets the drawer's lazy chunk resolve. */
const settle = () =>
  act(async () => {
    await vi.dynamicImportSettled();
    await tick();
  });
const render = async (el: ReactElement) => {
  await act(async () => root.render(el));
  await settle();
};
const go = async (search: string) => {
  await act(async () => drawerGo(`${BASE}${search}`));
  await settle();
};
const panel = () => document.querySelector<HTMLElement>('aside[role="dialog"]');
const text = () => panel()?.textContent ?? "";
const loading = () => !!panel()?.querySelector('[aria-busy="true"]');
const button = (label: string, within: ParentNode = document) => [...within.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label)!;
const dialogs = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')].filter((d) => d !== panel());

describe("guest drawer host", () => {
  it("opens once: the row's header at once, the sections when the detail arrives, in the same panel", async () => {
    await render(view());
    expect(panel()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    await go(`?guest=${A.id}`);
    const first = panel()!;
    const scrim = first.parentElement!;
    expect(text()).toContain(A.name);
    expect(text()).toContain(A.email);
    expect(text()).toContain("Verified");
    expect(loading()).toBe(true);
    // Nothing can be decided before the stored status is known.
    expect(button("Manual check-in", first).disabled).toBe(true);
    expect(asked).toEqual([A.id]);

    await answer(A.id, detail(A));
    expect(panel()).toBe(first);
    expect(first.parentElement).toBe(scrim);
    expect(loading()).toBe(false);
    expect(text()).toContain("Profile");
    expect(button("Manual check-in", first).disabled).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("another guest swaps in place and starts with its own dialog state; back returns to the first, from the cache", async () => {
    await render(view());
    await go(`?guest=${A.id}`);
    await answer(A.id, detail(A));
    const first = panel()!;
    await act(async () => button("Manual check-in", first).click());
    expect(dialogs()).toHaveLength(1);

    await go(`?guest=${B.id}`);
    expect(panel()).toBe(first);
    expect(text()).toContain(B.name);
    expect(text()).not.toContain(A.name);
    expect(dialogs()).toHaveLength(0);
    await answer(B.id, detail(B));

    await act(async () => {
      window.history.back();
      await new Promise((r) => window.addEventListener("popstate", r, { once: true }));
    });
    expect(panel()).toBe(first);
    expect(text()).toContain(A.name);
    expect(loading()).toBe(false);
    expect(asked).toEqual([A.id, B.id]);
  });

  it("?checkin=1 opens the check-in dialog once the stored status allows it, never for a guest who can't be checked in", async () => {
    await render(view());
    await go(`?guest=${A.id}&checkin=1`);
    expect(dialogs()).toHaveLength(0);
    await answer(A.id, detail(A));
    expect(dialogs()).toHaveLength(1);
    expect(dialogs()[0]!.textContent).toContain(`Check in ${A.name} without face?`);

    await go(`?guest=${B.id}&checkin=1`);
    await answer(B.id, { ...detail(B), status: "revoked" });
    expect(dialogs()).toHaveLength(0);
  });

  it("v24: a refused manual check-in (before the event starts) keeps the dialog open and shows the reason", async () => {
    const reason = "Check-in opens when the event starts. To try the door before that, use Test mode on the Door tab.";
    actions.manualCheckInAction.mockResolvedValue({ error: "conflict", message: reason });
    await render(view());
    // From the row menu (?checkin=1) and from the drawer's own button.
    for (const open of [async () => go(`?guest=${A.id}&checkin=1`), async () => { await go(`?guest=${A.id}`); await act(async () => button("Manual check-in", panel()!).click()); }]) {
      await open();
      if (waiting.has(A.id)) await answer(A.id, detail(A));
      await act(async () => button("Check in", dialogs()[0]!).click());
      await settle();
      expect(dialogs()).toHaveLength(1);
      expect(dialogs()[0]!.querySelector('[role="alert"]')?.textContent).toBe(reason);
      expect(button("Manual check-in", panel()!)).toBeDefined();
      // A list refresh behind the dialog (live update) does not drop the message.
      await render(view({ rows: [...ROWS] }));
      if (waiting.has(A.id)) await answer(A.id, detail(A));
      expect(dialogs()[0]!.querySelector('[role="alert"]')?.textContent).toBe(reason);
      await act(async () => button("Cancel", dialogs()[0]!).click());
      expect(dialogs()).toHaveLength(0);
    }
    expect(toast).not.toHaveBeenCalled();
  });

  it("an action's answer shows at once and is what the drawer keeps; refreshed rows load the guest again without a skeleton", async () => {
    const checkedIn: GuestDetail = { ...detail(A), status: "checked-in" };
    actions.manualCheckInAction.mockResolvedValue({ ok: true, detail: checkedIn });
    await render(view());
    await go(`?guest=${A.id}`);
    await answer(A.id, detail(A));
    await act(async () => button("Manual check-in", panel()!).click());
    await act(async () => button("Check in", dialogs()[0]!).click());
    expect(actions.manualCheckInAction).toHaveBeenCalledWith("bcn-opening", A.id, "", expect.any(String));
    expect(button("Undo check-in", panel()!)).toBeDefined();
    expect(dialogs()).toHaveLength(0);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(asked).toEqual([A.id]);

    // The list refresh lands (new rows): same panel, the detail is asked again behind what is on screen.
    const first = panel()!;
    await render(view({ rows: [...ROWS] }));
    expect(panel()).toBe(first);
    expect(loading()).toBe(false);
    expect(asked).toEqual([A.id, A.id]);
  });

  it("a deep link uses the page's own stream; closing leaves and returns to the list; an unknown guest closes", async () => {
    window.history.replaceState(null, "", `${BASE}?guest=${B.id}`);
    await render(view({ seed: { id: B.id, detail: Promise.resolve(detail(B)) } }));
    expect(text()).toContain(B.name);
    expect(loading()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => panel()!.querySelector<HTMLElement>('[aria-label="Close"]')!.click());
    expect(window.location.search).toBe("");
    expect(panel()).toBeNull();
    expect(router.push).not.toHaveBeenCalled();

    await go("?guest=nobody");
    await answer("nobody", null);
    expect(window.location.search).toBe("");
    expect(panel()).toBeNull();
  });

  it("on the check-in log the dialog params are ignored and the sheet class is applied", async () => {
    await render(view({ dialogs: false, className: "sheet", rows: [{ id: A.id, name: A.name, email: A.email }] }));
    await go(`?guest=${A.id}&checkin=1`);
    await answer(A.id, detail(A));
    expect(panel()!.className).toContain("sheet");
    expect(dialogs()).toHaveLength(0);
  });
});

describe("the guests table hosts the drawer", () => {
  it("a row click opens the drawer over the table: the URL moves, the page is not pushed", async () => {
    await render(
      <AppRouterContext.Provider value={router}>
        <GuestsTable eventId="bcn-opening" query={parseGuestQuery({})} rows={ROWS} total={2} loading={false} drawer={{ closeHref: BASE }} />
      </AppRouterContext.Provider>,
    );
    expect(panel()).toBeNull();
    const row = [...host.querySelectorAll<HTMLElement>('[role="row"]')].find((r) => r.textContent?.includes(B.name))!;
    await act(async () => row.click());
    await settle();
    expect(window.location.search).toBe(`?guest=${B.id}`);
    expect(text()).toContain(B.name);
    expect(asked).toEqual([B.id]);
    expect(router.push).not.toHaveBeenCalled();
  });
});
