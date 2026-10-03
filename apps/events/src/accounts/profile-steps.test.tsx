// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { profileSchema } from "@didit-events/core/domain/event-model";
import { RequestJoin } from "./components/RequestJoin";
import { AI_ERA } from "./fixtures";
import { loginCloseTarget } from "./login-close";
import { boostPatch, profileBoostNeeded, profileSubSteps, type OnboardingView, type ProfilePatch } from "./onboarding";
import { MARIA_PROFILE, fixtureOnboardingApi } from "./onboarding-fixtures";
import { PENDING_REGISTRATION, REQUEST_CONTEXTS as C, fixtureRequestApi } from "./request-fixtures";
import type { RequestContext } from "./request-join";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SITE = "https://events.didit.me";
const WEBSITE = { kind: "website" as const, label: "Website", href: "https://maria.dev" };
const COMPLETE: RequestContext = {
  ...C.oneTap,
  onboarding: { ...C.oneTap.onboarding, profile: { ...MARIA_PROFILE, links: [...MARIA_PROFILE.links, WEBSITE] }, photoUrl: "/api/me/photo?v=2" },
};

describe("profile step after a request: when it shows and what it saves", () => {
  const view = (patch: Partial<OnboardingView["profile"]>, photoUrl: string | null = "/api/me/photo?v=1") => ({ profile: { ...MARIA_PROFILE, links: [...MARIA_PROFILE.links, WEBSITE], ...patch }, photoUrl });

  it("needed while headline, bio, LinkedIn, website or X, or the photo is missing", () => {
    expect(profileBoostNeeded(view({}))).toBe(false);
    expect(profileBoostNeeded(view({}, null))).toBe(true);
    expect(profileBoostNeeded(view({ headline: " " }))).toBe(true);
    expect(profileBoostNeeded(view({ bio: "" }))).toBe(true);
    expect(profileBoostNeeded(view({ links: [WEBSITE] }))).toBe(true);
    expect(profileBoostNeeded(view({ links: MARIA_PROFILE.links }))).toBe(true);
  });

  it("the PATCH touches headline, bio and the two link slots only, keeps other links, and satisfies profileSchema", () => {
    const other = { kind: "other" as const, label: "Blog", href: "https://blog.maria.dev" };
    // The form shows the first LinkedIn and the first other link; anything after them is kept as it is.
    const profile = { ...MARIA_PROFILE, links: [...MARIA_PROFILE.links, WEBSITE, other] };
    const patch = boostPatch({ headline: " Head of Risk ", bio: "Fraud.", linkedin: "linkedin.com/in/maria", website: "x.com/maria" }, profile, 4);
    expect(patch).toEqual({
      headline: "Head of Risk",
      bio: "Fraud.",
      links: [
        { kind: "linkedin", label: "LinkedIn", href: "https://linkedin.com/in/maria" },
        { kind: "website", label: "Website", href: "https://x.com/maria" },
        other,
      ],
      expectedProfileVersion: 4,
    });
    expect("fullName" in patch || "company" in patch).toBe(false);
    expect(() => profileSchema.parse({ ...MARIA_PROFILE, headline: patch.headline, bio: patch.bio, links: patch.links })).not.toThrow();
  });
});

describe("profile after a request: one screen per gap", () => {
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
  const render = (el: ReactElement) => act(() => root.render(el));
  const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
  const field = (name: string) => host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
  const setValue = (el: HTMLInputElement | HTMLTextAreaElement, v: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const title = () => host.querySelector("#request-title")?.textContent;
  const dots = () => host.querySelector("[data-step-dots]")?.getAttribute("data-step-dots");
  const click = async (label: string) => {
    const b = button(label);
    expect(b, label).toBeDefined();
    await act(async () => b!.click());
  };
  // Every gap: no photo, no bio, no website.
  const GAPS: RequestContext = { ...C.oneTap, onboarding: { ...C.oneTap.onboarding, photoUrl: null, profile: { ...MARIA_PROFILE, bio: "" } } };
  const open = async (ctx: RequestContext, profileApi = fixtureOnboardingApi()) => {
    const api = fixtureRequestApi({ contexts: [ctx] });
    await render(<RequestJoin event={AI_ERA} initial={ctx} api={api} profileApi={profileApi} navigate={vi.fn()} />);
    await click("Request to join");
    await vi.waitFor(() => expect(title()).toBe("Request sent"));
    return api;
  };

  it("the gaps decide the screens, in order: photo, headline + bio, links", () => {
    expect(profileSubSteps(GAPS.onboarding)).toEqual(["photo", "about", "links"]);
    expect(profileSubSteps(C.oneTap.onboarding)).toEqual(profileBoostNeeded(C.oneTap.onboarding) ? profileSubSteps(C.oneTap.onboarding) : []);
    expect(profileSubSteps(COMPLETE.onboarding)).toEqual([]);
    expect(profileSubSteps({ ...COMPLETE.onboarding, profile: { ...COMPLETE.onboarding.profile, headline: "" } })).toEqual(["about"]);
  });

  it("the result comes first and alone: the success check, one line, Complete your profile, no form", async () => {
    const api = await open(GAPS);
    expect(api.calls).toEqual(["submit"]);
    expect(host.querySelector('[data-status-icon="success"][data-animate]')).not.toBeNull();
    expect(host.querySelectorAll("input, textarea, form")).toHaveLength(0);
    expect(button("Complete your profile")).toBeDefined();
    expect([...host.querySelectorAll('a[href="/e/ai-era"]')].map((a) => a.textContent)).toContain("Back to event");
  });

  it("Next saves each screen on its own (same validation as /me/profile), Back returns, then Profile done", async () => {
    const save = vi.fn(({ expectedProfileVersion, ...patch }: ProfilePatch) => ({ ...GAPS.onboarding, profile: { ...GAPS.onboarding.profile, ...patch }, profileVersion: expectedProfileVersion + 1 }));
    const profileApi = fixtureOnboardingApi({ save });
    await open(GAPS, profileApi);
    await click("Complete your profile");
    await vi.waitFor(() => expect(title()).toBe("Add a photo"));
    expect(dots()).toBe("1/3");
    expect(button("‹ Back")).toBeUndefined();
    // One functionality per screen: the photo only.
    expect(field("headline")).toBeNull();
    expect(field("linkedin")).toBeNull();
    await click("Next");
    expect(save).not.toHaveBeenCalled();

    expect(title()).toBe("Your headline and bio");
    expect(dots()).toBe("2/3");
    expect(field("linkedin")).toBeNull();
    await setValue(field("headline")!, "");
    await click("Next");
    expect(host.textContent).toContain("Add your role");
    expect(save).not.toHaveBeenCalled();
    await setValue(field("headline")!, "Head of Risk");
    await setValue(field("bio")!, "Fraud and identity.");
    await click("Next");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toEqual({ headline: "Head of Risk", bio: "Fraud and identity.", expectedProfileVersion: GAPS.onboarding.profileVersion });

    expect(title()).toBe("Your links");
    expect(dots()).toBe("3/3");
    expect(field("headline")).toBeNull();
    // Back keeps what was typed.
    await click("‹ Back");
    expect(title()).toBe("Your headline and bio");
    expect(field("bio")!.value).toBe("Fraud and identity.");
    await click("Next");
    expect(save).toHaveBeenCalledTimes(1);

    await setValue(field("website")!, "ftp://nope");
    await click("Next");
    expect(host.textContent).toContain("Enter a website starting with https://");
    await setValue(field("website")!, "x.com/maria");
    await click("Next");
    expect(save).toHaveBeenCalledTimes(2);
    // The second save carries the version the first one returned, and only the links.
    expect(save.mock.calls[1]![0]).toEqual({ links: [{ kind: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/in/mariagarcia/" }, { kind: "website", label: "Website", href: "https://x.com/maria" }], expectedProfileVersion: GAPS.onboarding.profileVersion + 1 });

    expect(title()).toBe("Profile done");
    expect(host.querySelector('[data-status-icon="success"][data-animate]')).not.toBeNull();
    expect([...host.querySelectorAll('a[href="/e/ai-era"]')].map((a) => a.textContent)).toContain("Back to event");
  });

  it("Skip moves on without saving; skipping every screen ends without claiming a saved profile", async () => {
    const profileApi = fixtureOnboardingApi();
    await open(GAPS, profileApi);
    await click("Complete your profile");
    await vi.waitFor(() => expect(title()).toBe("Add a photo"));
    await click("Skip");
    expect(title()).toBe("Your headline and bio");
    await click("Skip");
    expect(title()).toBe("Your links");
    await click("Skip");
    expect(title()).toBe("You can finish it later");
    expect(profileApi.calls).toEqual([]);
  });

  it("a server field error shows inline on its screen", async () => {
    const profileApi = { ...fixtureOnboardingApi(), saveProfile: vi.fn(async () => ({ ok: false as const, error: { code: "invalid" as const, message: "Check the highlighted fields", fields: { bio: "Remove the special characters" } } })) };
    await open(GAPS, profileApi);
    await click("Complete your profile");
    await vi.waitFor(() => expect(title()).toBe("Add a photo"));
    await click("Skip");
    await setValue(field("bio")!, "Fraud.");
    await click("Next");
    expect(profileApi.saveProfile).toHaveBeenCalledTimes(1);
    expect(title()).toBe("Your headline and bio");
    expect(host.textContent).toContain("Remove the special characters");
  });

  it("focus moves to each new screen's title", async () => {
    await open(GAPS);
    await click("Complete your profile");
    await vi.waitFor(() => expect(document.activeElement?.id).toBe("request-title"));
    expect(document.activeElement?.textContent).toBe("Add a photo");
    await click("Skip");
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe("Your headline and bio"));
    await click("‹ Back");
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe("Add a photo"));
  });

  it("a complete profile: the result offers no profile; an existing registration never does", async () => {
    await open(COMPLETE);
    expect(button("Complete your profile")).toBeUndefined();
    expect(host.querySelector('a[href="/me/events/ai-era"]')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    await render(<RequestJoin event={AI_ERA} initial={{ ...GAPS, nextAction: "status", registration: PENDING_REGISTRATION }} api={fixtureRequestApi()} profileApi={fixtureOnboardingApi()} navigate={vi.fn()} />);
    expect(title()).toBe("Your request is in");
    expect(button("Complete your profile")).toBeUndefined();
  });
});

describe("/login close", () => {
  const env = (referrer: string, historyLength = 2) => ({ historyLength, referrer, origin: SITE });

  it("goes back to the previous page on this site", () => {
    expect(loginCloseTarget("/e/ai-era?join=1", env(`${SITE}/e/ai-era`))).toBe("back");
    expect(loginCloseTarget("/me/events", env(`${SITE}/events`))).toBe("back");
  });

  it("else the events home: no history, another site, or no referrer", () => {
    expect(loginCloseTarget("/e/ai-era", env(`${SITE}/e/ai-era`, 1))).toBe("/events");
    expect(loginCloseTarget("/e/ai-era", env("https://www.google.com/"))).toBe("/events");
    expect(loginCloseTarget("/e/ai-era", env(""))).toBe("/events");
  });

  it("an admin sign-in, or a referrer that would send the guest straight back here, never loops", () => {
    expect(loginCloseTarget("/admin", env(`${SITE}/events`))).toBe("/events");
    expect(loginCloseTarget("/admin/events?tab=past", env(`${SITE}/e/ai-era`))).toBe("/events");
    expect(loginCloseTarget("/e/ai-era", env(`${SITE}/admin/events`))).toBe("/events");
    expect(loginCloseTarget("/me", env(`${SITE}/me/profile`))).toBe("/events");
    expect(loginCloseTarget("/me", env(`${SITE}/login?next=%2Fme`))).toBe("/events");
  });
});
