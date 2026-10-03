// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingView, RequestContext } from "@didit-events/core/contracts/event-model";
import { DiditCheck } from "./components/join/DiditCheck";
import { JoinFlow } from "./components/join/JoinFlow";
import { RequestJoinContent } from "./components/RequestJoinContent";
import { AI_ERA } from "./fixtures";
import { clearJoinIntent, hasJoinIntent, markJoinIntent } from "./join/intent";
import { canAutoSubmit, checksDecision, decisionPhase, initialFacePhase, joinStage, launchPhase, resultCopy, sdkPhase, settledCheckOp, SETTLED_STUCK_MS, streamMode, viewPhase, watchesDecision, type JoinInitial } from "./join/machine";
import type { EmbeddedHandlers } from "./join/sdk";
import { afterSignIn, joinSlug } from "./links";
import { ONBOARDING_VIEWS as V, fixtureOnboardingApi } from "./onboarding-fixtures";
import { PENDING_REGISTRATION, REQUEST_CONTEXTS as C, fixtureRequestApi, registrationWith, rejoinFacts } from "./request-fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const html = (el: ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
const signedIn = (ctx: RequestContext): JoinInitial => ({ kind: "signed_in", ctx });
const checkingPhase = (p: { phase: string }) => p.phase;
const signIn = vi.fn(async () => ({ step: "choose" as const }));

describe("join modal state machine", () => {
  it("signed out → sign in; closed events say so instead", () => {
    expect(joinStage({ kind: "signed_out", requestsOpen: true })).toBe("sign_in");
    expect(joinStage({ kind: "signed_out", requestsOpen: false })).toBe("unavailable");
    expect(joinStage({ kind: "unavailable", reason: "account" })).toBe("unavailable");
  });

  it("signed in: only what is missing, each step skipped when satisfied", () => {
    expect(joinStage(signedIn(C.profile))).toBe("profile");
    expect(joinStage(signedIn(C.face))).toBe("face"); // profile complete → straight to the face
    expect(joinStage(signedIn(C.extras))).toBe("extras"); // face valid → straight to the event's extras
    expect(joinStage(signedIn(C.questions))).toBe("answers");
    expect(joinStage(signedIn(C.oneTap))).toBe("submit"); // everything done → the request
    expect(joinStage(signedIn({ ...C.oneTap, nextAction: "status", registration: PENDING_REGISTRATION }))).toBe("done");
    expect(joinStage(signedIn({ ...C.oneTap, nextAction: "unavailable" }))).toBe("unavailable");
  });

  it("auto-submit only with the tap intent and nothing left to ask (no questions, phone or host consent)", () => {
    expect(canAutoSubmit(C.oneTap, true)).toBe(true);
    expect(canAutoSubmit(C.oneTap, false)).toBe(false);
    expect(canAutoSubmit(C.questions, true)).toBe(false);
    expect(canAutoSubmit({ ...C.oneTap, consent: { ...C.oneTap.consent, eventConsentText: "Photos are taken." } }, true)).toBe(false);
    expect(canAutoSubmit({ ...C.oneTap, event: { ...C.oneTap.event, form: { ...C.oneTap.event.form, fields: { phone_number: "optional" } } } }, true)).toBe(false);
    expect(canAutoSubmit(C.face, true)).toBe(false);
  });

  it("final copy: Request sent / You're in / waitlist", () => {
    expect(resultCopy("pending", "AI Era").title).toBe("Request sent");
    expect(resultCopy("approved", "AI Era").title).toBe("You're in");
    expect(resultCopy("waitlisted", "AI Era").title).toBe("You're on the waitlist");
  });

  it("face phases: start or resume at once; declined/expired/review from the server; SDK results mapped to our own UI", () => {
    expect(initialFacePhase(V.faceRequired)).toEqual({ phase: "starting" });
    expect(initialFacePhase(V.faceInProgress)).toEqual({ phase: "starting" });
    expect(initialFacePhase(V.faceDeclined)).toEqual({ phase: "declined" });
    expect(initialFacePhase(V.faceLinkExpired)).toEqual({ phase: "expired" });
    expect(initialFacePhase(V.faceInReview)).toEqual({ phase: "review" });
    expect(launchPhase({ state: "ready", opId: "op-1", url: "https://verify.didit.me/session/x", expiresAt: "" })).toEqual({ phase: "embedded", opId: "op-1", url: "https://verify.didit.me/session/x" });
    expect(launchPhase({ state: "creating", opId: "op-1", retryAfterMs: 50 })).toEqual({ phase: "preparing", retryAfterMs: 1000 });
    expect(launchPhase({ state: "not_needed" })).toBe("refresh");
    expect(launchPhase({ state: "blocked", code: "budget" })).toEqual({ phase: "blocked", code: "budget" });
    const embedded = { phase: "embedded", opId: "op-1", url: "u" } as const;
    expect(sdkPhase(embedded, { type: "completed", session: { sessionId: "s", status: "Approved" } })).toEqual({ phase: "checking", opId: "op-1" });
    expect(sdkPhase(embedded, { type: "cancelled" })).toEqual({ phase: "cancelled" });
    expect(sdkPhase(embedded, { type: "failed", error: { type: "cameraAccessDenied", message: "" } })).toEqual({ phase: "camera" });
    expect(sdkPhase(embedded, { type: "failed", error: { type: "sessionExpired", message: "" } })).toEqual({ phase: "expired" });
    expect(sdkPhase(embedded, { type: "failed", error: { type: "networkError", message: "" } })).toEqual({ phase: "error" });
  });

  it("a pushed view settles the check; an older failure never overrides a new attempt", () => {
    const checking = { phase: "checking", opId: "op-new" } as const;
    const failedOld: OnboardingView = { ...V.faceDeclined, operation: { ...V.faceDeclined.operation!, id: "op-old" } };
    const failedNew: OnboardingView = { ...V.faceDeclined, operation: { ...V.faceDeclined.operation!, id: "op-new" } };
    expect(viewPhase(checking, failedOld)).toBe(checking);
    expect(viewPhase(checking, failedNew)).toEqual({ phase: "declined" });
    expect(viewPhase(checking, { ...V.faceInReview, operation: { ...V.faceInReview.operation!, id: "op-new" } })).toEqual({ phase: "review", opId: "op-new" });
    // Review is not terminal: a later failure of the same operation lands, another operation's never does.
    expect(viewPhase({ phase: "review", opId: "op-new" }, failedNew)).toEqual({ phase: "declined" });
    expect(viewPhase({ phase: "review", opId: "op-new" }, failedOld)).toEqual({ phase: "review", opId: "op-new" });
    expect(viewPhase({ phase: "review" }, failedNew)).toEqual({ phase: "review" });
    expect(viewPhase(checking, V.complete)).toEqual({ phase: "done" });
    expect(viewPhase({ phase: "declined" }, V.faceInProgress)).toEqual({ phase: "declined" });
    expect(watchesDecision(checking)).toBe(true);
    expect(watchesDecision({ phase: "declined" })).toBe(false);
  });

  it("the stream is passive while the guest is in the camera UI and waits for a decision afterwards", () => {
    expect(streamMode({ phase: "embedded", opId: "op", url: "u" })).toBe("passive");
    expect(streamMode({ phase: "checking", opId: "op" })).toBe("decision");
    expect(streamMode({ phase: "review" })).toBe("decision");
    expect(streamMode({ phase: "preparing", retryAfterMs: 1000 })).toBe("decision");
  });

  it("extras: the latest check's failure from the context settles the step; an older operation never does", () => {
    const op = (state: "active" | "failed" | "expired", providerStatus: string | null) => ({ ...C.extras, checksOperation: { id: "op-new", state, providerStatus } });
    expect(checksDecision(C.extras)).toBeNull();
    expect(checksDecision(op("active", "In Progress"))).toBeNull();
    expect(checksDecision(op("failed", "Declined"))).toEqual({ opId: "op-new", outcome: "declined" });
    expect(checksDecision(op("failed", "Expired"))).toEqual({ opId: "op-new", outcome: "expired" });
    expect(checksDecision(op("expired", null))).toEqual({ opId: "op-new", outcome: "expired" });
    expect(checksDecision(op("active", "In Review"))).toEqual({ opId: "op-new", outcome: "review" });
    expect(checksDecision({ ...op("failed", "Declined"), nextAction: "answers" })).toBeNull();
    const checking = { phase: "checking", opId: "op-new" } as const;
    expect(decisionPhase(checking, { opId: "op-new", outcome: "declined" })).toEqual({ phase: "declined" });
    expect(decisionPhase(checking, { opId: "op-old", outcome: "declined" })).toBe(checking);
    expect(decisionPhase({ phase: "declined" }, { opId: "op-new", outcome: "review" })).toEqual({ phase: "declined" });
    expect(decisionPhase(checking, null)).toBe(checking);
    expect(decisionPhase(checking, { opId: "op-new", outcome: "review" })).toEqual({ phase: "review", opId: "op-new" });
  });

  it("extras: review keeps its operation, so a later terminal decision for it still lands", () => {
    const review = { phase: "review", opId: "op-new" } as const;
    expect(decisionPhase(review, { opId: "op-new", outcome: "review" })).toBe(review);
    expect(decisionPhase(review, { opId: "op-new", outcome: "declined" })).toEqual({ phase: "declined" });
    expect(decisionPhase(review, { opId: "op-new", outcome: "expired" })).toEqual({ phase: "expired" });
    expect(decisionPhase(review, { opId: "op-old", outcome: "declined" })).toBe(review);
    expect(decisionPhase({ phase: "review" }, { opId: "op-new", outcome: "declined" })).toEqual({ phase: "review" });
    const notEligible = { opId: "op-new", outcome: "not_eligible", check: "age", reason: "below_minimum", minimum: 21, retry: false } as const;
    expect(decisionPhase(review, notEligible)).toEqual({ phase: "not_eligible", check: "age", reason: "below_minimum", minimum: 21, retry: false });
  });

  it("extras: Didit approved but the requirement is still unmet → not eligible (retry only when it can help)", () => {
    const done = (ctx: RequestContext) => ({ ...ctx, checksOperation: { id: "op-new", state: "completed" as const, providerStatus: "Approved" } });
    expect(checksDecision(done(C.extrasBelowMinimum))).toEqual({ opId: "op-new", outcome: "not_eligible", check: "age", reason: "below_minimum", minimum: 21, retry: false });
    expect(checksDecision(done({ ...C.extras, missing: [{ check: "name_from_id", reason: "name_mismatch" }] }))).toEqual({ opId: "op-new", outcome: "not_eligible", check: "name_from_id", reason: "name_mismatch", retry: false });
    expect(checksDecision(done(C.extras))).toMatchObject({ outcome: "not_eligible", check: "phone", reason: "absent", retry: true });
    expect(checksDecision(done({ ...C.extras, missing: [{ check: "age", reason: "continuity_required" }] }))).toEqual({ opId: "op-new", outcome: "review" });
    // Moving on (the requirement is met) is the parent's job, not a decision.
    expect(checksDecision({ ...done(C.extras), nextAction: "answers", missing: [] })).toBeNull();
    expect(checkingPhase(decisionPhase({ phase: "checking", opId: "op-new" }, checksDecision(done(C.extrasBelowMinimum))))).toBe("not_eligible");
    expect(settledCheckOp(done(C.extras))).toBe("op-new");
    expect(settledCheckOp({ ...C.extras, checksOperation: { id: "op-new", state: "active", providerStatus: null } })).toBeNull();
    expect(settledCheckOp(C.extras)).toBeNull();
  });

  it("intent lives in this tab only and expires", () => {
    clearJoinIntent("ai-era");
    expect(hasJoinIntent("ai-era")).toBe(false);
    markJoinIntent("ai-era", 1_000);
    expect(hasJoinIntent("ai-era", 2_000)).toBe(true);
    expect(hasJoinIntent("ai-era", 1_000 + 31 * 60_000)).toBe(false);
    expect(hasJoinIntent("other")).toBe(false);
    clearJoinIntent("ai-era");
  });

  it("sign-in returns to the join modal (the old /register too); other unfinished accounts use the fallback page", () => {
    expect(joinSlug("/e/ai-era?join=1")).toBe("ai-era");
    expect(joinSlug("/e/ai-era/register")).toBe("ai-era");
    expect(joinSlug("/e/ai-era")).toBeNull();
    expect(joinSlug("//evil.example/e/x?join=1")).toBeNull();
    expect(afterSignIn("/e/ai-era?join=1", "profile_required")).toBe("/e/ai-era?join=1");
    expect(afterSignIn("/e/ai-era/register", "complete")).toBe("/e/ai-era?join=1");
    expect(afterSignIn("/me/profile", "face_required")).toBe("/onboarding?returnTo=%2Fme%2Fprofile");
    expect(afterSignIn("/me/profile", "complete")).toBe("/me/profile");
    expect(afterSignIn("/admin", "profile_required")).toBe("/admin");
  });
});

describe("join modal content (server render)", () => {
  it("signed out: the explanation first, Google + email code, no consent checkbox, the disclosure version recorded", () => {
    const out = html(<JoinFlow event={AI_ERA} initial={{ kind: "signed_out", requestsOpen: true }} signIn={signIn} />);
    expect(out).toContain("You'll verify you're human once, and you'll be recognised at your next Didit event.");
    expect(out).toMatch(/Create your account[\s\S]*Verify you're human, once[\s\S]*Get recognised at your next Didit event/);
    expect(out).not.toContain('type="checkbox"');
    expect(out).not.toContain("I agree to prepare");
    expect(out).toContain('data-disclosure-version="events-profile-v2"');
    expect(out).toContain('name="onboardingConsent"');
    expect(out).toMatch(/href="\/api\/auth\/oidc\/start\?idp=google&next=%2Fe%2Fai-era%3Fjoin%3D1&consent=/);
    expect(out).toContain('name="next" value="/e/ai-era?join=1"');
    expect(out).toMatch(/Terms[\s\S]*Privacy/);
  });

  it("closed: says so, no sign-in", () => {
    const out = html(<JoinFlow event={AI_ERA} initial={{ kind: "signed_out", requestsOpen: false }} signIn={signIn} onClose={() => {}} />);
    expect(out).toContain("Requests are closed");
    expect(out).not.toContain('name="email"');
  });

  it("an existing registration shows its state in the modal", () => {
    const out = html(<JoinFlow event={AI_ERA} initial={signedIn({ ...C.oneTap, nextAction: "status", registration: registrationWith(rejoinFacts({ admission: "approved", cancelledFrom: null })) })} signIn={signIn} onClose={() => {}} />);
    expect(out).toContain("You're in");
    expect(out).toContain("Back to event");
  });
});

describe("join modal interactions", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    for (const f of Object.values(router)) f.mockClear();
    sessionStorage.clear();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
  const render = (el: ReactElement) => act(async () => root.render(el));
  const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;

  it("× and Esc return to the event page (Back when opened here) and focus goes back to Request to join", async () => {
    const { JoinLauncher } = await import("./components/join/JoinLauncher");
    const trigger = document.createElement("a");
    trigger.href = "/e/ai-era?join=1";
    trigger.textContent = "Request to join";
    document.body.appendChild(trigger);
    try {
      await render(<JoinLauncher event={AI_ERA} open={false} initial={null} signIn={signIn} />);
      // Opening from the page: intent + an in-page push of ?join=1 (so Back closes it).
      await act(async () => trigger.click());
      expect(router.push).toHaveBeenCalledWith("/e/ai-era?join=1", { scroll: false });
      expect(hasJoinIntent("ai-era")).toBe(true);
      await render(<JoinLauncher event={AI_ERA} open initial={{ kind: "signed_out", requestsOpen: true }} signIn={signIn} />);
      await vi.waitFor(() => expect(host.querySelector('[role="dialog"][aria-labelledby="request-title"]')).not.toBeNull());
      await act(async () => (host.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click());
      expect(router.back).toHaveBeenCalledTimes(1);
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      expect(hasJoinIntent("ai-era")).toBe(false);
      await vi.waitFor(() => expect(document.activeElement).toBe(trigger));

      // A direct ?join=1 link (not opened here): Esc replaces the URL with the event page.
      await render(<JoinLauncher event={AI_ERA} open initial={{ kind: "signed_out", requestsOpen: true }} signIn={signIn} />);
      await vi.waitFor(() => expect(host.querySelector('[role="dialog"]')).not.toBeNull());
      await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(router.replace).toHaveBeenCalledWith("/e/ai-era", { scroll: false });
      expect(host.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      trigger.remove();
    }
  });

  it("with the tap intent, a guest with nothing left to ask gets the request sent on its own, once", async () => {
    const api = fixtureRequestApi();
    const onRegistered = vi.fn();
    await render(<RequestJoinContent event={AI_ERA} initial={C.oneTap} api={api} profileApi={fixtureOnboardingApi()} autoSubmit onRegistered={onRegistered} />);
    await vi.waitFor(() => expect(host.textContent).toContain("Request sent"));
    expect(api.calls).toEqual(["submit"]);
    expect(onRegistered).toHaveBeenCalledWith(PENDING_REGISTRATION);
    // Without the intent (a shared ?join=1 link): one tap.
    act(() => root.unmount());
    root = createRoot(host);
    const api2 = fixtureRequestApi();
    await render(<RequestJoinContent event={AI_ERA} initial={C.oneTap} api={api2} profileApi={fixtureOnboardingApi()} />);
    expect(api2.calls).toEqual([]);
    expect(button("Request to join")).toBeTruthy();
  });

  it("face: the SDK runs embedded; on completion 'Checking your result…', then the pushed decision moves the flow on", async () => {
    const sources: { onmessage: ((e: { data: string }) => void) | null; close: () => void; url: string }[] = [];
    vi.stubGlobal("EventSource", class { onmessage = null; url: string; constructor(url: string) { this.url = url; sources.push(this as never); } addEventListener() {} close() {} });
    let handlers: EmbeddedHandlers | undefined;
    const embed = vi.fn(async (_url: string, _id: string, h: EmbeddedHandlers) => { handlers = h; return () => {}; });
    const done = { ...C.oneTap };
    const api = fixtureRequestApi({ contexts: [done] });
    const profileApi = fixtureOnboardingApi({ launch: { state: "ready", opId: "op-fixture", url: "https://verify.didit.me/session/face", expiresAt: "" } });
    await render(<RequestJoinContent event={AI_ERA} initial={C.face} api={api} profileApi={profileApi} embed={embed} />);
    // "Verify you're human" first: nothing launches until Next.
    expect(profileApi.calls).toEqual([]);
    await act(async () => button("Next").click());
    await vi.waitFor(() => expect(embed).toHaveBeenCalledWith("https://verify.didit.me/session/face", expect.stringMatching(/^didit-/), expect.anything()));
    expect(profileApi.calls).toEqual(["startFace:onboarding"]);
    expect(host.querySelector(`#${embed.mock.calls[0]![1]}`)).not.toBeNull();
    expect(sources.map((s) => s.url)).toEqual(["/api/me/verification/stream"]);
    await act(async () => handlers!.onComplete({ type: "completed", session: { sessionId: "s", status: "Approved" } }));
    expect(host.textContent).toContain("Checking your result…");
    // Out of the camera UI: the stream now asks the server to read Didit (it only read rarely before).
    expect(sources.at(-1)!.url).toBe("/api/me/verification/stream?wait=decision");
    // The webhook (or the server's own decision read) lands: the stream pushes, the modal re-reads and moves on.
    await act(async () => sources.at(-1)!.onmessage!({ data: JSON.stringify({ type: "verification.updated" }) }));
    await vi.waitFor(() => expect(host.textContent).toContain("EVERYTHING IS READY"));
    expect(api.calls).toContain("refresh");
  });

  it("face: camera blocked and declined are ours, with Try again that starts a new check", async () => {
    let handlers: EmbeddedHandlers | undefined;
    const embed = vi.fn(async (_u: string, _i: string, h: EmbeddedHandlers) => { handlers = h; return () => {}; });
    const api = fixtureOnboardingApi();
    await render(<DiditCheck titleId="t" view={V.faceRequired} launch={() => api.startFace({ purpose: "onboarding", consent: { disclosureVersion: "events-profile-v2", shareProfileWithHosts: true, eventConsentAccepted: false, acceptedChecks: ["face"] }, returnTo: "/" })} refresh={async () => {}} title="Verify you're human" lead="" embed={embed} />);
    await vi.waitFor(() => expect(embed).toHaveBeenCalledTimes(1));
    await act(async () => handlers!.onComplete({ type: "failed", error: { type: "cameraAccessDenied", message: "" } }));
    expect(host.textContent).toContain("Your camera is blocked");
    await act(async () => button("Try again").click());
    await vi.waitFor(() => expect(embed).toHaveBeenCalledTimes(2));
    expect(api.calls).toEqual(["startFace:onboarding", "startFace:onboarding"]);

    act(() => root.unmount());
    root = createRoot(host);
    const retry = fixtureOnboardingApi();
    await render(<DiditCheck titleId="t" view={V.faceDeclined} launch={() => retry.startFace({ purpose: "onboarding", consent: { disclosureVersion: "events-profile-v2", shareProfileWithHosts: true, eventConsentAccepted: false, acceptedChecks: ["face"] }, returnTo: "/" })} refresh={async () => {}} title="Verify you're human" lead="" embed={embed} />);
    expect(host.textContent).toContain("We couldn't confirm it's you");
    expect(retry.calls).toEqual([]);
    await act(async () => button("Try again").click());
    await vi.waitFor(() => expect(retry.calls).toEqual(["startFace:onboarding"]));
  });

  it("a Didit outage or paused budget keeps the guest in the modal with an honest message", async () => {
    const api = fixtureOnboardingApi({ launch: { state: "blocked", code: "provider_unavailable" } });
    await render(<DiditCheck titleId="t" view={V.faceRequired} launch={() => api.startFace({ purpose: "onboarding", consent: { disclosureVersion: "events-profile-v2", shareProfileWithHosts: true, eventConsentAccepted: false, acceptedChecks: ["face"] }, returnTo: "/" })} refresh={async () => {}} title="x" lead="" embed={vi.fn()} />);
    await vi.waitFor(() => expect(host.textContent).toContain("Didit is not reachable right now"));
    expect(button("Try again")).toBeTruthy();
  });

  const stubStream = () => {
    const sources: { onmessage: ((e: { data: string }) => void) | null; url: string }[] = [];
    vi.stubGlobal("EventSource", class { onmessage = null; url: string; constructor(url: string) { this.url = url; sources.push(this as never); } addEventListener() {} close() {} });
    return sources;
  };

  it("extras: a declined phone/ID/age check shows our own state with Try again that relaunches the checks", async () => {
    const sources = stubStream();
    let handlers: EmbeddedHandlers | undefined;
    const embed = vi.fn(async (_u: string, _i: string, h: EmbeddedHandlers) => { handlers = h; return () => {}; });
    const saved: RequestContext = { ...C.extras, draft: { id: "5c0c3f4e-2f7b-4f7e-9b1e-6d2c1a0b9f01", version: 1, expiresAt: "2026-10-30T10:00:00Z", application: C.extras.prefill } };
    const declined: RequestContext = { ...saved, checksOperation: { id: "op", state: "failed", providerStatus: "Declined" } };
    const api = fixtureRequestApi({ contexts: [saved, declined] });
    await render(<RequestJoinContent event={AI_ERA} initial={C.extras} api={api} profileApi={fixtureOnboardingApi()} embed={embed} />);
    await act(async () => (host.querySelector('input[name="checksConsent"]') as HTMLInputElement).click());
    await act(async () => button("Verify with Didit").click());
    await vi.waitFor(() => expect(embed).toHaveBeenCalledTimes(1));
    expect(api.calls).toEqual(["saveDraft", "startChecks"]);
    await act(async () => handlers!.onComplete({ type: "completed", session: { sessionId: "s", status: "Declined" } }));
    expect(host.textContent).toContain("Checking your result…");
    // First push: still in progress. Second: Didit declined it (the context still says nextAction "extras").
    await act(async () => sources.at(-1)!.onmessage!({ data: JSON.stringify({ type: "verification.updated" }) }));
    expect(host.textContent).toContain("Checking your result…");
    await act(async () => sources.at(-1)!.onmessage!({ data: JSON.stringify({ type: "verification.updated" }) }));
    await vi.waitFor(() => expect(host.textContent).toContain("We couldn't complete this check"));
    expect(host.textContent).not.toContain("Checking your result…");
    await act(async () => button("Try again").click());
    await vi.waitFor(() => expect(api.calls.filter((c) => c === "startChecks")).toHaveLength(2));
    await vi.waitFor(() => expect(embed).toHaveBeenCalledTimes(2));
  });

  it("extras: every refresh pins the operation this tab launched, so another overlapping one cannot hide its outcome", async () => {
    const sources = stubStream();
    let handlers: EmbeddedHandlers | undefined;
    const embed = vi.fn(async (_u: string, _i: string, h: EmbeddedHandlers) => { handlers = h; return () => {}; });
    const saved: RequestContext = { ...C.extras, draft: { id: "5c0c3f4e-2f7b-4f7e-9b1e-6d2c1a0b9f01", version: 1, expiresAt: "2026-10-30T10:00:00Z", application: C.extras.prefill } };
    const underAge: RequestContext = { ...saved, missing: [{ check: "age", reason: "below_minimum", minimum: 18 }], checksOperation: { id: "op-b", state: "completed", providerStatus: "Approved" } };
    const api = fixtureRequestApi({ contexts: [saved, underAge], launch: { state: "ready", opId: "op-b", url: "https://verify.didit.me/session/extras", expiresAt: "2026-10-01T10:00:00Z" } });
    await render(<RequestJoinContent event={AI_ERA} initial={C.extras} api={api} profileApi={fixtureOnboardingApi()} embed={embed} />);
    await act(async () => (host.querySelector('input[name="checksConsent"]') as HTMLInputElement).click());
    await act(async () => button("Verify with Didit").click());
    await vi.waitFor(() => expect(embed).toHaveBeenCalledTimes(1));
    await act(async () => handlers!.onComplete({ type: "completed", session: { sessionId: "s", status: "Approved" } }));
    await act(async () => sources.at(-1)!.onmessage!({ data: JSON.stringify({ type: "verification.updated" }) }));
    await act(async () => sources.at(-1)!.onmessage!({ data: JSON.stringify({ type: "verification.updated" }) }));
    await vi.waitFor(() => expect(host.textContent).not.toContain("Checking your result…"));
    expect(api.pins.length).toBeGreaterThan(0);
    expect(api.pins.every((pin) => pin === "op-b")).toBe(true);
  });

  it("extras: while Didit is still creating the session, the polls pin the operation startChecks returned", async () => {
    vi.useFakeTimers();
    try {
      const api = fixtureRequestApi({ contexts: [C.extras], launch: { state: "creating", opId: "op-b", retryAfterMs: 500 } });
      await render(<RequestJoinContent event={AI_ERA} initial={C.extras} api={api} profileApi={fixtureOnboardingApi()} embed={vi.fn()} />);
      await act(async () => (host.querySelector('input[name="checksConsent"]') as HTMLInputElement).click());
      await act(async () => button("Verify with Didit").click());
      await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
      expect(api.pins.length).toBeGreaterThan(0);
      expect(api.pins.every((pin) => pin === "op-b")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("extras: expired and review decisions get their own copy", async () => {
    const at = (outcome: "expired" | "review" | null) => (
      <DiditCheck titleId="t" initial={{ phase: "checking", opId: "op" }} decision={outcome ? { opId: "op", outcome } : null} launch={async () => ({ ok: true, data: { state: "not_needed" } })} refresh={async () => {}} title="x" lead="" embed={vi.fn()} />
    );
    stubStream();
    await render(at(null));
    expect(host.textContent).toContain("Checking your result…");
    await render(at("expired"));
    expect(host.textContent).toContain("This check expired");
    expect(button("Start a new check")).toBeTruthy();
    act(() => root.unmount());
    root = createRoot(host);
    await render(at(null));
    await render(at("review"));
    expect(host.textContent).toContain("Your check needs a quick review");
  });

  it("extras: under the minimum age says so honestly, no Try again, and Back to event leaves", async () => {
    stubStream();
    const onExit = vi.fn();
    const decision = { opId: "op", outcome: "not_eligible", check: "age", reason: "below_minimum", minimum: 18, retry: false } as const;
    const at = (d: typeof decision | null) => (
      <DiditCheck titleId="t" initial={{ phase: "checking", opId: "op" }} decision={d} onExit={onExit} launch={async () => ({ ok: true, data: { state: "not_needed" } })} refresh={async () => {}} title="x" lead="" embed={vi.fn()} />
    );
    await render(at(null));
    await render(at(decision));
    expect(host.textContent).toContain("This event needs guests aged 18+. Your check says you don't meet it.");
    expect(host.textContent).not.toContain("Checking your result…");
    expect(button("Try again")).toBeUndefined();
    await act(async () => button("Back to event").click());
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("extras: a name that does not match the ID offers Edit my name (no new check) and Back to event", async () => {
    stubStream();
    const launch = vi.fn(async () => ({ ok: true as const, data: { state: "ready" as const, opId: "op-2", url: "https://verify.didit.me/session/2", expiresAt: "" } }));
    const onFixName = vi.fn();
    const at = (d: { opId: string; outcome: "not_eligible"; check: "name_from_id"; reason: "name_mismatch"; retry: false } | null) => (
      <DiditCheck titleId="t" initial={{ phase: "checking", opId: "op" }} decision={d} onExit={() => {}} onFixName={onFixName} launch={launch} refresh={async () => {}} title="x" lead="" embed={vi.fn()} />
    );
    await render(at(null));
    await render(at({ opId: "op", outcome: "not_eligible", check: "name_from_id", reason: "name_mismatch", retry: false }));
    expect(host.textContent).toContain("The name on your ID doesn't match your profile");
    expect(button("Try again")).toBeUndefined();
    expect(button("Back to event")).toBeTruthy();
    await act(async () => button("Edit my name").click());
    expect(onFixName).toHaveBeenCalledTimes(1);
    expect(launch).not.toHaveBeenCalled();
  });

  it("extras: Edit my name opens the profile name inline, saves it and refreshes the context (no verification retry)", async () => {
    stubStream();
    const mismatch: RequestContext = { ...C.extras, missing: [{ check: "name_from_id", reason: "name_mismatch" }] };
    const api = fixtureRequestApi({ contexts: [C.oneTap] });
    const patches: unknown[] = [];
    const profileApi = fixtureOnboardingApi({ save: (patch) => (patches.push(patch), V.faceRequired) });
    await render(<RequestJoinContent event={AI_ERA} initial={mismatch} api={api} profileApi={profileApi} embed={vi.fn()} />);
    expect(host.textContent).toContain("The name on your ID doesn't match your profile");
    expect(button("Verify with Didit")).toBeUndefined();
    await act(async () => button("Edit my name").click());
    const field = host.querySelector('input[name="fullName"]') as HTMLInputElement;
    expect(field).toBeTruthy();
    expect(host.querySelector('input[name="company"]')).toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Alex Smith");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Save name").click());
    await vi.waitFor(() => expect(profileApi.calls).toEqual(["saveProfile"]));
    expect(patches[0]).toMatchObject({ fullName: "Alex Smith" });
    await vi.waitFor(() => expect(api.calls).toEqual(["refresh"]));
    await vi.waitFor(() => expect(host.textContent).toContain(C.oneTap.submitLabel));
    expect(api.calls).not.toContain("startChecks");
  });

  it("extras: a check under review still turns into declined when Didit later declines the same operation", async () => {
    stubStream();
    const at = (outcome: "review" | "declined" | null) => (
      <DiditCheck titleId="t" initial={{ phase: "checking", opId: "op" }} decision={outcome ? { opId: "op", outcome } : null} launch={async () => ({ ok: true, data: { state: "not_needed" } })} refresh={async () => {}} title="x" lead="" embed={vi.fn()} />
    );
    await render(at(null));
    await render(at("review"));
    expect(host.textContent).toContain("Your check needs a quick review");
    await render(at("declined"));
    expect(host.textContent).toContain("We couldn't complete this check");
    expect(button("Try again")).toBeTruthy();
  });

  it("extras: a settled operation that never moves the step on falls back to Check again after a short wait", async () => {
    vi.useFakeTimers();
    try {
      stubStream();
      const refresh = vi.fn(async () => {});
      const at = (settled: string | null) => (
        <DiditCheck titleId="t" initial={{ phase: "checking", opId: "op" }} settledOpId={settled} launch={async () => ({ ok: true, data: { state: "not_needed" } })} refresh={refresh} title="x" lead="" embed={vi.fn()} />
      );
      await render(at(null));
      await act(async () => vi.advanceTimersByTime(SETTLED_STUCK_MS * 2));
      expect(host.textContent).toContain("Checking your result…");
      await render(at("other-op"));
      await act(async () => vi.advanceTimersByTime(SETTLED_STUCK_MS * 2));
      expect(host.textContent).toContain("Checking your result…");
      await render(at("op"));
      await act(async () => vi.advanceTimersByTime(SETTLED_STUCK_MS - 1));
      expect(host.textContent).toContain("Checking your result…");
      await act(async () => vi.advanceTimersByTime(1));
      expect(host.textContent).toContain("Still checking…");
      const before = refresh.mock.calls.length;
      await act(async () => button("Check again").click());
      expect(refresh).toHaveBeenCalledTimes(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("when the server can no longer read Didit, 'Checking your result…' turns into Still checking with Check again", async () => {
    const sources = stubStream();
    const refresh = vi.fn(async () => {});
    await render(<DiditCheck titleId="t" initial={{ phase: "checking", opId: "op" }} launch={async () => ({ ok: true, data: { state: "not_needed" } })} refresh={refresh} title="x" lead="" embed={vi.fn()} />);
    expect(sources.map((s) => s.url)).toEqual(["/api/me/verification/stream?wait=decision"]);
    await act(async () => sources[0]!.onmessage!({ data: JSON.stringify({ type: "verification.limited" }) }));
    expect(host.textContent).toContain("Still checking…");
    expect(host.textContent).toContain("This is taking longer than usual");
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => button("Check again").click());
    expect(refresh).toHaveBeenCalledTimes(1);
    // The stream stays open: a later push still settles it.
    expect(sources).toHaveLength(1);
  });
});
