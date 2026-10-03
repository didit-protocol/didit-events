// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissingProfile } from "./components/RequestSteps";
import { ProfileSteps } from "./components/join/ProfileSteps";
import { EditProfileForm } from "./components/EditProfileForm";
import { MARIA_PROFILE, ONBOARDING_VIEWS, fixtureOnboardingApi } from "./onboarding-fixtures";
import type { OnboardingView } from "./onboarding";
import { httpSuggestSocial, NO_SUGGESTIONS, SUGGEST_DEBOUNCE_MS, type SocialSuggestions, type SuggestSocial } from "./social-suggest";
import type { GuestAccount } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../admin/useAdminRouter", () => ({ useAdminRouter: () => ({ refresh: vi.fn() }) }));

const FOUND: SocialSuggestions = {
  linkedin: [
    { url: "https://www.linkedin.com/in/mariagarcia", label: "linkedin.com/in/mariagarcia" },
    { url: "https://www.linkedin.com/in/maria-garcia-2", label: "linkedin.com/in/maria-garcia-2" },
  ],
  x: [{ url: "https://x.com/mariag", label: "x.com/mariag" }],
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const render = (el: ReactElement) => act(() => root.render(el));
const input = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
const type = (name: string, v: string) =>
  act(() => {
    const el = input(name);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const row = () => host.querySelector<HTMLElement>("[data-social-chips]");
const chips = () => [...host.querySelectorAll<HTMLButtonElement>("[data-social-chips] button")];
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS); });

/** A fixture lookup: records each call and whether its signal was aborted. */
function fixture(result: SocialSuggestions = FOUND) {
  const calls: { name: string; company: string; signal: AbortSignal }[] = [];
  const suggest: SuggestSocial = vi.fn(async (q, signal) => (calls.push({ ...q, signal }), result));
  return { suggest, calls };
}
const missing = (view: OnboardingView, suggest: SuggestSocial) => (
  <MissingProfile onboarding={view} profileApi={fixtureOnboardingApi()} titleId="t" onSaved={async () => {}} onNotice={() => {}} suggestSocial={suggest} />
);

describe("join modal: the one-link step", () => {
  it("looks up once the name and company settle (600 ms, earlier lookups aborted), then a chip fills the link", async () => {
    const { suggest, calls } = fixture();
    await render(missing(ONBOARDING_VIEWS.profileNew, suggest));
    expect(row()).not.toBeNull();
    type("fullName", "María García");
    type("company", "Cab");
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    type("company", "Globex");
    expect(calls).toHaveLength(0);
    await settle();
    expect(calls.map((c) => [c.name, c.company])).toEqual([["María García", "Globex"]]);
    // Single link slot: LinkedIn only, never X.
    expect(chips().map((b) => b.textContent)).toEqual(["Is this you? linkedin.com/in/mariagarcia", "Is this you? linkedin.com/in/maria-garcia-2"]);
    expect(row()!.getAttribute("aria-live")).toBe("polite");
    await act(async () => chips()[0]!.click());
    expect(input("link").value).toBe("https://www.linkedin.com/in/mariagarcia");
    expect(document.activeElement).toBe(input("link"));
    expect(chips()).toHaveLength(0);
    expect(row()).not.toBeNull();
  });

  it("a newer name aborts the lookup in flight", async () => {
    let first: AbortSignal | undefined;
    const suggest: SuggestSocial = vi.fn((_q, signal) => {
      first ??= signal;
      return new Promise<SocialSuggestions>(() => {});
    });
    await render(missing(ONBOARDING_VIEWS.profileNew, suggest));
    type("fullName", "María García");
    type("company", "Globex");
    await settle();
    expect(suggest).toHaveBeenCalledTimes(1);
    type("fullName", "María García López");
    expect(first!.aborted).toBe(true);
  });

  it("never offers to replace a link the guest typed", async () => {
    const { suggest, calls } = fixture();
    await render(missing(ONBOARDING_VIEWS.profileResume, suggest));
    type("link", "maria.dev");
    await settle();
    expect(calls).toHaveLength(0);
    expect(chips()).toHaveLength(0);
  });

  it("no lookup without two name words and a company", async () => {
    const { suggest, calls } = fixture();
    await render(missing(ONBOARDING_VIEWS.profileNew, suggest));
    type("fullName", "María");
    type("company", "Globex");
    await settle();
    type("fullName", "María García");
    type("company", " ");
    await settle();
    expect(calls).toHaveLength(0);
  });

  it("empty result: nothing shows, and the row keeps its place (no layout jump)", async () => {
    const { suggest } = fixture(NO_SUGGESTIONS);
    await render(missing(ONBOARDING_VIEWS.profileResume, suggest));
    const before = row();
    expect(row()!.getAttribute("aria-busy")).toBe("true");
    await settle();
    expect(row()).toBe(before);
    expect(row()!.getAttribute("aria-busy")).toBeNull();
    expect(row()!.textContent).toBe("");
  });

  it("the disclosure says we may look up the public LinkedIn and X", async () => {
    await render(missing(ONBOARDING_VIEWS.profileResume, fixture().suggest));
    expect(host.textContent).toContain("Never your selfie. We may look up your public LinkedIn and X to suggest them.");
  });
});

describe("profile after a request: the links screen", () => {
  it("LinkedIn already saved: only the X chip, and it fills Website or X", async () => {
    const { suggest, calls } = fixture();
    const view: OnboardingView = { ...ONBOARDING_VIEWS.complete, photoUrl: "/api/me/photo?v=1" };
    await render(<ProfileSteps titleId="t" onboarding={view} profileApi={fixtureOnboardingApi()} backHref="/e/x" suggestSocial={suggest} />);
    expect(host.querySelector('[data-profile-step="links"]')).not.toBeNull();
    await settle();
    expect(calls.map((c) => [c.name, c.company])).toEqual([[MARIA_PROFILE.fullName, MARIA_PROFILE.company]]);
    expect(chips().map((b) => b.textContent)).toEqual(["Is this you? x.com/mariag"]);
    await act(async () => chips()[0]!.click());
    expect(input("website").value).toBe("https://x.com/mariag");
    expect(input("linkedin").value).toBe("https://www.linkedin.com/in/mariagarcia/");
    expect(host.textContent).toContain("We may look up your public LinkedIn and X to suggest them.");
  });

  it("no lookup on the other screens", async () => {
    const { suggest } = fixture();
    const view: OnboardingView = { ...ONBOARDING_VIEWS.complete, photoUrl: "/x", profile: { ...MARIA_PROFILE, bio: "", links: [] } };
    await render(<ProfileSteps titleId="t" onboarding={view} profileApi={fixtureOnboardingApi()} backHref="/e/x" suggestSocial={suggest} />);
    expect(host.querySelector('[data-profile-step="about"]')).not.toBeNull();
    await settle();
    expect(suggest).not.toHaveBeenCalled();
  });
});

describe("account profile editor", () => {
  it("both slots empty: LinkedIn and X chips fill their own fields", async () => {
    const { suggest } = fixture();
    const account = { firstName: "María", lastName: "García", company: "Globex", email: "maria@example.com", links: [], verification: { state: "none" } } as unknown as GuestAccount;
    await render(<EditProfileForm account={account} action={async () => ({})} suggestSocial={suggest} />);
    await settle();
    expect(chips().map((b) => b.dataset.network)).toEqual(["linkedin", "linkedin", "x"]);
    await act(async () => chips()[1]!.click());
    expect(input("linkedin").value).toBe("www.linkedin.com/in/maria-garcia-2");
    await act(async () => chips()[0]!.click());
    expect(input("website").value).toBe("https://x.com/mariag");
    expect(chips()).toHaveLength(0);
  });
});

describe("httpSuggestSocial", () => {
  const signal = new AbortController().signal;
  it("reads the suggestions from the route", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true, data: FOUND }));
    vi.stubGlobal("fetch", fetch);
    expect(await httpSuggestSocial({ name: "María García", company: "Globex" }, signal)).toEqual(FOUND);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe("/api/me/profile/suggestions?name=Mar%C3%ADa+Garc%C3%ADa&company=Globex");
  });
  it.each([
    ["204 (feature off)", () => new Response(null, { status: 204 })],
    ["401", () => Response.json({ ok: false, error: { code: "unauthenticated", message: "x" } }, { status: 401 })],
    ["500 HTML", () => new Response("<html>", { status: 500 })],
    ["offline", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["off-contract body", () => Response.json({ ok: true, data: { linkedin: [{ url: "javascript:alert(1)", label: "x" }], x: "nope" } })],
  ])("%s → no suggestions", async (_label, reply) => {
    vi.stubGlobal("fetch", vi.fn(reply));
    expect(await httpSuggestSocial({ name: "María García", company: "Globex" }, signal)).toEqual(NO_SUGGESTIONS);
  });
});
