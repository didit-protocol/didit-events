// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingJoin } from "./components/join/OnboardingJoin";
import type { EmbeddedHandlers } from "./join/sdk";
import {
  blockedCopy,
  codePoints,
  facePurpose,
  missingSentence,
  normalizeUrl,
  pollDelayMs,
  profileFormValues,
  profilePatch,
  validateProfileForm,
  withSingleLink,
  type ProfileFormValues,
} from "./onboarding";
import { MARIA_PROFILE, ONBOARDING_VIEWS as V, fixtureOnboardingApi } from "./onboarding-fixtures";
import { profileSchema } from "@didit-events/core/domain/event-model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VALID: ProfileFormValues = { fullName: "María García", headline: "Head of Risk", company: "Globex", bio: "Fraud and identity.", linkedin: "linkedin.com/in/maria", website: "" };

describe("profile validation mirrors profileSchema", () => {
  it("accepts a complete profile, mononyms, and 'Independent' as company", () => {
    expect(validateProfileForm(VALID)).toEqual({});
    expect(validateProfileForm({ ...VALID, fullName: "Madonna", company: "Independent" })).toEqual({});
  });

  it("requires name, role, company and one of LinkedIn or website; the bio is optional (flow v3)", () => {
    const e = validateProfileForm({ fullName: " ", headline: "", company: "", bio: "  ", linkedin: "", website: "" });
    expect(Object.keys(e).sort()).toEqual(["company", "fullName", "headline", "links"]);
    expect(validateProfileForm({ ...VALID, linkedin: "", website: "https://maria.dev" })).toEqual({});
    expect(validateProfileForm({ ...VALID, bio: "" })).toEqual({});
  });

  it("one link input: a LinkedIn URL fills LinkedIn, anything else the website", () => {
    expect(withSingleLink(VALID, "linkedin.com/in/yourname")).toMatchObject({ linkedin: "linkedin.com/in/yourname", website: "" });
    expect(withSingleLink(VALID, "maria.dev")).toMatchObject({ linkedin: "", website: "maria.dev" });
    expect(Object.keys(validateProfileForm(withSingleLink(VALID, "maria.dev")))).toEqual([]);
  });

  it("counts Unicode code points like PostgreSQL (bio ≤ 160)", () => {
    expect(codePoints("😀😀")).toBe(2);
    expect(validateProfileForm({ ...VALID, bio: "😀".repeat(160) })).toEqual({});
    expect(validateProfileForm({ ...VALID, bio: "😀".repeat(161) }).bio).toMatch(/160/);
    expect(validateProfileForm({ ...VALID, headline: "x".repeat(81) }).headline).toMatch(/80/);
  });

  it("links: HTTPS only, no credentials, LinkedIn must be linkedin.com (not a suffix impersonator)", () => {
    expect(normalizeUrl("http://maria.dev")).toBe("https://maria.dev/");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("https://user:pw@maria.dev")).toBeNull();
    expect(validateProfileForm({ ...VALID, linkedin: "https://evil-linkedin.com/in/maria" }).linkedin).toBeDefined();
    expect(validateProfileForm({ ...VALID, linkedin: "https://es.linkedin.com/in/maria" })).toEqual({});
    expect(validateProfileForm({ ...VALID, linkedin: "linkedin.com/in/maria", website: "https://linkedin.com/in/maria" }).website).toBeDefined();
  });

  it("builds the contract patch with {kind,label,href} links and the expected profile version", () => {
    expect(profilePatch({ ...VALID, website: "maria.dev" }, 3)).toEqual({
      fullName: "María García",
      headline: "Head of Risk",
      company: "Globex",
      bio: "Fraud and identity.",
      links: [
        { kind: "linkedin", label: "LinkedIn", href: "https://linkedin.com/in/maria" },
        { kind: "website", label: "Website", href: "https://maria.dev/" },
      ],
      expectedProfileVersion: 3,
    });
  });

  it("resumes from the saved profile and names what is missing", () => {
    expect(profileFormValues(MARIA_PROFILE).linkedin).toBe("https://www.linkedin.com/in/mariagarcia/");
    expect(missingSentence(["headline", "bio", "links"])).toBe("your role, a short bio and your LinkedIn or a website");
  });
});

describe("client validation agrees with lane A's profileSchema", () => {
  const cases: [string, ProfileFormValues][] = [
    ["valid", VALID],
    ["mononym", { ...VALID, fullName: "Madonna" }],
    ["website only", { ...VALID, linkedin: "", website: "https://maria.dev" }],
    ["no links", { ...VALID, linkedin: "", website: "" }],
    ["blank bio", { ...VALID, bio: "   " }],
    ["bio 160 emoji", { ...VALID, bio: "😀".repeat(160) }],
    ["bio 161 emoji", { ...VALID, bio: "😀".repeat(161) }],
    ["headline 80", { ...VALID, headline: "x".repeat(80) }],
    ["headline 81", { ...VALID, headline: "x".repeat(81) }],
    ["company 121", { ...VALID, company: "x".repeat(121) }],
    ["name with tab", { ...VALID, fullName: "María\tGarcía" }],
    ["fake linkedin host", { ...VALID, linkedin: "https://notlinkedin.com/in/m" }],
    ["linkedin subdomain", { ...VALID, linkedin: "https://es.linkedin.com/in/m" }],
    ["same link twice", { ...VALID, linkedin: "https://linkedin.com/in/m", website: "https://linkedin.com/in/m" }],
  ];
  it.each(cases)("%s", (_, values) => {
    const clientOk = Object.keys(validateProfileForm(values)).length === 0;
    const { expectedProfileVersion: _v, ...patch } = profilePatch(values, 1);
    const serverOk = profileSchema.safeParse({ jobRole: "", ...patch }).success;
    expect(clientOk).toBe(serverOk);
  });
});

describe("face purpose, polling, blocked copy", () => {
  it("expired face asks for renewal, not a first enrolment", () => {
    expect(facePurpose(V.faceExpired)).toBe("face_renewal");
    expect(facePurpose(V.faceRequired)).toBe("onboarding");
  });
  it("polling backs off to every 15 s and honours a longer retryAfter", () => {
    expect([0, 1, 2, 3, 4, 9].map((n) => pollDelayMs(n))).toEqual([2000, 3000, 5000, 8000, 15000, 15000]);
    expect(pollDelayMs(0, 7000)).toBe(7000);
    expect(pollDelayMs(0, 600000)).toBe(60000);
  });
  it("blocked launches keep the profile and explain", () => {
    expect(blockedCopy("provider_unavailable").body).toMatch(/profile is saved/);
  });
});

// The fallback lazy-loads its steps: wait for them, as server streaming does.
const html = async (el: ReactElement) => { const stream = await renderToReadableStream(el); await stream.allReady; return (await new Response(stream).text()).replace(/&#x27;/g, "'").replace(/&amp;/g, "&"); };
const noEmbed = async (_url: string, _id: string, _h: EmbeddedHandlers) => () => {};

describe("/onboarding deep-link fallback (flow v3): the modal's content, never the old stepper", async () => {
  it("no Email / Profile / Face check / Done stepper, no consent checkbox", async () => {
    for (const view of [V.profileNew, V.faceRequired, V.complete]) {
      const out = await html(<OnboardingJoin initial={view} returnTo="/events" embed={noEmbed} />);
      expect(out).not.toMatch(/Account setup|STEP 2 OF 3|type="checkbox"/);
    }
  });
  it("profile asks only what is missing, with the example placeholders", async () => {
    const out = await html(<OnboardingJoin initial={V.profileResume} returnTo="/events" embed={noEmbed} />);
    expect(out).toContain('placeholder="e.g. Founder & CEO"');
    expect(out).toContain('placeholder="linkedin.com/in/yourname"');
    expect(out).not.toContain('name="fullName"'); // already saved
    expect(out).not.toContain('name="company"');
    expect(out).not.toContain("Short bio");
    const fresh = await html(<OnboardingJoin initial={V.profileNew} returnTo="/events" embed={noEmbed} />);
    expect(fresh).toContain('placeholder="e.g. Contoso, Adatum, Didit"');
  });
  it("face: verify you're human, started in place; declined and expired offer Try again", async () => {
    expect(await html(<OnboardingJoin initial={V.faceRequired} returnTo="/events" embed={noEmbed} />)).toContain("Preparing your check");
    expect(await html(<OnboardingJoin initial={V.faceDeclined} returnTo="/events" embed={noEmbed} />)).toMatch(/couldn't confirm it's you[\s\S]*Try again/);
    expect(await html(<OnboardingJoin initial={V.faceLinkExpired} returnTo="/events" embed={noEmbed} />)).toMatch(/This check expired[\s\S]*Start a new check/);
  });
  it("done returns to where the guest was going (same-origin only)", async () => {
    expect(await html(<OnboardingJoin initial={V.complete} returnTo="/e/ai-era" embed={noEmbed} />)).toContain('href="/e/ai-era"');
    expect(await html(<OnboardingJoin initial={V.complete} returnTo="https://evil.example" embed={noEmbed} />)).toContain('href="/events"');
  });
});

describe("/onboarding fallback interactions", () => {
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
  const render = (el: ReactElement) => act(async () => root.render(el));
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  const type = (name: string, value: string) =>
    act(() => {
      const el = host.querySelector(`[name="${name}"]`) as HTMLInputElement;
      setValue.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("profile saves only the missing fields plus the one link, then the face check starts in the modal (no navigation)", async () => {
    let patch: unknown;
    const api = fixtureOnboardingApi({ views: [V.faceRequired], save: (p) => ((patch = p), V.faceRequired) });
    const embed = vi.fn(noEmbed);
    await render(<OnboardingJoin initial={V.profileResume} returnTo="/events" api={api} embed={embed} />);
    await vi.waitFor(() => expect(host.querySelector('[name="headline"]')).not.toBeNull());
    type("headline", "Founder & CEO");
    type("link", "linkedin.com/in/yourname");
    await act(async () => (host.querySelector("form") as HTMLFormElement).requestSubmit());
    expect(patch).toMatchObject({ headline: "Founder & CEO", links: [{ kind: "linkedin", href: "https://linkedin.com/in/yourname" }], expectedProfileVersion: 2 });
    await vi.waitFor(() => expect(api.calls).toContain("startFace:onboarding"));
    await vi.waitFor(() => expect(embed).toHaveBeenCalledWith("https://verify.didit.me/session/fixture", expect.stringMatching(/^didit-/), expect.anything()));
    expect(host.querySelector("[data-didit-embedded]")).not.toBeNull();
  });
});
