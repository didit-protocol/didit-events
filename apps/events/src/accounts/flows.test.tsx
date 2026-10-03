
// These UI/action tests stub the data seam. Database behavior is covered by gates.test.ts.
vi.mock("../server/b4-policy", () => ({ guardAction: async () => {} }));
vi.mock("../../app/e/[slug]/register/data", () => ({
 registerGate: async () => ({ kind: "open" }),
 createRequest: async (_slug: string, input: { email: string }) => input.email === "maria.garcia@gmail.com" ? { kind: "already", requestedAt: "2026-09-29T12:00:00Z" } : { kind: "created", replyBy: "2026-10-02T18:00:00Z" },
 requestAsGuest: async () => ({ kind: "created" }), joinWaitlist: async () => {},
}));
vi.mock("../../app/me/events/[slug]/cancel/data", () => ({
 cancelRegistration: async (slug: string, reason: string) => slug === "barcelona-office-opening" ? "withdrawn" : reason === "Because" ? "bad_reason" : reason ? "cancelled" : "reason_required",
}));
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signInAction } from "../../app/login/actions";
import { profileAction, registerAction } from "../../app/e/[slug]/register/actions";
import { cancelAction } from "../../app/me/events/[slug]/cancel/actions";
import { deleteAccountAction } from "../../app/me/settings/delete/actions";
import { saveProfileAction } from "../../app/me/profile/edit/actions";
import { CancelSheet } from "./components/CancelSheet";
import { LoginFlow } from "./components/LoginFlow";
import { RegisterFlow } from "./components/RegisterFlow";
import { StatusScreen } from "./components/StatusScreen";
import { AI_ERA, MARIA, REGISTER_FILLED, STATUS } from "./fixtures";
import { safeNext } from "./links";
import type { GuestEventStatus, RegisterState, SignInStep } from "./types";
import { isEmail, splitName } from "./validate";

const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect, notFound: vi.fn() }));
beforeEach(async () => (await import("./testing-login")).resetAllCodeAttempts());
afterEach(() => redirect.mockClear());
// The actions gate on the event clock (AI Era registration closes 6 Oct): pin "now" to a day it is open.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-29T12:00:00+02:00"));
});
afterAll(() => vi.useRealTimers());

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  // Model v2 records explicit face preparation consent with email proof.
  f.set("onboardingConsent",JSON.stringify({disclosureVersion:"events-profile-v2",shareProfileWithHosts:true,eventConsentAccepted:false,acceptedChecks:["face"]}));
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const noop = async () => {};
const actions = { verify: noop, renew: noop, newLink: noop, joinWaitlist: noop, subscribe: noop };

describe("sign-in action (Didit email code)", () => {
  const choose: SignInStep = { step: "choose" };

  it("rejects an invalid email with the inline message (U-07 / DA-02)", async () => {
    const next = await signInAction(choose, form({ intent: "send", email: "maria.garcia@gmail" }));
    expect(next).toEqual({ step: "choose", email: "maria.garcia@gmail", error: "Enter a valid email address" });
  });

  it("sends a code and moves to code entry with the resend timer (U-08)", async () => {
    const next = await signInAction({ step: "email" }, form({ intent: "send", email: " Maria.Garcia@Gmail.com " }));
    expect(next).toMatchObject({ step: "code", email: "maria.garcia@gmail.com", status: "sent", attemptsLeft: 3, resendInSeconds: 30 });
  });

  it("counts wrong codes down, then locks the email (U-10 → U-09)", async () => {
    const code: SignInStep = { step: "code", email: "maria.garcia@gmail.com", status: "sent", attemptsLeft: 3, resendInSeconds: 30 };
    const wrong = await signInAction(code, form({ intent: "verify", email: "maria.garcia@gmail.com", code: "111111" }));
    expect(wrong).toMatchObject({ status: "wrong", attemptsLeft: 2 });
    const wrong2 = await signInAction(wrong, form({ intent: "verify", email: "maria.garcia@gmail.com", code: "111111" }));
    expect(wrong2).toMatchObject({ status: "wrong", attemptsLeft: 1 });
    expect(await signInAction(wrong2, form({ intent: "verify", email: "maria.garcia@gmail.com", code: "111111" }))).toMatchObject({ step: "locked", scope: "email" });
  });

  it("an expired code shows U-11; a send limit shows R-33", async () => {
    const code: SignInStep = { step: "code", email: "maria.garcia@gmail.com", status: "sent", attemptsLeft: 3, resendInSeconds: 30 };
    expect(await signInAction(code, form({ intent: "verify", code: "000000" }))).toMatchObject({ status: "expired" });
    expect(await signInAction(choose, form({ intent: "send", email: "locked@didit.me" }))).toMatchObject({ step: "locked", scope: "ip", minutes: 15 });
  });

  it("a passed code redirects to a same-origin `next` only", async () => {
    const code: SignInStep = { step: "code", email: "maria.garcia@gmail.com", status: "sent", attemptsLeft: 3, resendInSeconds: 30 };
    await expect(signInAction(code, form({ intent: "verify", code: "481903", next: "/e/ai-era/register" }))).rejects.toThrow("NEXT_REDIRECT;/e/ai-era?join=1");
    await expect(signInAction(code, form({ intent: "verify", code: "481903", next: "//evil.example" }))).rejects.toThrow("NEXT_REDIRECT;/onboarding?returnTo=%2Fme%2Fevents");
    expect(safeNext("https://evil.example")).toBe("/me/events");
    expect(safeNext("/\\evil")).toBe("/me/events");
  });
});

describe("register action (R-01…R-09)", () => {
  const start: RegisterState = { step: "form", values: {} };

  it("returns the three R-02 errors", async () => {
    const next = await registerAction(start, form({ intent: "details", slug: "ai-era", fullName: "", email: "maria.garcia@gmail", company: "Globex" }));
    expect(next.step).toBe("form");
    expect(next.step === "form" && next.errors).toEqual({ fullName: "Enter your name", email: "Enter a valid email address", consent: "Tick the box to continue" });
  });

  it("sends the code, then an expired code sends a new one (R-06)", async () => {
    const fields = { slug: "ai-era", fullName: "Ana Ruiz", email: "ana@example.com", company: "", role: "", consent: "on" };
    const code = await registerAction(start, form({ intent: "details", ...fields }));
    expect(code).toMatchObject({ step: "code", status: "sent" });
    expect(await registerAction(code, form({ intent: "verify", code: "000000", ...fields }))).toMatchObject({ step: "code", status: "expired", resendInSeconds: 59 });
  });

  it("a passed code sends both new and returning accounts to onboarding before requesting", async () => {
    const code: RegisterState = { step: "code", values: REGISTER_FILLED, status: "sent", attemptsLeft: 3, resendInSeconds: 30 };
    const ana = { slug: "ai-era", fullName: "Ana Ruiz", email: "ana@example.com", consent: "on" };
    // Email proof never submits an event request under model v2.
    await expect(registerAction(code, form({ intent: "verify", code: "481903", ...ana }))).rejects.toThrow("NEXT_REDIRECT;/e/ai-era?join=1");
    const maria = { slug: "ai-era", fullName: "María García", email: "maria.garcia@gmail.com", consent: "on" };
    await expect(registerAction(code, form({ intent: "verify", code: "481903", ...maria }))).rejects.toThrow("NEXT_REDIRECT;/e/ai-era?join=1");
  });

  it("profile: a Google-linked account can edit its required profile name", async () => {
    // Model v2 separates a self-declared profile name from email and face evidence.
    expect(await profileAction({values:{}},form({slug:"ai-era",fullName:"",consent:"on"}))).toMatchObject({errors:{fullName:"Enter your full name"}});
    await expect(profileAction({values:{}},form({slug:"ai-era",fullName:"New Name",consent:"on"}))).rejects.toThrow("NEXT_REDIRECT;/e/ai-era?join=1");
  });});

describe("cancellation, deletion and profile actions", () => {
  it("a place needs a reason; a withdrawal doesn't (U-26 / U-30)", async () => {
    expect(await cancelAction({}, form({ slug: "ai-era", mode: "cancel" }))).toEqual({ error: "Choose a reason so the hosts can plan.", note: "" });
    expect(await cancelAction({}, form({ slug: "ai-era", mode: "cancel", reason: "Because" }))).toMatchObject({ error: "Choose one of the reasons." });
    await expect(cancelAction({}, form({ slug: "ai-era", mode: "cancel", reason: "Feeling unwell" }))).rejects.toThrow("NEXT_REDIRECT;/me/events/ai-era?cancelled=Feeling%20unwell");
    await expect(cancelAction({}, form({ slug: "barcelona-office-opening", mode: "withdraw" }))).rejects.toThrow("NEXT_REDIRECT;/me/events/barcelona-office-opening?withdrawn=1");
  });

  it("deleting the account needs DELETE typed (U-22)", async () => {
    expect(await deleteAccountAction({}, form({ confirm: "DEL" }))).toEqual({ error: "Type DELETE to confirm." });
    await expect(deleteAccountAction({}, form({ confirm: "DELETE" }))).rejects.toThrow("NEXT_REDIRECT;/events?deleted=1");
  });

  it("profile links must be web addresses (U-34)", async () => {
    expect(await saveProfileAction({}, form({ website: "javascript:alert(1)" }))).toEqual({ error: "Check the links: use a full web address." });
    expect(await saveProfileAction({}, form({ linkedin: "linkedin.com/in/maria" }))).toMatchObject({ saved: true });
  });

  it("validation helpers", () => {
    expect(isEmail("maria.garcia@gmail.com")).toBe(true);
    expect(isEmail("maria.garcia@gmail")).toBe(false);
    expect(splitName("  María García López ")).toEqual({ firstName: "María", lastName: "García López" });
  });
});

describe("state switching renders the right screen", () => {
  const login = (initial: SignInStep, layout: "sheet" | "modal" = "sheet") =>
    renderToStaticMarkup(<LoginFlow layout={layout} initial={initial} action={signInAction} next="/me/events" googleHref="/api/auth/oidc/start?idp=google" />);

  it("sign-in close: the × never points at `next` (an admin sign-in cannot loop); without JS it opens the events home", () => {
    for (const layout of ["sheet", "modal"] as const) {
      const out = renderToStaticMarkup(<LoginFlow layout={layout} initial={{ step: "choose" }} action={signInAction} next="/admin/events" googleHref="/api/auth/oidc/start?idp=google" />);
      expect(out).toMatch(/<a href="\/events" class="[^"]*" aria-label="Close">/);
      expect(out).not.toMatch(/<a href="\/admin[^"]*"[^>]*aria-label="Close"/);
    }
  });

  it("sign-in: choose, email error, code wrong, locked, expired", () => {
    // One screen, like the join sheet: Google, the email field and "Email me a code", then the legal copy.
    const choose = login({ step: "choose" });
    expect(choose).not.toContain("Continue with email");
    expect(choose).toMatch(/Continue with Google<\/a><form[^>]*>.*Or use your email.*Email me a code<\/button><\/form><p class="disclosureNote"/);
    const invalid = login({ step: "email", email: "x@y", error: "Enter a valid email address" });
    expect(invalid).toContain("Enter a valid email address");
    expect(invalid).toMatch(/aria-invalid="true"/);
    const wrong = login({ step: "code", email: "maria.garcia@gmail.com", status: "wrong", attemptsLeft: 2, resendInSeconds: 0 });
    expect(wrong).toContain("That code is not right. 2 attempts left.");
    expect(wrong).toContain('role="alert"');
    expect(login({ step: "locked", email: "maria.garcia@gmail.com", retryAt: "2026-10-08T18:31:00+02:00", minutes: 15, scope: "email" })).toContain("Try again at 18:31");
    expect(login({ step: "code", email: "a@b.co", status: "expired", resendInSeconds: 0 }, "modal")).toContain("Codes last 5 minutes and work once.");
  });

  it("register: form → code → sent", () => {
    const r = (initial: RegisterState) => renderToStaticMarkup(<RegisterFlow event={AI_ERA} initial={initial} action={registerAction} />);
    expect(r({ step: "form", values: {} })).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Continue<\/button>/);
    expect(r({ step: "form", values: {}, errors: { fullName: "Enter your name" } })).toContain("Check the 1 highlighted item.");
    expect(r({ step: "code", values: REGISTER_FILLED, status: "sent", resendInSeconds: 42 })).toContain("Resend code in 0:42");
    expect(r({ step: "sent", firstName: "María", email: "maria.garcia@gmail.com", replyBy: "2026-10-02T18:00:00+02:00" })).toContain("You will hear back by Fri 2 Oct.");
  });

  it("status screens: face ticket, waitlist position, declined attempts", () => {
    const s = (status: GuestEventStatus | undefined) => renderToStaticMarkup(<StatusScreen event={AI_ERA} account={MARIA} status={status!} actions={actions} />);
    const going = s(STATUS.going);
    // Admission confirmation is independent of the already completed checks.
    expect(going).toContain("You&#x27;re in, María");
    // The ticket says what the face check proved; "ID verified" only when an ID document proved the name.
    expect(going).toContain(">Human verified by Didit · 1 Oct<");
    expect(going).toContain(">ID verified<");
    const faceOnly = renderToStaticMarkup(<StatusScreen event={AI_ERA} account={{ ...MARIA, verification: { ...MARIA.verification, nameFromId: false } as typeof MARIA.verification }} status={STATUS.going!} actions={actions} />);
    expect(faceOnly).toContain(">Human verified by Didit · 1 Oct<");
    expect(faceOnly).not.toContain("ID verified");
    expect(faceOnly).not.toContain(">Verified by Didit");
    expect(s(STATUS.waitlisted)).toContain("You are number 12 in line");
    // A host can waitlist a guest while places remain: the screen never claims the event is full.
    expect(s(STATUS.waitlisted)).not.toContain("event is full");
    expect(s(STATUS.waitlisted)).toContain('data-status-icon="pending"');
    expect(s(STATUS.declinedRetry)).toContain("1 attempt left");
    expect(s(STATUS.declinedFinal)).toContain("Email events@example.com");
  });

  it("cancel sheet: late banner, reasons as radios, Other reveals the note", () => {
    const late = renderToStaticMarkup(<CancelSheet event={AI_ERA} mode={{ mode: "cancel", hoursToStart: 5, late: true }} action={cancelAction} />);
    expect(late).toContain("The event starts in 5 hours.");
    expect(late.match(/type="radio"/g)).toHaveLength(6);
    expect(late).toMatch(/<button type="submit"[^>]*disabled=""/);
    const other = renderToStaticMarkup(<CancelSheet event={AI_ERA} mode={{ mode: "cancel", hoursToStart: 48, late: false }} action={cancelAction} initial={{ reason: "Other" }} />);
    expect(other).toContain("Tell the hosts (optional)");
  });
});

// These fixture tests isolate UI transitions and validation, not authentication.
// ../auth/wiring.test.ts exercises real login/registration/profile/deletion services
// and guards; every guest action here also has anonymous and revoked-session cases there.
vi.mock("../auth/actions", () => ({ guardAction: async () => {}, requireGuest: async () => ({ accountId: "fixture" }) }));
vi.mock("../../app/login/data", () => import("./testing-login"));
vi.mock("./session", () => ({ currentGuest: async () => MARIA }));
vi.mock("../../app/me/settings/delete/data", () => ({ deleteAccount: async () => "deleted" }));
vi.mock("../../app/me/profile/edit/data", () => ({ saveProfile: async () => "saved", changeVerifiedName: async () => "changed" }));

vi.mock("../auth/profile", () => ({ saveRegistrationProfile: async () => {} }));
