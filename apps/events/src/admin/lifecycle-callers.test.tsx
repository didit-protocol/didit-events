// @vitest-environment jsdom
// v24: Publish, Cancel event and Reopen requests are sent with the event's edit version (they always failed without
// it), and a stale version says the event changed.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_ERA_APPLICANTS, DESIGN_APPLICANTS } from "./applicants/fixtures";
import { parseApplicantQuery } from "./applicants/query";
import type { EventHeaderInfo } from "./types";

const lifecycleAction = vi.hoisted(() => vi.fn());
const reopenRequestsAction = vi.hoisted(() => vi.fn());
vi.mock("../../app/admin/(events)/events/[id]/(tabs)/settings/actions", () => ({ lifecycleAction }));
vi.mock("../../app/admin/(events)/events/[id]/(tabs)/applicants/actions", () => ({ decideAction: vi.fn(), undoRejectAction: vi.fn(), reopenRequestsAction, saveNoteAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, useSelectedLayoutSegment: () => "settings", usePathname: () => "/admin/events/e1", useSearchParams: () => new URLSearchParams() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@didit-events/ui", async (orig) => ({ ...(await orig<object>()), toast }));

const { EventHeaderActions } = await import("./event/EventHeaderActions");
const { ApplicantsReview } = await import("./applicants/ApplicantsReview");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() };
const CHANGED = "This event changed since you opened it. Refresh and try again.";
const header = (status: EventHeaderInfo["status"], editVersion: number): EventHeaderInfo => ({ id: "e1", name: "E2E Test Event", status, when: "Thu, 1 Oct 2026", requestLink: "events.didit.me/e/e2e-test", guestCount: 0, requestCount: 0, editVersion });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});
const mount = (node: React.ReactNode) => act(async () => root.render(<AppRouterContext.Provider value={router as unknown as React.ContextType<typeof AppRouterContext>}>{node}</AppRouterContext.Provider>));
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label)!;
const click = (label: string) => act(async () => button(label).click());
const alerts = () => [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent);

describe("lifecycle callers send the event's edit version", () => {
  it("header Publish: the draft's version goes with the action", async () => {
    lifecycleAction.mockResolvedValue({ ok: true });
    await mount(<EventHeaderActions event={header("draft", 7)} />);
    await click("Publish event");
    expect(lifecycleAction).toHaveBeenCalledWith("e1", "publish", "", expect.any(String), 7);
    expect(toast).toHaveBeenCalledWith({ message: "Event published." });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("header Publish with a stale version says the event changed", async () => {
    lifecycleAction.mockResolvedValue({ error: "conflict" });
    await mount(<EventHeaderActions event={header("draft", 7)} />);
    await click("Publish event");
    expect(alerts()).toEqual([CHANGED]);
    expect(toast).not.toHaveBeenCalled();
  });

  it("header Cancel event: the reason and the version go with the action; a stale version says the event changed", async () => {
    lifecycleAction.mockResolvedValueOnce({ error: "conflict" }).mockResolvedValueOnce({ ok: true });
    await mount(<EventHeaderActions event={header("open", 12)} />);
    await click("Cancel event");
    const reason = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(reason, "Venue unavailable");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Confirm cancellation");
    expect(lifecycleAction).toHaveBeenLastCalledWith("e1", "cancel", "Venue unavailable", expect.any(String), 12);
    expect(alerts()).toEqual([CHANGED]);
    await click("Confirm cancellation");
    expect(toast).toHaveBeenCalledWith({ message: "Event cancelled. Guest notifications queued." });
  });

  it("Applicants “Reopen requests”: the list's version goes with the action; a stale version says the event changed", async () => {
    reopenRequestsAction.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ error: "conflict" });
    const event = { ...AI_ERA_APPLICANTS, registration: "closed" as const, closedOn: "Tue 6 Oct", editVersion: 5 };
    await mount(<ApplicantsReview eventId="ai-era" query={parseApplicantQuery({})} rows={DESIGN_APPLICANTS.slice(0, 2)} event={event} pendingCount={2} toolbar={null} />);
    await click("Reopen requests");
    expect(reopenRequestsAction).toHaveBeenCalledWith("ai-era", expect.any(String), 5);
    expect(toast).toHaveBeenLastCalledWith({ message: "Requests are open again" });
    await click("Reopen requests");
    expect(toast).toHaveBeenLastCalledWith({ message: CHANGED, tone: "danger" });
  });
});
