// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestContext } from "@didit-events/core/contracts/event-model";
import { JoinFlow } from "./components/join/JoinFlow";
import { AI_ERA } from "./fixtures";
import type { JoinInitial } from "./join/machine";
import type { EmbeddedHandlers } from "./join/sdk";
import { MARIA_PROFILE, ONBOARDING_VIEWS as V, fixtureOnboardingApi } from "./onboarding-fixtures";
import { REQUEST_CONTEXTS as C, fixtureRequestApi } from "./request-fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const signIn = vi.fn(async () => ({ step: "choose" as const }));
const signedIn = (ctx: RequestContext): JoinInitial => ({ kind: "signed_in", ctx });
const WEBSITE = { kind: "website" as const, label: "Website", href: "https://maria.dev" };
const COMPLETE_PROFILE = { ...C.oneTap.onboarding, profile: { ...MARIA_PROFILE, links: [...MARIA_PROFILE.links, WEBSITE] }, photoUrl: "/api/me/photo?v=2" };

/**
 * The join modal is one functionality per screen. Each screen is classified by what it offers; a screen that offers
 * two (a form and the Didit panel, a result and a profile form) fails.
 */
function functionalities(host: HTMLElement) {
  const found = new Set<string>();
  if (host.querySelector('[name="email"], a[href*="/api/auth/oidc/start"]')) found.add("sign-in");
  if (host.querySelector('[name="fullName"], [name="link"], [name="company"]')) found.add("missing-profile");
  if (host.querySelector("[data-didit-embedded]")) found.add("didit");
  if ([...host.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Not now")) found.add("face-intro");
  if (host.querySelector('[name="checksConsent"]')) found.add("extras");
  if ([...host.querySelectorAll("button")].some((b) => /^(Request to join|Join waitlist|Sending…)$/.test(b.textContent?.trim() ?? ""))) found.add("request");
  if (host.querySelector('[data-status-icon="success"]') && /Request sent|You're in/.test(host.textContent ?? "")) found.add("result");
  if (host.querySelector("[data-profile-step]")) found.add("profile-step");
  return [...found];
}

describe("join modal: one step per screen", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    sessionStorage.clear();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
  const render = (el: ReactElement) => act(async () => root.render(el));
  const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  const click = async (label: string) => {
    const b = button(label);
    expect(b, label).toBeDefined();
    await act(async () => b!.click());
  };
  const title = () => host.querySelector("#request-title")?.textContent;
  const embedStub = () => {
    const state: { handlers?: EmbeddedHandlers } = {};
    const embed = vi.fn(async (_u: string, _i: string, h: EmbeddedHandlers) => ((state.handlers = h), () => {}));
    return { embed, state };
  };
  const flow = (initial: JoinInitial, opts: { contexts?: RequestContext[]; onClose?: () => void; embed?: ReturnType<typeof embedStub>["embed"]; autoSubmit?: boolean } = {}) =>
    render(
      <JoinFlow
        event={AI_ERA}
        initial={initial}
        signIn={signIn}
        onClose={opts.onClose ?? (() => {})}
        autoSubmit={opts.autoSubmit ?? true}
        requestProps={{ api: fixtureRequestApi({ contexts: opts.contexts ?? [C.oneTap] }), profileApi: fixtureOnboardingApi({ launch: { state: "ready", opId: "op-fixture", url: "https://verify.didit.me/session/face", expiresAt: "" } }), embed: opts.embed ?? embedStub().embed, navigate: vi.fn() }}
      />,
    );

  it("signed out: sign in, and nothing else", async () => {
    await flow({ kind: "signed_out", requestsOpen: true });
    expect(functionalities(host)).toEqual(["sign-in"]);
  });

  it("missing profile fields: only those fields on their own screen", async () => {
    await flow(signedIn(C.profile));
    expect(functionalities(host)).toEqual(["missing-profile"]);
    expect(host.textContent).not.toContain("Verify you're human");
  });

  it("face needed: 'Verify you're human' + Next, then the Didit panel alone, then 'Checking your result…', then the request", async () => {
    vi.stubGlobal("EventSource", class { onmessage = null; addEventListener() {} close() {} });
    const { embed, state } = embedStub();
    await flow(signedIn(C.face), { embed, contexts: [C.oneTap], autoSubmit: false });
    expect(title()).toBe("Verify you're human");
    expect(functionalities(host)).toEqual(["face-intro"]);
    expect(host.textContent).toMatch(/selfie[\s\S]*recognises you[\s\S]*hosts never see it/);
    expect(host.querySelector('[data-status-icon="info"]')).not.toBeNull();
    expect(embed).not.toHaveBeenCalled();

    await click("Next");
    await vi.waitFor(() => expect(embed).toHaveBeenCalledTimes(1));
    expect(functionalities(host)).toEqual(["didit"]);
    // The SDK screen: the title row and the Didit panel, nothing under it (no lead, no buttons, no caption).
    const pane = host.querySelector("[data-step]")!;
    expect(pane.querySelectorAll("button")).toHaveLength(0);
    expect(pane.querySelectorAll("p")).toHaveLength(0);
    expect(host.textContent).not.toContain("Secured by Didit");
    // Focus moved to the new screen's title.
    expect(document.activeElement?.id).toBe("request-title");

    await act(async () => state.handlers!.onComplete({ type: "completed", session: { sessionId: "s", status: "Approved" } }));
    expect(title()).toBe("Checking your result…");
    expect(functionalities(host)).toEqual([]);
  });

  it("face needed: Not now closes back to the event without starting a check", async () => {
    const onClose = vi.fn();
    const { embed } = embedStub();
    await flow(signedIn(C.face), { onClose, embed });
    await click("Not now");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(embed).not.toHaveBeenCalled();
  });

  it("an expired face gets its own intro; a face under review skips the intro", async () => {
    await flow(signedIn(C.faceExpired));
    expect(title()).toBe("Time to refresh your face check");
    expect(button("Next")).toBeDefined();
    act(() => root.unmount());
    root = createRoot(host);
    vi.stubGlobal("EventSource", class { onmessage = null; addEventListener() {} close() {} });
    await flow(signedIn({ ...C.face, onboarding: V.faceInReview }));
    expect(title()).toBe("Your check needs a quick review");
    expect(button("Next")).toBeUndefined();
  });

  it("already verified: no face screen, straight to the request (then the result on its own)", async () => {
    await flow(signedIn(C.oneTap), { autoSubmit: false });
    expect(host.textContent).not.toContain("Verify you're human");
    expect(functionalities(host)).toEqual(["request"]);
    await click("Request to join");
    await vi.waitFor(() => expect(title()).toBe("Request sent"));
    expect(functionalities(host)).toEqual(["result"]);
    expect(button("Complete your profile")).toBeDefined();
    expect(button("Back to event")).toBeDefined();
  });

  it("extras needed: the event's checks on their own screen", async () => {
    await flow(signedIn(C.extras));
    expect(functionalities(host)).toEqual(["extras"]);
  });

  it("profile complete: the result ends the flow (Back to event, no profile offer)", async () => {
    const ctx = { ...C.oneTap, onboarding: COMPLETE_PROFILE };
    await flow(signedIn(ctx), { contexts: [ctx] });
    await vi.waitFor(() => expect(title()).toBe("Request sent"));
    expect(host.querySelector('[data-status-icon="success"][data-animate]')).not.toBeNull();
    expect(button("Complete your profile")).toBeUndefined();
    expect(button("Back to event")).toBeDefined();
  });

  it("after the request: Complete your profile, one screen each, every screen one functionality", async () => {
    await flow(signedIn({ ...C.oneTap, onboarding: { ...C.oneTap.onboarding, photoUrl: null, profile: { ...MARIA_PROFILE, bio: "" } } }));
    await vi.waitFor(() => expect(title()).toBe("Request sent"));
    await click("Complete your profile");
    for (const expected of ["Add a photo", "Your headline and bio", "Your links"]) {
      await vi.waitFor(() => expect(title()).toBe(expected));
      expect(functionalities(host)).toEqual(["profile-step"]);
      await vi.waitFor(() => expect(document.activeElement?.textContent).toBe(expected));
      await click("Skip");
    }
    expect(title()).toBe("You can finish it later");
    expect(button("Back to event")).toBeDefined();
  });
});
