// @vitest-environment jsdom
/**
 * v5 re-join in the modal: one calm screen + one primary action per case, the tap shown at once (optimistic, rolled
 * back on an error), never an auto-sent request again, never onboarding or the profile offer, the right status and
 * closed reasons, and "Keep my account" while the account is in its deletion grace period.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult, SubmitResult } from "@didit-events/core/contracts/event-model";
import { RequestJoin } from "./components/RequestJoin";
import { JoinFlow } from "./components/join/JoinFlow";
import { AI_ERA } from "./fixtures";
import { ONBOARDING_VIEWS, fixtureOnboardingApi } from "./onboarding-fixtures";
import { PENDING_REGISTRATION, REJOIN_CONTEXTS as R, REQUEST_CONTEXTS as C, fixtureRequestApi } from "./request-fixtures";
import type { RequestContext } from "./request-join";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/e/ai-era" }));

const html = (el: ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
const signIn = vi.fn(async () => ({ step: "choose" as const }));

describe("re-join screens (server render: the first screen never flashes another step)", () => {
  const modal = (ctx: RequestContext) => html(<JoinFlow event={AI_ERA} initial={{ kind: "signed_in", ctx }} signIn={signIn} onClose={() => {}} />);

  it.each([
    ["withdrew", R.withdrew, "Request again", "Request again", /goes back to the hosts/],
    ["cancelled", R.cancelled, "Request your place again", "Request my place again", /hosts approve every place/],
    ["invited", R.invited, "You were invited — rejoin", "Rejoin", /invitation still stands/],
    ["invite lapsed", R.inviteExpired, "Request your place again", "Request my place again", /hosts approve every place/],
    ["rejected", R.rejected, "Request again", "Request again", /second request once/],
    ["full with a waitlist", R.fullWaitlist, "Request your place again", "Join the waitlist", /join the waitlist/],
  ])("%s: one calm screen, the rule in one line, one primary action, no profile or onboarding", (_name, ctx, title, action, rule) => {
    const out = modal(ctx);
    expect(out).toContain(`>${title}<`);
    expect(out).toContain(`>${action}<`);
    expect(out).toMatch(rule);
    expect(out).toContain("data-rejoin-rule");
    expect(out).not.toMatch(/Complete your profile|Verify you're human|SHARED WITH THE HOSTS/);
  });

  it.each([
    ["once", R.once, "You withdrew your request", "Email the hosts", /already requested again once/],
    ["blocked after a rejection", R.rejectedBlocked, "The hosts could not offer you a place", "Email the hosts", /not taking another request/],
    ["closed", R.closed, "You withdrew your request", "Back to event", /Requests for this event are closed/],
    ["cancelled by the hosts", R.hostCancelled, "The hosts cancelled your place", "Email the hosts", /mistake/],
    ["revoked", R.revoked, "Your place was withdrawn", "Email the hosts", /mistake/],
    ["approved", R.approved, "You're in", "View my ticket", /your face is your ticket/],
    ["checked in", R.checkedIn, "You're checked in", "View my registration", /Enjoy/],
  ])("%s: status only, never a request button", (_name, ctx, title, primary, lead) => {
    const out = modal(ctx);
    expect(out).toContain(title);
    expect(out).toContain(primary);
    expect(out).toMatch(lead);
    expect(out).not.toMatch(/>Request again<|>Request my place again<|>Rejoin</);
  });

  it("waitlisted: the position and Leave the waitlist", () => {
    const out = modal(R.waitlisted);
    expect(out).toContain("You're on the waitlist");
    expect(out).toContain("number 3 in line");
    expect(out).toContain('href="/me/events/ai-era/cancel"');
    expect(out).toContain("Leave the waitlist");
  });

  it("pending: Withdraw request is the quiet second action", () => {
    const out = modal({ ...C.oneTap, nextAction: "status", registration: PENDING_REGISTRATION });
    expect(out).toContain("Your request is in");
    expect(out).toContain('href="/me/events/ai-era/withdraw"');
  });

  it.each([
    ["started", "The event has started"],
    ["ended", "This event has ended"],
    ["cancelled", "This event was cancelled"],
    ["full", "This event is full"],
    ["invite_only", "This event is invite only"],
    ["closed", "Requests are closed"],
  ] as const)("closed (%s): the reason, no dead button", (availability, title) => {
    const out = modal({ ...C.oneTap, nextAction: "unavailable", canSubmit: false, availability });
    expect(out).toContain(title);
    expect(out).not.toMatch(/>Request to join<|>Join waitlist</);
  });

  it("face expired on a request again: straight to the check (no intro screen)", () => {
    const out = modal(R.faceExpired);
    expect(out).toContain("Time to refresh your face check");
    expect(out).not.toContain(">Next<");
  });

  it("deleting: Keep my account, then the flow continues; Not now closes", () => {
    const keep = vi.fn(async () => ({ kept: true }));
    const out = html(<JoinFlow event={AI_ERA} initial={{ kind: "deleting", graceUntil: "2026-10-08T17:30:00Z" }} signIn={signIn} onClose={() => {}} keepAccount={keep} />);
    expect(out).toContain("Your account is being deleted");
    expect(out).toContain("8 Oct 2026");
    expect(out).toContain("Keep my account");
    expect(out).toContain("carry on joining");
    expect(out).toContain("Not now");
  });
});

describe("re-join interactions", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    for (const f of Object.values(router)) f.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const render = (el: ReactElement) => act(() => root.render(el));
  const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
  const title = () => host.querySelector("#request-title")?.textContent;
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };

  it("withdraw → request again: the result shows on tap (optimistic), the server's answer lands, no profile offer", async () => {
    const api = fixtureRequestApi({ contexts: [R.withdrew] });
    const answer = deferred<ApiResult<SubmitResult>>();
    api.submit = vi.fn(() => answer.promise);
    const onRegistered = vi.fn();
    // A profile with gaps: a first request would offer "Complete your profile"; a request again never does.
    const ctx = { ...R.withdrew, onboarding: { ...ONBOARDING_VIEWS.complete, photoUrl: null } };
    await render(<RequestJoin event={AI_ERA} initial={ctx} api={api} profileApi={fixtureOnboardingApi()} navigate={vi.fn()} onRegistered={onRegistered} onClose={() => {}} autoSubmit />);
    // Never sent on its own, even with the join intent.
    expect(api.submit).not.toHaveBeenCalled();
    expect(title()).toBe("Request again");
    await act(async () => button("Request again")!.click());
    expect(title()).toBe("Request sent");
    expect(onRegistered).not.toHaveBeenCalled();
    // A second tap cannot send twice: the screen moved on.
    expect(button("Request again")).toBeUndefined();
    await act(async () => answer.resolve({ ok: true, data: { replayed: false, redirectTo: "/me/events/ai-era", registration: { ...PENDING_REGISTRATION, admission: "pending" } } }));
    expect(title()).toBe("Request sent");
    expect(onRegistered).toHaveBeenCalledTimes(1);
    expect(button("Complete your profile")).toBeUndefined();
    expect(api.submit).toHaveBeenCalledTimes(1);
  });

  it("an error rolls the optimistic result back to the same screen with a notice; the retry reuses the idempotency key", async () => {
    const api = fixtureRequestApi({ contexts: [R.cancelled] });
    const keys: string[] = [];
    let n = 0;
    api.submit = vi.fn(async (body) => {
      keys.push(body.idempotencyKey);
      return n++ === 0 ? { ok: false as const, error: { code: "provider_unavailable" as const, message: "You seem to be offline. Check your connection and try again." } } : { ok: true as const, data: { replayed: true, redirectTo: "/me/events/ai-era", registration: PENDING_REGISTRATION } };
    });
    await render(<RequestJoin event={AI_ERA} initial={R.cancelled} api={api} profileApi={fixtureOnboardingApi()} navigate={vi.fn()} onClose={() => {}} />);
    await act(async () => button("Request my place again")!.click());
    expect(title()).toBe("Request your place again");
    expect(host.textContent).toContain("You seem to be offline");
    await act(async () => button("Request my place again")!.click());
    expect(title()).toBe("Request sent");
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("invited → rejoin lands on You're in", async () => {
    const api = fixtureRequestApi({ contexts: [R.invited], submit: { replayed: false, redirectTo: "/me/events/ai-era", registration: { ...PENDING_REGISTRATION, admission: "approved" } } });
    await render(<RequestJoin event={AI_ERA} initial={R.invited} api={api} profileApi={fixtureOnboardingApi()} navigate={vi.fn()} onClose={() => {}} />);
    await act(async () => button("Rejoin")!.click());
    expect(title()).toBe("You're in");
  });
});
