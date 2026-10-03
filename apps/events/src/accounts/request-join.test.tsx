// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateApplication } from "@didit-events/core/domain/event-model";
import { RequestJoin } from "./components/RequestJoin";
import { AI_ERA } from "./fixtures";
import { fixtureOnboardingApi } from "./onboarding-fixtures";
import { canAutoSubmit } from "./join/machine";
import { oneTap } from "./join/rejoin-copy";
import { buildApplication, normalizePhone, questionsToAsk, requestStep, validateAnswers } from "./request-join";
import { QUESTION_IDS as Q, REQUEST_CONTEXTS as C, fixtureRequestApi } from "./request-fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Wait for the real deferred steps, as server streaming does; keep every existing markup assertion.
const html = async (el: ReactElement) => { const stream=await renderToReadableStream(el);await stream.allReady;return (await new Response(stream).text()).replace(/&#x27;/g, "'").replace(/&amp;/g, "&"); };

describe("request to join: only what is missing", () => {
  it("maps nextAction to a step", () => {
    expect(requestStep(C.oneTap)).toBe("form");
    expect(requestStep(C.questions)).toBe("form");
    expect(requestStep(C.profile)).toBe("profile");
    expect(requestStep(C.face)).toBe("face");
    expect(requestStep(C.extras)).toBe("extras");
  });

  it("asks only unanswered questions", () => {
    const answered = { ...C.questions.prefill, answers: { [Q.why]: "To learn", [Q.diet]: false } };
    expect(questionsToAsk({ ...C.questions, missingQuestions: [Q.track], prefill: answered }).map((q) => q.id)).toEqual([Q.track]);
    // Required questions follow the server's list; an optional one is asked until it has an answer.
    expect(questionsToAsk({ ...C.questions, missingQuestions: [Q.track] }).map((q) => q.id)).toEqual([Q.track, Q.diet]);
  });

  it("an optional question with no answer is shown, so the request is not one tap; once answered it is", async () => {
    const optional = C.questions.event.form.questions.filter((q) => !q.required);
    const ctx = { ...C.oneTap, event: { ...C.oneTap.event, form: { ...C.oneTap.event.form, questions: optional } } };
    expect(ctx.missingQuestions).toEqual([]);
    expect(questionsToAsk(ctx).map((q) => q.id)).toEqual([Q.diet]);
    expect(oneTap(ctx)).toBe(false);
    expect(canAutoSubmit(ctx, true)).toBe(false);
    const out = await html(<RequestJoin event={AI_ERA} initial={ctx} />);
    expect(out).toContain(optional[0]!.label);
    expect(out).not.toContain("EVERYTHING IS READY");
    const done = { ...ctx, prefill: { ...ctx.prefill, answers: { [Q.diet]: true } } };
    expect(questionsToAsk(done)).toEqual([]);
    expect(oneTap(done)).toBe(true);
  });

  it("one tap: no email field, no code, no re-verification — just the submit label", async () => {
    const out = await html(<RequestJoin event={AI_ERA} initial={C.oneTap} />);
    expect(out).toContain("EVERYTHING IS READY");
    expect(out).toContain(">Request to join<");
    expect(out).not.toMatch(/type="email"|one-time-code|Verify your email|Sign in/);
    expect(out).toContain("Never your selfie");
  });

  it("missing profile fields only: the one link asked (no bio), name/role/company not", async () => {
    const out = await html(<RequestJoin event={AI_ERA} initial={C.profile} />);
    expect(out).toContain('name="link"');
    expect(out).toContain('placeholder="linkedin.com/in/yourname"');
    expect(out).not.toContain('name="bio"');
    expect(out).not.toContain('name="fullName"');
    expect(out).not.toContain('name="company"');
  });

  it("face first: verify you're human right here (no onboarding page, no consent checkbox), Next before the check", async () => {
    const out = await html(<RequestJoin event={AI_ERA} initial={C.face} />);
    expect(out).toContain("Verify you're human");
    expect(out).toContain("hosts never see it");
    // The footer: the quiet action over the primary one, which is the last thing on the screen.
    expect(out).toMatch(/data-sheet-footer=""><button[^>]*secondary[^>]*>Not now<\/button><button[^>]*primary[^>]*>Next<\/button><\/div>/);
    expect(out).not.toMatch(/Preparing your check|data-didit-embedded/);
    expect(out).not.toMatch(/\/onboarding|type="checkbox"/);
    expect(await html(<RequestJoin event={AI_ERA} initial={C.faceExpired} />)).toContain("Time to refresh your face check");
  });

  it("extras list what the event asks for, with consent and the Didit caption", async () => {
    const out = await html(<RequestJoin event={AI_ERA} initial={C.extras} />);
    expect(out).toContain("Phone number");
    expect(out).toContain("Age 18+");
    expect(out).toContain('name="checksConsent"');
    expect(out).toContain("Verify with Didit");
    expect(out).toContain("Secured by Didit");
  });

  it("below the minimum age: no launch button, an honest explanation", async () => {
    const out = await html(<RequestJoin event={AI_ERA} initial={C.extrasBelowMinimum} />);
    expect(out).not.toContain("Verify with Didit");
    expect(out).toContain("minimum age");
  });

  it("request screens are a desktop modal / mobile full screen with a close back to the event", async () => {
    const out = await html(<RequestJoin event={AI_ERA} initial={C.oneTap} />);
    expect(out).toMatch(/<main class="[^"]*modal[^"]*"/);
    expect(out).toContain('aria-label="Close"');
  });
});

describe("answers mirror validateApplication", () => {
  const form = C.questions.event.form;
  const phone = { mode: "required" as const, value: "+34 600 112 233", asked: true };

  it("valid answers pass here and in lane A's validator", () => {
    const answers = { [Q.why]: "Meet risk leads", [Q.track]: Q.risk, [Q.diet]: false };
    expect(validateAnswers(form.questions, answers, phone)).toEqual({});
    const app = buildApplication(C.questions, answers, phone.value);
    expect(app.fields.phone_number).toBe("+34600112233");
    expect(() => validateApplication(form, app)).not.toThrow();
  });

  it("required answers and phone are enforced; 'No' is a valid answer", () => {
    const e = validateAnswers(form.questions, {}, { ...phone, value: "" });
    expect(Object.keys(e).sort()).toEqual([Q.track, Q.why, "phone_number"].sort());
    expect(validateAnswers(form.questions, { [Q.why]: "x", [Q.track]: Q.risk, [Q.diet]: false }, phone)).toEqual({});
  });

  it("phone must be international E.164", () => {
    expect(normalizePhone("0034 600 112 233")).toBe("+34600112233");
    expect(normalizePhone("600112233")).toBeNull();
    expect(validateAnswers([], {}, { mode: "optional", value: "600", asked: true }).phone_number).toBeDefined();
  });

  it("an unknown option is refused", () => {
    expect(validateAnswers(form.questions, { [Q.why]: "x", [Q.track]: "not-an-option" }, phone)[Q.track]).toBeDefined();
  });
});

describe("RequestJoin interactions", () => {
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
  const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
  const setValue = (el: HTMLInputElement | HTMLTextAreaElement, v: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("one tap submits once with the pinned versions and an idempotency key, then shows the result in place", async () => {
    const api = fixtureRequestApi();
    const navigate = vi.fn();
    await render(<RequestJoin event={AI_ERA} initial={C.oneTap} api={api} profileApi={fixtureOnboardingApi()} navigate={navigate} />);
    await act(async () => button("Request to join").click());
    expect(api.calls).toEqual(["submit"]);
    const body = api.bodies[0] as { expectedPolicyVersion: number; expectedFormVersion: number; idempotencyKey: string; joinWaitlist: boolean; consent: { shareProfileWithHosts: boolean } };
    expect(body.expectedPolicyVersion).toBe(1);
    expect(body.expectedFormVersion).toBe(1);
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.joinWaitlist).toBe(false);
    expect(body.consent.shareProfileWithHosts).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Request sent");
    // The optional profile has gaps: "Complete your profile" leads, the event page is the way out.
    expect(button("Complete your profile")).toBeTruthy();
    expect([...host.querySelectorAll('a[href="/e/ai-era"]')].map((a) => a.textContent)).toContain("Back to event");
  });

  it("the waitlist label submits joinWaitlist", async () => {
    const api = fixtureRequestApi();
    await render(<RequestJoin event={AI_ERA} initial={C.waitlist} api={api} profileApi={fixtureOnboardingApi()} navigate={vi.fn()} />);
    await act(async () => button("Join waitlist").click());
    expect((api.bodies[0] as { joinWaitlist: boolean }).joinWaitlist).toBe(true);
  });

  it("questions block the tap until answered; the event consent is required when the event has one", async () => {
    const api = fixtureRequestApi();
    await render(<RequestJoin event={AI_ERA} initial={C.questions} api={api} profileApi={fixtureOnboardingApi()} navigate={vi.fn()} />);
    await act(async () => button("Request to join").click());
    expect(api.calls).toEqual([]);
    expect(host.textContent).toContain("Answer this question");
    expect(host.textContent).toContain("Tick the box to continue");
    await setValue(host.querySelector(`textarea[name="${Q.why}"]`) as HTMLTextAreaElement, "Meet risk leads");
    await act(async () => (host.querySelector(`input[value="${Q.risk}"]`) as HTMLInputElement).click());
    await setValue(host.querySelector('input[name="phone_number"]') as HTMLInputElement, "+34 600 112 233");
    await act(async () => (host.querySelector('input[name="eventConsent"]') as HTMLInputElement).click());
    await act(async () => button("Request to join").click());
    expect(api.calls).toEqual(["submit"]);
  });

  it("a stale form (context_changed) keeps the guest on the page with the fresh context", async () => {
    const api = fixtureRequestApi();
    api.submit = async () => ({ ok: false, error: { code: "context_changed", message: "changed", context: C.questions } });
    await render(<RequestJoin event={AI_ERA} initial={C.oneTap} api={api} profileApi={fixtureOnboardingApi()} navigate={vi.fn()} />);
    await act(async () => button("Request to join").click());
    expect(host.textContent).toContain("updated this event's questions");
    expect(host.textContent).toContain("What do you want to get out of the evening?");
  });

  const keyOf = (b: unknown) => (b as { idempotencyKey: string }).idempotencyKey;

  it("idempotency: a pure network retry of the same payload reuses the key", async () => {
    const api = fixtureRequestApi();
    const ok = api.submit;
    let n = 0;
    api.submit = async (body) => (n++ === 0 ? (api.bodies.push(body), { ok: false, error: { code: "provider_unavailable", message: "You seem to be offline." } }) : ok(body));
    await render(<RequestJoin event={AI_ERA} initial={C.oneTap} api={api} profileApi={fixtureOnboardingApi()} navigate={vi.fn()} />);
    await act(async () => button("Request to join").click());
    expect(host.textContent).toContain("offline");
    await act(async () => button("Request to join").click());
    expect(api.bodies).toHaveLength(2);
    expect(keyOf(api.bodies[1])).toBe(keyOf(api.bodies[0]));
  });

  it("idempotency: context_changed and capacity → the next submission is a new attempt with a new key", async () => {
    const api = fixtureRequestApi();
    const ok = api.submit;
    const script = [
      { code: "context_changed", context: { ...C.oneTap, event: { ...C.oneTap.event, formVersion: 2 } } },
      { code: "capacity", context: C.waitlist },
    ] as const;
    let n = 0;
    api.submit = async (body) => {
      const e = script[n++];
      if (!e) return ok(body);
      api.bodies.push(body);
      return { ok: false, error: { code: e.code, message: e.code, context: e.context } };
    };
    await render(<RequestJoin event={AI_ERA} initial={C.oneTap} api={api} profileApi={fixtureOnboardingApi()} navigate={vi.fn()} />);
    await act(async () => button("Request to join").click());
    await act(async () => button("Request to join").click());
    expect(host.textContent).toContain("Join the waitlist instead?");
    await act(async () => button("Join waitlist").click());
    const keys = api.bodies.map(keyOf);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
    expect((api.bodies[2] as { joinWaitlist: boolean }).joinWaitlist).toBe(true);
  });

  it("idempotency: field errors the guest then edits → a new key; resending the same refused payload unchanged also gets a new key", async () => {
    const api = fixtureRequestApi();
    let n = 0;
    api.submit = async (body) => {
      api.bodies.push(body);
      n++;
      return { ok: false, error: { code: "invalid", message: "Check your answers.", fields: { [Q.why]: "Too short" } } };
    };
    const initial = { ...C.questions, missingQuestions: [Q.why], event: { ...C.questions.event, form: { ...C.questions.event.form, fields: { phone_number: "off" as const }, consent_text: null } }, consent: { ...C.questions.consent, eventConsentText: null } };
    await render(<RequestJoin event={AI_ERA} initial={initial} api={api} profileApi={fixtureOnboardingApi()} navigate={vi.fn()} />);
    await setValue(host.querySelector(`textarea[name="${Q.why}"]`) as HTMLTextAreaElement, "Hi");
    await act(async () => button("Request to join").click());
    await setValue(host.querySelector(`textarea[name="${Q.why}"]`) as HTMLTextAreaElement, "Meet risk leads");
    await act(async () => button("Request to join").click());
    await act(async () => button("Request to join").click());
    expect(n).toBe(3);
    expect(new Set(api.bodies.map(keyOf)).size).toBe(3);
  });

  it("context_changed re-seeds the form: typed answers kept, fresh prefill fills the rest, removed questions dropped", async () => {
    const api = fixtureRequestApi();
    const ok = api.submit;
    const questions = C.questions.event.form.questions;
    const fresh = {
      ...C.questions,
      event: { ...C.questions.event, formVersion: 2, form: { ...C.questions.event.form, questions: questions.filter((q) => q.id !== Q.diet) } },
      missingQuestions: [Q.why, Q.track],
      prefill: { fields: {}, answers: { [Q.why]: "From my saved draft", [Q.track]: Q.product } },
    };
    let first = true;
    api.submit = async (body) => {
      if (!first) return ok(body);
      first = false;
      api.bodies.push(body);
      return { ok: false, error: { code: "context_changed", message: "changed", context: fresh } };
    };
    await render(<RequestJoin event={AI_ERA} initial={C.questions} api={api} profileApi={fixtureOnboardingApi()} navigate={vi.fn()} />);
    await act(async () => (host.querySelector(`input[value="${Q.risk}"]`) as HTMLInputElement).click());
    await act(async () => (host.querySelector(`input[name="${Q.diet}"][value="yes"]`) as HTMLInputElement).click());
    await setValue(host.querySelector('input[name="phone_number"]') as HTMLInputElement, "+34 600 112 233");
    await act(async () => (host.querySelector('input[name="eventConsent"]') as HTMLInputElement).click());
    await setValue(host.querySelector(`textarea[name="${Q.why}"]`) as HTMLTextAreaElement, "Typed by me");
    await act(async () => button("Request to join").click());
    expect(host.textContent).toContain("updated this event's questions");
    // Kept: the typed answers. Dropped: the removed diet question.
    expect((host.querySelector(`textarea[name="${Q.why}"]`) as HTMLTextAreaElement).value).toBe("Typed by me");
    expect((host.querySelector(`input[value="${Q.risk}"]`) as HTMLInputElement).checked).toBe(true);
    expect(host.querySelector(`input[name="${Q.diet}"]`)).toBeNull();
    await act(async () => button("Request to join").click());
    const sent = api.bodies[1] as { application: { answers: Record<string, unknown> } };
    expect(sent.application.answers).toEqual({ [Q.why]: "Typed by me", [Q.track]: Q.risk });
  });

  it("context_changed: questions the guest did not touch take the fresh prefill", async () => {
    const api = fixtureRequestApi();
    const fresh = { ...C.questions, event: { ...C.questions.event, formVersion: 2 }, missingQuestions: [Q.why, Q.track, Q.diet], prefill: { fields: {}, answers: { [Q.track]: Q.product, [Q.diet]: false } } };
    api.submit = async () => ({ ok: false, error: { code: "context_changed", message: "changed", context: fresh } });
    await render(<RequestJoin event={AI_ERA} initial={C.questions} api={api} profileApi={fixtureOnboardingApi()} navigate={vi.fn()} />);
    await act(async () => (host.querySelector(`input[value="${Q.risk}"]`) as HTMLInputElement).click());
    await setValue(host.querySelector(`textarea[name="${Q.why}"]`) as HTMLTextAreaElement, "Typed by me");
    await setValue(host.querySelector('input[name="phone_number"]') as HTMLInputElement, "+34 600 112 233");
    await act(async () => (host.querySelector('input[name="eventConsent"]') as HTMLInputElement).click());
    await act(async () => button("Request to join").click());
    expect((host.querySelector(`input[value="${Q.risk}"]`) as HTMLInputElement).checked).toBe(true); // typed wins
    expect((host.querySelector(`input[name="${Q.diet}"][value="no"]`) as HTMLInputElement).checked).toBe(true); // fresh prefill
    expect((host.querySelector(`textarea[name="${Q.why}"]`) as HTMLTextAreaElement).value).toBe("Typed by me");
  });

  it("extras: consent first, then a draft is saved and Didit opens with the pinned policy", async () => {
    const api = fixtureRequestApi({ contexts: [C.extras] });
    const navigate = vi.fn();
    const embed = vi.fn(async () => () => {});
    await render(<RequestJoin event={AI_ERA} initial={C.extras} api={api} profileApi={fixtureOnboardingApi()} navigate={navigate} embed={embed} />);
    await act(async () => button("Verify with Didit").click());
    expect(api.calls).toEqual([]);
    await act(async () => (host.querySelector('input[name="checksConsent"]') as HTMLInputElement).click());
    await act(async () => button("Verify with Didit").click());
    expect(api.calls).toEqual(["saveDraft", "startChecks"]);
    expect((api.bodies[1] as { expectedPolicyVersion: number; consent: { acceptedChecks: string[] } }).consent.acceptedChecks).toEqual(["face", "phone", "age"]);
    // Flow v3: Didit runs embedded in the modal, never a full-page redirect.
    expect(navigate).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(embed).toHaveBeenCalledWith("https://verify.didit.me/session/extras", expect.stringMatching(/^didit-/), expect.anything()));
  });
});
