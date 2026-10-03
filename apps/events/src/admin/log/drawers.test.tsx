// @vitest-environment jsdom
// v11: the check-in log's row drawers open in place. A scan panel is the row already on screen (no request at all);
// a guest row opens the Guests drawer through its host. Both move the URL with the History API.
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detailForRow, DESIGN_GUESTS } from "../guests/fixtures";
import { LOG_SCANS, LOG_SUMMARY_LIVE } from "./fixtures";
import { toLogRow } from "./helpers";
import { LogTable } from "./LogTable";

vi.mock("../../../app/admin/(events)/events/[id]/(tabs)/guests/actions", () => ({ bulkGuestsAction: vi.fn(), manualCheckInAction: vi.fn(), resolveEmailMismatchAction: vi.fn(), undoCheckInAction: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "bcn-opening";
const BASE = `/admin/events/${ID}/log`;
const ROWS = LOG_SCANS.map((s) => toLogRow(s, LOG_SUMMARY_LIVE.doors, "Europe/Madrid", ID));
const UNKNOWN = ROWS.find((r) => r.id === "scn_07")!;
const MARIA = ROWS.find((r) => r.id === "scn_10")!;

const router = { bfcacheId: "test", push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() };
const fetchMock = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { ...detailForRow(DESIGN_GUESTS[0]!), id: "maria-garcia", name: "María García" } }) }));
const tick = () => new Promise((r) => setTimeout(r, 0));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
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

const view = (scan: (typeof ROWS)[number] | null = null): ReactElement => (
  <AppRouterContext.Provider value={router}>
    <LogTable view="all" rows={ROWS} drawers={{ eventId: ID, closeHref: BASE, addHref: `/admin/events/${ID}/guests?add=1`, scan }} />
  </AppRouterContext.Provider>
);
const settle = () =>
  act(async () => {
    await vi.dynamicImportSettled();
    await tick();
  });
const render = async (el: ReactElement) => {
  await act(async () => root.render(el));
  await settle();
};
const panel = () => document.querySelector<HTMLElement>('aside[role="dialog"]');
const tableRow = (text: string) => [...host.querySelectorAll<HTMLElement>('[role="row"]')].find((r) => r.textContent?.includes(text))!;

describe("check-in log drawers", () => {
  it("rows carry the scan's date for the panel", () => {
    expect(UNKNOWN.date).toBe("23 Oct");
  });

  it("a scan row opens the scan panel from the row itself: no request, no page navigation; close leaves in place", async () => {
    await render(view());
    expect(panel()).toBeNull();
    await act(async () => tableRow("Unknown face").click());
    await settle();
    expect(window.location.search).toBe("?scan=scn_07");
    expect(panel()!.textContent).toContain("Unknown face");
    expect(panel()!.textContent).toContain("23 Oct · 19:40:17");
    expect(panel()!.textContent).toContain("Add as guest");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();

    await act(async () => panel()!.querySelector<HTMLElement>('[aria-label="Close"]')!.click());
    expect(window.location.search).toBe("");
    expect(panel()).toBeNull();
  });

  it("a deep-linked scan the filters do not list comes from the page", async () => {
    const hidden = { ...UNKNOWN, id: "scn_hidden", href: `${BASE}?scan=scn_hidden`, result: "Not on list" };
    window.history.replaceState(null, "", `${BASE}?scan=scn_hidden`);
    await render(view(hidden));
    expect(panel()!.textContent).toContain("Not on list");
  });

  it("a guest row opens the Guests drawer: the row's name at once, the detail from the staff route, one panel", async () => {
    await render(view());
    await act(async () => tableRow("María García").click());
    await settle();
    expect(window.location.search).toBe("?guest=maria-garcia");
    const first = panel()!;
    expect(first.textContent).toContain("María García");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/admin/events/${ID}/guests/maria-garcia`);
    await settle();
    expect(panel()).toBe(first);
    expect(first.textContent).toContain("Profile");
    expect(MARIA.href).toBe(`${BASE}?guest=maria-garcia`);
    expect(router.push).not.toHaveBeenCalled();
  });
});
