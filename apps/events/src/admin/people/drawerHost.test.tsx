// @vitest-environment jsdom
// v11: the People drawer opens once (the row's header at once, one panel through loading and from person to person)
// and moves the URL with the History API instead of pushing the page.
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeopleDetail, PeopleRow } from "./types";

// next/dynamic resolves on a later tick: the tests mount the drawer itself (the lazy boundary is Next's, not ours).
vi.mock("./LazyDrawer", async () => ({ LazyPeopleDrawer: (await import("./PeopleDrawer")).PeopleDrawer, preloadPeopleDrawer: () => {} }));
const { PeopleTable } = await import("./PeopleTable");
const { drawerGo } = await import("../drawer/url");
const { parsePeopleQuery } = await import("./query");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = "2026-10-01T12:00:00.000Z";
const ANA: PeopleRow = {
  id: "6d0f8f5e-3c0a-4f8e-9a51-1b2c3d4e5f60", name: "Ana García", email: "ana@example.test", emailVerified: true, photoUrl: null, headline: "Head of Risk", company: "Globex",
  verified: { verifiedAt: "2026-08-21T10:00:00Z", method: "Selfie liveness", emailVerifiedAt: "2026-08-20T10:00:00Z", createdAt: "2026-08-19T10:00:00Z" },
  verification: "verified", registered: 3, attended: 2, lastActiveAt: "2026-10-01T11:55:00Z", createdAt: "2026-08-19T10:00:00Z", staffRole: null, memberships: 0, deletion: null,
};
const BOB: PeopleRow = { ...ANA, id: "7d0f8f5e-3c0a-4f8e-9a51-1b2c3d4e5f60", name: "Bob Stone", email: "bob@example.test", headline: "", company: "", verified: null, verification: "not_started" };
const detail = (row: PeopleRow): PeopleDetail => ({
  id: row.id, name: row.name, email: row.email, photoUrl: row.photoUrl, headline: row.headline, company: row.company, role: "", bio: "", links: [],
  emailVerifiedAt: null, createdAt: row.createdAt, profileVersion: 1, profileCompletedAt: null, onboardedAt: null, lastActiveAt: row.lastActiveAt, deletingAt: null, deletedAt: null,
  verified: row.verified, verification: { state: row.verification, method: null, verifiedAt: null, validUntil: null, sessionId: null, diditUrl: null }, signIn: [], selfieUrl: null,
  registrations: [], attendance: { registered: 0, approved: 0, attended: 0, noShows: 0 }, staff: null, memberships: [], activity: [],
}) as PeopleDetail;

const router = { bfcacheId: "test", push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() };
let asked: string[] = [];
let waiting = new Map<string, (data: PeopleDetail | null) => void>();
const fetchMock = vi.fn((url: string) => {
  const id = /people\/([^/?]+)$/.exec(url)![1]!;
  asked.push(id);
  return new Promise((resolve) => waiting.set(id, (data) => resolve({ ok: true, status: 200, json: async () => ({ ok: true, data }) })));
});
const tick = () => new Promise((r) => setTimeout(r, 0));
const answer = (id: string, data: PeopleDetail | null) =>
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
  window.history.replaceState(null, "", "/admin/people?filter=verified");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const ROWS = [ANA, BOB];
const query = parsePeopleQuery({ filter: "verified" });
const view = (seed?: { id: string; detail: Promise<PeopleDetail | null> }): ReactElement => (
  <AppRouterContext.Provider value={router}>
    <PeopleTable query={query} rows={ROWS} total={2} loading={false} now={NOW} drawer={{ seed }} />
  </AppRouterContext.Provider>
);
const render = (el: ReactElement) => act(async () => root.render(el));
const panel = () => document.querySelector<HTMLElement>('aside[role="dialog"]');
const text = () => panel()?.textContent ?? "";
const loading = () => !!panel()?.querySelector('[aria-busy="true"]');

describe("people drawer host", () => {
  it("a row's name link opens the drawer in place: the row's header at once, one panel, no page navigation", async () => {
    await render(view());
    expect(panel()).toBeNull();
    const link = [...host.querySelectorAll<HTMLAnchorElement>("a")].find((a) => a.textContent === ANA.name)!;
    await act(async () => link.click());
    expect(window.location.search).toBe(`?filter=verified&person=${ANA.id}`);
    const first = panel()!;
    expect(text()).toContain("Ana García");
    expect(text()).toContain("Head of Risk — Globex");
    expect(text()).toContain("ana@example.test");
    expect(loading()).toBe(true);
    expect(asked).toEqual([ANA.id]);

    await answer(ANA.id, detail(ANA));
    expect(panel()).toBe(first);
    expect(loading()).toBe(false);
    expect(text()).toContain("Attendance");

    await act(async () => drawerGo(`/admin/people?filter=verified&person=${BOB.id}`));
    expect(panel()).toBe(first);
    expect(text()).toContain("Bob Stone");
    expect(text()).not.toContain("Ana García");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("a deep link uses the page's own stream; closing returns to the list; an unknown account closes", async () => {
    window.history.replaceState(null, "", `/admin/people?filter=verified&person=${BOB.id}`);
    await render(view({ id: BOB.id, detail: Promise.resolve(detail(BOB)) }));
    expect(text()).toContain("Bob Stone");
    expect(loading()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => panel()!.querySelector<HTMLElement>('[aria-label="Close"]')!.click());
    expect(window.location.search).toBe("?filter=verified");
    expect(panel()).toBeNull();

    const unknown = "8d0f8f5e-3c0a-4f8e-9a51-1b2c3d4e5f60";
    await act(async () => drawerGo(`/admin/people?filter=verified&person=${unknown}`));
    await answer(unknown, null);
    expect(window.location.search).toBe("?filter=verified");
    expect(panel()).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });
});
