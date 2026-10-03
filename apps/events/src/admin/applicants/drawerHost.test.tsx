// @vitest-environment jsdom
// v11: the applicant drawer opens once and swaps its content in place. Opening, ‹ ›, J/K, the advance after a decision
// and closing move the URL with the History API (no page navigation); the detail comes from the staff detail route.
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_ERA_APPLICANTS, DESIGN_APPLICANTS, detailForRow } from "./fixtures";
import { parseApplicantQuery } from "./query";
import type { ApplicantFound as Found } from "./ApplicantDrawerHost";
import type { ApplicantRow } from "./types";

const decideAction = vi.hoisted(() => vi.fn());
vi.mock("../../../app/admin/(events)/events/[id]/(tabs)/applicants/actions", () => ({ decideAction, undoRejectAction: vi.fn(), reopenRequestsAction: vi.fn(), saveNoteAction: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@didit-events/ui", async (orig) => ({ ...(await orig<object>()), toast }));
// next/dynamic resolves on a later tick: the tests mount the drawer itself (the lazy boundary is Next's, not ours).
vi.mock("./LazyOverlays", async () => ({ LazyApplicantDrawer: (await import("./ApplicantDrawer")).ApplicantDrawer, preloadApplicantDrawer: () => {} }));

const { ApplicantDrawerHost } = await import("./ApplicantDrawerHost");
const { ApplicantsReview } = await import("./ApplicantsReview");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "/admin/events/ai-era/applicants";
const ROWS = DESIGN_APPLICANTS.slice(0, 4);
const [INGRID, DIEGO, NADIA, TOM] = ROWS as [ApplicantRow, ApplicantRow, ApplicantRow, ApplicantRow];
const found = (row: ApplicantRow, rows = ROWS): Found => {
  const i = rows.indexOf(row);
  return { detail: detailForRow(row), row, index: i + 1, total: rows.length, prevId: rows[i - 1]?.id, nextId: rows[i + 1]?.id };
};

const router = { bfcacheId: "test", push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() };
/** The detail route: every request waits until the test answers it. */
let asked: string[] = [];
let waiting = new Map<string, (data: Found | null) => void>();
const fetchMock = vi.fn((url: string) => {
  const id = /applicants\/([^/]+)\/detail/.exec(url)![1]!;
  asked.push(id);
  return new Promise((resolve) => waiting.set(id, (data) => resolve({ ok: true, status: 200, json: async () => ({ ok: true, data }) })));
});
const tick = () => new Promise((r) => setTimeout(r, 0));
const answer = (row: ApplicantRow | string, data?: Found | null) =>
  act(async () => {
    const id = typeof row === "string" ? row : row.id;
    waiting.get(id)!(data === undefined ? found(row as ApplicantRow) : data);
    waiting.delete(id);
    await tick();
  });

let host: HTMLDivElement;
let root: Root;
let pushState: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  asked = [];
  waiting = new Map();
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", BASE);
  pushState = vi.spyOn(window.history, "pushState");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  pushState.mockRestore();
  vi.unstubAllGlobals();
});

const view = (rows = ROWS, seed?: { id: string; found: Promise<Found | null> }): ReactElement => (
  <AppRouterContext.Provider value={router}>
    <ApplicantDrawerHost eventId="ai-era" query={parseApplicantQuery({})} rows={rows} event={AI_ERA_APPLICANTS} seed={seed} />
  </AppRouterContext.Provider>
);
const render = (el: ReactElement) => act(async () => root.render(el));
const go = (search: string) =>
  act(async () => {
    const { drawerGo } = await import("../drawer/url");
    drawerGo(`${BASE}${search}`);
  });
const panel = () => document.querySelector<HTMLElement>('aside[role="dialog"]');
const text = () => panel()?.textContent ?? "";
const loading = () => !!panel()?.querySelector('[aria-busy="true"]');
const control = (label: string) => panel()!.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const button = (label: string) => [...panel()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label)!;
const key = (k: string) => act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));

describe("applicant drawer host", () => {
  it("opens at once with the row's header; only the sections wait for the detail", async () => {
    await render(view());
    expect(panel()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    await go(`?applicant=${DIEGO.id}`);
    expect(text()).toContain("Applicant · 2 of 4");
    expect(text()).toContain("Diego Herrera");
    expect(text()).toContain("diego@hooli.test");
    expect(text()).toContain("Fraud Analyst · Hooli");
    expect(text()).toContain("Pending");
    expect(button("Approve and send link").disabled).toBe(false);
    // The header is real data: the only skeleton is the body's.
    expect(panel()!.querySelector("h2")!.querySelector('[class*="skeleton" i]')).toBeNull();
    expect(loading()).toBe(true);

    await answer(DIEGO);
    expect(loading()).toBe(false);
    expect(text()).toContain("Request answers");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("‹ › and J / K swap the content of the same drawer: no remount, no page navigation, no skeleton when prefetched", async () => {
    await render(view());
    await go(`?applicant=${DIEGO.id}`);
    const first = panel()!;
    const scrim = first.parentElement!;
    // The open applicant, then its neighbours ahead of time.
    expect(asked).toEqual([DIEGO.id, INGRID.id, NADIA.id]);
    await answer(DIEGO);
    await answer(INGRID);
    await answer(NADIA);

    await act(async () => control("Next applicant (J)").click());
    expect(window.location.search).toBe(`?applicant=${NADIA.id}`);
    expect(panel()).toBe(first);
    expect(first.parentElement).toBe(scrim);
    expect(scrim.hasAttribute("data-leaving")).toBe(false);
    expect(text()).toContain("Applicant · 3 of 4");
    expect(text()).toContain("Nadia Kowalski");
    expect(text()).not.toContain("Diego Herrera");
    // Prefetched: the sections are there in the same render, and the swap is marked for the fade.
    expect(loading()).toBe(false);
    expect(text()).toContain("Compliance Manager");
    expect(panel()!.querySelectorAll("[data-swap]").length).toBe(2);
    // Only the new neighbour is fetched; the previous one is cached.
    expect(asked).toEqual([DIEGO.id, INGRID.id, NADIA.id, TOM.id]);

    await key("k");
    expect(window.location.search).toBe(`?applicant=${DIEGO.id}`);
    expect(panel()).toBe(first);
    expect(text()).toContain("Diego Herrera");
    await key("j");
    await key("j");
    expect(window.location.search).toBe(`?applicant=${TOM.id}`);
    expect(panel()).toBe(first);
    // Tom's prefetch is still under way: his header is the row's, his sections wait, and nobody is asked twice.
    expect(text()).toContain("Applicant · 4 of 4");
    expect(text()).toContain("Tom Achterberg");
    expect(loading()).toBe(true);
    expect(control("Next applicant (J)").hasAttribute("disabled")).toBe(true);
    await answer(TOM);
    expect(loading()).toBe(false);
    expect(asked).toEqual([DIEGO.id, INGRID.id, NADIA.id, TOM.id]);

    // Every move was a History entry, never a router navigation of the page.
    expect(pushState).toHaveBeenCalledTimes(5);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("never has more than two prefetches in flight", async () => {
    await render(view());
    await go(`?applicant=${DIEGO.id}`);
    // Diego (open) + Ingrid and Nadia (prefetch). Moving on while they are pending queues Tom behind them.
    await act(async () => control("Next applicant (J)").click());
    expect(asked).toEqual([DIEGO.id, INGRID.id, NADIA.id]);
    await answer(INGRID);
    expect(asked).toEqual([DIEGO.id, INGRID.id, NADIA.id, TOM.id]);
  });

  it("a decision advances to the next applicant in place and drops what was cached", async () => {
    decideAction.mockResolvedValue({ ok: true, done: [DIEGO.id], failed: [] });
    await render(view());
    await go(`?applicant=${DIEGO.id}`);
    const first = panel()!;
    await answer(DIEGO);
    await answer(INGRID);
    await answer(NADIA);
    asked = [];

    await act(async () => button("Approve and send link").click());
    expect(decideAction).toHaveBeenCalledWith("ai-era", "approve", [DIEGO.id], expect.objectContaining({ notify: true }), expect.any(String));
    expect(window.location.search).toBe(`?applicant=${NADIA.id}`);
    expect(panel()).toBe(first);
    expect(text()).toContain("Nadia Kowalski");
    // Nadia's cached detail stays on screen while it loads again (her place in the list changed).
    expect(loading()).toBe(false);
    expect(asked).toContain(NADIA.id);
    // The list refreshes under the drawer; the page is never pushed.
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();

    // The refreshed rows arrive (Diego left the tab): same drawer, new position.
    const rest = [INGRID, NADIA, TOM];
    await render(view(rest));
    expect(panel()).toBe(first);
    expect(text()).toContain("Applicant · 2 of 3");
  });

  it("deciding the last applicant closes the drawer", async () => {
    decideAction.mockResolvedValue({ ok: true, done: [TOM.id], failed: [] });
    await render(view());
    await go(`?applicant=${TOM.id}`);
    await act(async () => button("Waitlist").click());
    expect(window.location.search).toBe("");
    expect(panel()).toBeNull();
  });

  it("a deep link opens the same applicant from the page's own stream, and back / forward move between applicants in place", async () => {
    window.history.replaceState(null, "", `${BASE}?applicant=${TOM.id}`);
    await render(view(ROWS, { id: TOM.id, found: Promise.resolve(found(TOM)) }));
    const first = panel()!;
    expect(text()).toContain("Tom Achterberg");
    expect(loading()).toBe(false);
    // The page already streamed Tom: only his neighbour is asked for.
    expect(asked).toEqual([NADIA.id]);

    await act(async () => control("Previous applicant (K)").click());
    expect(text()).toContain("Nadia Kowalski");
    await act(async () => {
      window.history.back();
      await new Promise((r) => window.addEventListener("popstate", r, { once: true }));
    });
    expect(window.location.search).toBe(`?applicant=${TOM.id}`);
    expect(panel()).toBe(first);
    expect(text()).toContain("Tom Achterberg");
    await act(async () => {
      window.history.forward();
      await new Promise((r) => window.addEventListener("popstate", r, { once: true }));
    });
    expect(panel()).toBe(first);
    expect(text()).toContain("Nadia Kowalski");
  });

  it("an applicant outside the list (another tab) takes its row and position from the loader; an unknown id closes", async () => {
    const other: ApplicantRow = { ...DIEGO, id: "someone-else", name: "Someone Else", tab: "approved" };
    await render(view());
    await go(`?applicant=${other.id}`);
    // Nothing is known yet: the header waits too.
    expect(text()).not.toContain("Someone Else");
    await answer(other.id, { detail: detailForRow(other), row: other, index: 7, total: 9, prevId: "before", nextId: "after" });
    expect(text()).toContain("Applicant · 7 of 9");
    expect(text()).toContain("Someone Else");
    expect(text()).toContain("Approved");
    expect(control("Next applicant (J)").getAttribute("href")).toBe(`${BASE}?applicant=after`);

    await go("?applicant=nobody-here");
    await answer("nobody-here", null);
    expect(window.location.search).toBe("");
    expect(panel()).toBeNull();
  });

  it("closing leaves once and returns to the list; reopening is a new open", async () => {
    await render(view());
    await go(`?applicant=${DIEGO.id}`);
    await answer(DIEGO);
    await act(async () => control("Close").click());
    expect(window.location.search).toBe("");
    expect(panel()).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    await go(`?applicant=${NADIA.id}`);
    expect(text()).toContain("Nadia Kowalski");
    // An open slides the panel in: its content does not fade as well.
    expect(panel()!.querySelectorAll("[data-swap]").length).toBe(0);
  });

  it("a detail that fails to load keeps the header and offers a retry", async () => {
    fetchMock.mockImplementationOnce((url: string) => {
      asked.push(/applicants\/([^/]+)\/detail/.exec(url)![1]!);
      return Promise.reject(new Error("offline"));
    });
    await render(view([INGRID]));
    await go(`?applicant=${INGRID.id}`);
    await act(tick);
    expect(text()).toContain("Ingrid Nilsen");
    expect(text()).toContain("Couldn’t load this applicant.");
    expect(loading()).toBe(false);
    await act(async () => button("Retry").click());
    expect(loading()).toBe(true);
    await answer(INGRID, found(INGRID, [INGRID]));
    expect(text()).toContain("Request answers");
    expect(asked).toEqual([INGRID.id, INGRID.id]);
  });
});

describe("the review list hosts the drawer", () => {
  const list = (rows = ROWS): ReactElement => (
    <AppRouterContext.Provider value={router}>
      <ApplicantsReview eventId="ai-era" query={parseApplicantQuery({})} rows={rows} event={AI_ERA_APPLICANTS} toolbar={null} drawer={{}} />
    </AppRouterContext.Provider>
  );
  const nameLink = (name: string) => [...host.querySelectorAll<HTMLAnchorElement>("a")].find((a) => a.textContent === name)!;

  it("a row's name link (a plain href) and Enter on a row open the drawer over the list: the list stays, the page is not pushed", async () => {
    await render(list());
    const table = host.querySelector('[role="table"]')!;
    expect(panel()).toBeNull();

    await act(async () => nameLink("Nadia Kowalski").click());
    expect(window.location.search).toBe(`?applicant=${NADIA.id}`);
    expect(text()).toContain("Applicant · 3 of 4");
    expect(text()).toContain("Nadia Kowalski");
    expect(host.querySelector('[role="table"]')).toBe(table);
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    const first = panel()!;

    await act(async () => control("Close").click());
    expect(panel()).toBeNull();
    const row = host.querySelector<HTMLElement>('[role="row"][data-index="0"]')!;
    await act(async () => void row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(window.location.search).toBe(`?applicant=${INGRID.id}`);
    expect(text()).toContain("Ingrid Nilsen");
    expect(first.isConnected).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("without the page's `drawer` (loading, frames) the list hosts nothing", async () => {
    await render(
      <AppRouterContext.Provider value={router}>
        <ApplicantsReview eventId="ai-era" query={parseApplicantQuery({})} rows={ROWS} event={AI_ERA_APPLICANTS} toolbar={null} />
      </AppRouterContext.Provider>,
    );
    window.history.replaceState(null, "", `${BASE}?applicant=${NADIA.id}`);
    await act(async () => void window.dispatchEvent(new PopStateEvent("popstate")));
    expect(panel()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
