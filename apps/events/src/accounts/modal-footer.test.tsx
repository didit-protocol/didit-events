// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestContext } from "@didit-events/core/contracts/event-model";
import { DeleteAccountSheet, NameChangeSheet } from "./components/AccountSheets";
import { CancelSheet } from "./components/CancelSheet";
import { DeletingScreen } from "./components/DeletingScreen";
import { LoginFlow } from "./components/LoginFlow";
import { JoinResult } from "./components/RequestJoinContent";
import { MissingProfile } from "./components/RequestSteps";
import { SheetFooter } from "./components/Screen";
import { DiditCheck } from "./components/join/DiditCheck";
import { JoinAuth } from "./components/join/JoinAuth";
import { JoinFlow } from "./components/join/JoinFlow";
import { JoinShell } from "./components/join/JoinShell";
import { StepBody, StepPane } from "./components/join/Step";
import { AI_ERA } from "./fixtures";
import { DemoProfileSteps } from "./flow-fixtures";
import type { FacePhase, JoinInitial } from "./join/machine";
import { fixtureOnboardingApi } from "./onboarding-fixtures";
import { PENDING_REGISTRATION, REJOIN_CONTEXTS as R, REQUEST_CONTEXTS as C, fixtureRequestApi, registrationWith, rejoinFacts } from "./request-fixtures";
import type { SignInStep } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const css = (file: string) => readFileSync(resolve(import.meta.dirname, file), "utf8");
const signIn = vi.fn(async (s: SignInStep) => s);
const keep = vi.fn(async () => ({}));
const signedIn = (ctx: RequestContext): JoinInitial => ({ kind: "signed_in", ctx });
const text = (el: Element) => el.textContent?.replace(/\s+/g, " ").trim() ?? "";

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
});
const render = (el: ReactElement) => act(async () => root.render(el));

/** The screen's one footer: its actions top to bottom (the primary one is the last). */
const footer = () => {
  const all = host.querySelectorAll("[data-sheet-footer]");
  expect(all.length, "one footer per screen").toBe(1);
  return all[0] as HTMLElement;
};
const actions = (scope: Element) => [...scope.querySelectorAll("button, a")].map(text);
/**
 * The screen's actions are the footer's (in this order, the primary one last and nothing after it), no full-width
 * button is left in the content over it, and the footer closes the screen.
 */
function expectFooter(labels: string[]) {
  const foot = footer();
  expect(actions(foot)).toEqual(labels);
  const loose = [...host.querySelectorAll(".button.block")].filter((b) => !foot.contains(b)).map(text);
  expect(loose, "full-width buttons outside the footer").toEqual([]);
  expect(foot.parentElement!.lastElementChild).toBe(foot);
  const last = foot.lastElementChild!;
  // The last action is the primary one, unless the screen only offers a quiet way out.
  if (labels.length > 1) expect(last.querySelector(".secondary") ?? (last.matches(".secondary") ? last : null)).toBeNull();
  return foot;
}
const expectNoFooter = () => expect(host.querySelector("[data-sheet-footer]")).toBeNull();

const flow = (initial: JoinInitial, ctx?: RequestContext) => (
  <JoinFlow
    event={AI_ERA}
    initial={initial}
    signIn={signIn}
    keepAccount={keep}
    onClose={() => undefined}
    autoSubmit={false}
    requestProps={ctx ? { api: fixtureRequestApi({ contexts: [ctx] }), profileApi: fixtureOnboardingApi({ views: [ctx.onboarding] }), embed: async () => () => {} } : undefined}
  />
);
const inFlow = (ctx: RequestContext) => render(flow(signedIn(ctx), ctx));

describe("join modal: every step's actions are the footer on the bottom edge", () => {
  it("the footer sits in the shell's scrolling body, after the step's body", async () => {
    await render(
      <JoinShell eventName={AI_ERA.title} onClose={() => undefined}>
        {flow(signedIn(C.face), C.face)}
      </JoinShell>,
    );
    const foot = expectFooter(["Not now", "Next"]);
    expect(foot.closest('[role="dialog"]')?.hasAttribute("data-join-modal")).toBe(true);
    expect(foot.closest(".body")).not.toBeNull();
    const body = foot.previousElementSibling!;
    expect(body.hasAttribute("data-step-body")).toBe(true);
    expect(body.className).toContain("fillCenter");
    // The header (logo, event, close) is outside the scrolling body.
    expect(host.querySelector(".top")!.closest(".body")).toBeNull();
  });

  it("verify you're human: Next is the last thing, Not now over it; the title and the mark are in the body", async () => {
    await inFlow(C.face);
    const foot = expectFooter(["Not now", "Next"]);
    expect(foot.querySelector("#request-title, [data-secured-by-didit]")).toBeNull();
    expect(host.querySelector("[data-step-body] [data-secured-by-didit]")).not.toBeNull();
  });

  it("missing profile fields: the form is the screen, Continue stays in its footer (Cancel over Save name when fixing a name)", async () => {
    await inFlow(C.profile);
    const foot = expectFooter(["Continue"]);
    const form = foot.closest("form")!;
    expect(form.className.split(" ")).toEqual(expect.arrayContaining(["form", "fill"]));
    expect(foot.querySelector("button")!.getAttribute("type")).toBe("submit");
    // Every field is in the body.
    for (const field of form.querySelectorAll("input:not([type=hidden])")) expect(field.closest("[data-step-body]")).not.toBeNull();

    await render(<MissingProfile nameOnly onboarding={C.oneTap.onboarding} profileApi={fixtureOnboardingApi({ views: [C.oneTap.onboarding] })} titleId="t" onSaved={async () => undefined} onNotice={() => undefined} onCancel={() => undefined} />);
    expectFooter(["Cancel", "Save name"]);
  });

  it("event extras: Verify with Didit in the footer; nothing to do, no footer", async () => {
    await inFlow(C.extras);
    expectFooter(["Verify with Didit"]);
    await act(async () => root.unmount());
    root = createRoot(host);
    await inFlow(C.extrasBelowMinimum);
    expectNoFooter();
  });

  it("the request: one tap, questions and the waitlist all send from the footer", async () => {
    for (const [ctx, label] of [[C.oneTap, "Request to join"], [C.questions, "Request to join"], [C.waitlist, "Join waitlist"]] as const) {
      await inFlow(ctx);
      const foot = expectFooter([label]);
      expect(foot.closest("form")).not.toBeNull();
      expect(foot.querySelector("button")!.getAttribute("type")).toBe("submit");
      await act(async () => root.unmount());
      root = createRoot(host);
    }
  });

  it("request again (withdrawn, cancelled): the one tap is the footer; the rule and the consent stay in the body", async () => {
    for (const ctx of [R.withdrew, R.cancelled]) {
      await inFlow(ctx);
      const foot = footer();
      expect(actions(foot)).toHaveLength(1);
      expect(foot.querySelector('button[type="submit"]')).not.toBeNull();
      expect(foot.closest("form")!.hasAttribute("data-rejoin")).toBe(true);
      expect(host.querySelectorAll(".button.block")).toHaveLength(1);
      await act(async () => root.unmount());
      root = createRoot(host);
    }
  });

  it("request sent / you're in / waitlist: the result is centred in the body, its buttons are the footer", async () => {
    const result = (props: Partial<Parameters<typeof JoinResult>[0]>) => <JoinResult titleId="t" eventName={AI_ERA.title} registration={PENDING_REGISTRATION} onClose={() => undefined} fresh {...props} />;
    await render(result({ onCompleteProfile: () => undefined }));
    let foot = expectFooter(["Back to event", "Complete your profile"]);
    expect(foot.previousElementSibling!.querySelector('[role="status"]')!.textContent).toContain("Request sent");
    expect(foot.previousElementSibling!.className).toContain("fillCenter");

    await render(result({}));
    expectFooter(["View my registration", "Back to event"]);

    await render(result({ registration: registrationWith(rejoinFacts({ admission: "approved", cancelledFrom: null })) }));
    foot = expectFooter(["View my registration", "Back to event"]);
    expect(text(foot.previousElementSibling!)).toContain("You're in");

    await render(result({ registration: registrationWith(rejoinFacts({ admission: "waitlisted", cancelledFrom: null })) }));
    expectFooter(["View my registration", "Back to event"]);

    // No modal to close (the page fallback): the link is the action.
    await render(result({ onClose: undefined }));
    expectFooter(["View my registration"]);
  });

  it("a registration on file (pending, approved, waitlisted, cancelled by the host, checked in): its actions are the footer, leaving is the quiet link on top", async () => {
    for (const ctx of [{ ...C.oneTap, registration: PENDING_REGISTRATION, nextAction: "status" as const }, R.approved, R.waitlisted, R.hostCancelled, R.checkedIn, R.rejectedBlocked]) {
      await inFlow(ctx);
      const foot = footer();
      expect(foot.closest("[data-registration-status]")).not.toBeNull();
      const found = actions(foot);
      expect(found.length).toBeGreaterThan(0);
      expect([...host.querySelectorAll(".button.block, .quietAction")].every((b) => foot.contains(b))).toBe(true);
      // Withdraw / Cancel my place is never the last (primary) action.
      const quiet = foot.querySelector(".quietAction");
      if (quiet) expect(foot.firstElementChild).toBe(quiet);
      expect(foot.lastElementChild!.matches(".quietAction")).toBe(false);
      await act(async () => root.unmount());
      root = createRoot(host);
    }
  });

  it("complete your profile: Skip over Next while the form scrolls; Profile done ends on Back to event", async () => {
    const steps = (at: number | "done") => <DemoProfileSteps event={AI_ERA} registration={PENDING_REGISTRATION} onboarding={{ ...C.oneTap.onboarding, photoUrl: null }} at={at} />;
    await render(steps(1));
    let foot = expectFooter(["Skip", "Next"]);
    const form = foot.closest("form")!;
    expect(form.hasAttribute("data-profile-step")).toBe(true);
    expect(foot.querySelector('button[type="submit"]')!.textContent).toBe("Next");
    // The step bar (dots, Back) and the fields are the body.
    expect(form.querySelector("[data-step-body] [data-step-dots]")).not.toBeNull();

    await act(async () => root.unmount());
    root = createRoot(host);
    await render(steps("done"));
    foot = expectFooter(["Back to event"]);
    expect(text(foot.previousElementSibling!)).toMatch(/You can finish it later|Profile done/);
  });

  describe("verify human results, errors and retries", () => {
    const check = (initial: FacePhase, props: Partial<Parameters<typeof DiditCheck>[0]> = {}) => (
      <DiditCheck titleId="t" initial={initial} launch={async () => ({ ok: false as const, error: { code: "invalid" as const, message: "x" } })} refresh={async () => undefined} title="Verify you're human" lead="One selfie." embed={async () => () => {}} {...props} />
    );
    const cases: [string, FacePhase, string[], Partial<Parameters<typeof DiditCheck>[0]>?][] = [
      ["declined", { phase: "declined" }, ["Try again"]],
      ["expired", { phase: "expired" }, ["Start a new check"]],
      ["paused", { phase: "cancelled" }, ["Continue"]],
      ["camera blocked", { phase: "camera" }, ["Try again"]],
      ["Didit unavailable", { phase: "blocked", code: "provider_unavailable" }, ["Try again"]],
      ["not eligible, can retry", { phase: "not_eligible", check: "id_document", reason: "absent", retry: true }, ["Back to event", "Try again"], { onExit: () => undefined }],
      ["name mismatch", { phase: "not_eligible", check: "name_from_id", reason: "name_mismatch", retry: false }, ["Back to event", "Edit my name"], { onExit: () => undefined, onFixName: () => undefined }],
      ["below the minimum age", { phase: "not_eligible", check: "age", reason: "below_minimum", minimum: 18, retry: false }, ["Back to event"], { onExit: () => undefined }],
    ];
    for (const [name, phase, labels, props] of cases) {
      it(`${name}: ${labels.join(" over ")}`, async () => {
        await render(check(phase, props));
        const foot = expectFooter(labels);
        const body = foot.previousElementSibling!;
        expect(body.hasAttribute("data-step-body")).toBe(true);
        expect(body.className).toContain("fillCenter");
        // The icon, title, text and the Didit mark are over the footer, never under the button.
        expect(body.querySelector("[data-status-icon]")).not.toBeNull();
        expect(body.querySelector("h2")).not.toBeNull();
        expect(body.querySelector("[data-secured-by-didit]")).not.toBeNull();
      });
    }

    it("waiting, in review and verified have nothing to press: no footer, and the Didit panel is the body alone", async () => {
      for (const phase of [{ phase: "checking", opId: null }, { phase: "review" }, { phase: "done" }, { phase: "embedded", url: "https://verify.didit.me/s/1", opId: "op" }] as FacePhase[]) {
        await render(check(phase));
        expectNoFooter();
        expect(host.querySelector("[data-step-body]")).not.toBeNull();
        await act(async () => root.unmount());
        root = createRoot(host);
      }
    });
  });

  describe("the email code", () => {
    const auth = (initial: SignInStep) => <JoinAuth action={signIn} next="/e/ai-era?join=1" googleHref="/api/auth/oidc/start?idp=google" titleId="t" eventName={AI_ERA.title} initial={initial} />;
    const code = { step: "code" as const, email: "maria@globex.test", resendInSeconds: 30 };

    it("Continue is the footer's last button and submits the code form over it; Use a different email is the quiet action", async () => {
      await render(auth({ ...code, status: "sent" }));
      const foot = expectFooter(["Use a different email", "Continue"]);
      const submit = foot.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      const form = host.querySelector<HTMLFormElement>('[data-step-body] form:not([hidden])')!;
      expect(form.querySelector('[name="code"], input')).not.toBeNull();
      expect(form.contains(submit)).toBe(false);
      expect(submit.form).toBe(form);
      // The countdown is information: it stays with the code, in the body.
      expect(text(host.querySelector("[data-step-body]")!)).toContain("Resend code in");
    });

    it("an expired code sends a new one from the footer (the hidden resend form); a locked email ends on Continue with Google", async () => {
      await render(auth({ ...code, status: "expired" }));
      let foot = expectFooter(["Use a different email", "Send a new code"]);
      const submit = foot.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      expect(submit.form).toBe(host.querySelector("form[hidden]"));
      expect(submit.form!.querySelector<HTMLInputElement>('[name="intent"]')!.value).toBe("resend");

      await act(async () => root.unmount());
      root = createRoot(host);
      await render(auth({ step: "locked", email: code.email, retryAt: "2026-10-02T12:00:00Z", minutes: 15, scope: "email" }));
      foot = footer();
      expect(actions(foot)).toEqual(["Use a different email", "Continue with Google"]);
      expect(foot.lastElementChild!.getAttribute("href")).toContain("/api/auth/oidc/start");
    });
  });

  it("closed, unavailable and deletion states: the way out (and Keep my account) is the footer", async () => {
    await render(flow({ kind: "signed_out", requestsOpen: false }));
    expectFooter(["Back to event"]);

    await act(async () => root.unmount());
    root = createRoot(host);
    await render(flow({ kind: "unavailable" } as JoinInitial));
    expectFooter(["Back to event"]);

    await act(async () => root.unmount());
    root = createRoot(host);
    await render(flow({ kind: "deleting", graceUntil: "2026-10-20T12:00:00Z" } as JoinInitial));
    const foot = expectFooter(["Not now", "Keep my account"]);
    expect(foot.querySelector('button[type="submit"]')!.textContent).toBe("Keep my account");
    expect(foot.closest("form")).not.toBeNull();
    expect(text(foot.previousElementSibling!)).toContain("Your account is being deleted");
  });
});

describe("join modal motion: the footer stays put while the bodies cross-fade", () => {
  const pane = (step: string) => (
    <StepPane step={step} titleId="t" order={step === "result" ? 0 : 1}>
      <StepBody align="center">
        <h2 id="t">{step}</h2>
      </StepBody>
      <SheetFooter>
        <button type="button">{step === "result" ? "Complete your profile" : "Back to event"}</button>
      </SheetFooter>
    </StepPane>
  );

  it("only the body carries the entrance; the footer has no motion class and keeps its place in the pane", async () => {
    await render(pane("result"));
    const body = () => host.querySelector("[data-step-body]")!;
    expect(body().className.split(" ")).toContain("bodyIn");
    expect(body().className.split(" ")).not.toContain("bodyBack");
    expect(footer().className).toBe("sheetFoot");
    await render(pane("done"));
    expect(text(footer())).toBe("Back to event");
    expect(footer().className).toBe("sheetFoot");
    expect(body().className.split(" ")).toContain("bodyIn");
    // Going back, the body comes from the other side; the footer still does not move.
    await render(pane("result"));
    expect(body().className.split(" ")).toEqual(expect.arrayContaining(["bodyIn", "bodyBack"]));
    expect(footer().className).toBe("sheetFoot");

    const join = css("components/join/Join.module.css");
    // A pane split into body + footer does not animate as a whole.
    expect(join).toMatch(/\.stepIn:has\(\[data-step-body\]\) \{ animation: none; \}/);
    expect(join).toMatch(/\.bodyIn \{ animation: stepIn var\(--duration-base\) var\(--ease-emphasized\) backwards; \}/);
    expect(join).toMatch(/\.bodyBack \{ animation-name: stepBack; \}/);
    expect(join.slice(join.lastIndexOf("@media (prefers-reduced-motion: reduce)"))).toMatch(/\.bodyIn, \.bodyBack \{ animation: stepFade var\(--duration-base\) linear; \}/);
  });

  it("a nested pane (the Didit check, the profile screens) arrives with the screen around it, then animates its own changes", async () => {
    const nested = (outer: string, inner: string) => (
      <StepPane step={outer} titleId="t" order={outer === "face" ? 1 : 0}>
        <StepPane step={inner} titleId="t" enter="change">
          <StepBody>
            <h2 id="t">{inner}</h2>
          </StepBody>
          <SheetFooter>
            <button type="button">Try again</button>
          </SheetFooter>
        </StepPane>
      </StepPane>
    );
    await render(nested("face", "declined"));
    const panes = () => [...host.querySelectorAll("[data-step]")];
    // The inner pane has not changed: it does not carry its own entrance, its body plays the outer one.
    expect(panes()[1]!.className.split(" ")).not.toContain("stepIn");
    expect(host.querySelector("[data-step-body]")!.className.split(" ")).toContain("bodyIn");
    await render(nested("face", "expired"));
    expect(panes()[1]!.className.split(" ")).toContain("stepIn");
    expect(host.querySelector("[data-step-body]")!.className.split(" ")).toContain("bodyIn");
    expect(host.querySelectorAll("[data-sheet-footer]")).toHaveLength(1);
  });

  it("the picture of the screen that leaves keeps its footer's room but does not draw it (one footer on screen)", async () => {
    let finish!: () => void;
    const finished = new Promise<void>((r) => (finish = r));
    const proto = Element.prototype as { getAnimations?: () => unknown[] };
    proto.getAnimations = function (this: Element) {
      return this.hasAttribute("inert") ? [{ finished }] : [];
    };
    try {
      await render(pane("result"));
      await render(pane("done"));
      const ghost = host.querySelector("[data-step-ghosts]")!.firstElementChild as HTMLElement;
      expect(ghost).not.toBeNull();
      const old = ghost.querySelector<HTMLElement>("[data-sheet-footer]")!;
      expect(old.textContent).toBe("Complete your profile");
      expect(old.style.visibility).toBe("hidden");
      expect(ghost.querySelector<HTMLElement>("[data-step-body]")!.style.animation).toBe("none");
      const live = [...host.querySelectorAll<HTMLElement>("[data-sheet-footer]")].filter((f) => !ghost.contains(f));
      expect(live).toHaveLength(1);
      expect(live[0]!.style.visibility).toBe("");
      await act(async () => finish());
      expect(host.querySelectorAll("[data-sheet-footer]")).toHaveLength(1);
    } finally {
      delete proto.getAnimations;
    }
  });
});

describe("account sheets: both actions are one footer inside the form", () => {
  const noop = async <T,>(s: T) => s;

  it("cancel my place, withdraw, leave the waitlist and the plain confirmation", async () => {
    const cases = [
      [{ mode: "cancel", hoursToStart: 48, late: false }, ["Keep my place", "Cancel my place"]],
      [{ mode: "cancel", hoursToStart: 5, late: true }, ["Keep my place", "Cancel my place"]],
      [{ mode: "withdraw" }, ["Keep my request", "Withdraw request"]],
      [{ mode: "leave_waitlist" }, ["Stay on the waitlist", "Withdraw request"]],
      [{ mode: "confirm" }, ["Keep my place", "Cancel my place"]],
    ] as const;
    for (const [mode, labels] of cases) {
      await render(<CancelSheet event={AI_ERA} mode={mode as Parameters<typeof CancelSheet>[0]["mode"]} action={noop} />);
      const foot = expectFooter([...labels]);
      const form = foot.closest("form")!;
      expect(form.className.split(" ")).toEqual(expect.arrayContaining(["form", "fill"]));
      expect(form.closest("main")!.className.split(" ")).toContain("sheet");
      // The destructive submit is last; the way out over it is a link, not a second submit.
      expect(foot.lastElementChild!.matches('button[type="submit"].destructive')).toBe(true);
      expect(foot.firstElementChild!.matches("a.secondary")).toBe(true);
      // The reasons are over the footer.
      for (const radio of form.querySelectorAll('input[type="radio"]')) expect(foot.contains(radio)).toBe(false);
      await act(async () => root.unmount());
      root = createRoot(host);
    }
  });

  it("delete account and change a verified name", async () => {
    await render(<DeleteAccountSheet upcoming={1} open={0} action={noop} />);
    let foot = expectFooter(["Keep my account", "Delete account"]);
    expect(foot.lastElementChild!.matches('button[type="submit"].destructive')).toBe(true);
    expect(foot.closest("form")!.querySelector('[name="confirm"]')).not.toBeNull();
    expect(foot.querySelector("input")).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(host);
    await render(<NameChangeSheet action={noop} initialName="María García" />);
    foot = expectFooter(["Keep verified name", "Change and re-verify later"]);
    expect(foot.closest("form")!.querySelector('[name="fullName"]')).not.toBeNull();
  });

  it("/me/deleting: Keep my account is last, Not now over it", async () => {
    await render(<DeletingScreen graceUntil="2026-10-20T12:00:00Z" action={keep} next="/me/events" />);
    const foot = expectFooter(["Not now", "Keep my account"]);
    expect(foot.closest("form")!.querySelector<HTMLInputElement>('[name="next"]')!.value).toBe("/me/events");
  });

  it("login result screens (code expired, too many attempts): the actions close the screen, in the sheet and in the desktop card", async () => {
    const login = (layout: "sheet" | "modal", initial: SignInStep) => <LoginFlow layout={layout} initial={initial} action={signIn} next="/me/events" googleHref="/api/auth/oidc/start?idp=google" />;
    for (const layout of ["sheet", "modal"] as const) {
      await render(login(layout, { step: "code", email: "maria@globex.test", status: "expired", resendInSeconds: 0 }));
      let foot = expectFooter(["Continue with Google", "Send a new code"]);
      expect(foot.lastElementChild!.matches("form")).toBe(true);
      expect(foot.parentElement!.matches("main")).toBe(true);
      expect(foot.querySelector("[data-secured-by-didit], .disclosureNote")).toBeNull();
      expect(foot.parentElement!.querySelector("[data-secured-by-didit]")).not.toBeNull();

      await act(async () => root.unmount());
      root = createRoot(host);
      await render(login(layout, { step: "locked", email: "maria@globex.test", retryAt: "2026-10-02T12:00:00Z", minutes: 15, scope: "email" }));
      foot = footer();
      expect(actions(foot)).toEqual(["Continue with Google instead"]);
      expect(foot.parentElement!.lastElementChild).toBe(foot);
      await act(async () => root.unmount());
      root = createRoot(host);
    }
    await render(login("sheet", { step: "locked", email: "maria@globex.test", retryAt: "2026-10-02T12:00:00Z", minutes: 15, scope: "ip" }));
    expect(actions(footer())).toEqual(["Explore events"]);
  });
});

describe("the footer's styles: pinned, sticky while the content scrolls, safe-area padding on phones", () => {
  const screen = css("components/Screen.module.css");
  const join = css("components/join/Join.module.css");
  const layout = css("../public/components/GuestLayout.module.css");

  it("one footer rule: sticky where the frame says so, bleeding through the frame's padding, full-width buttons 8px apart", () => {
    const rule = /\.sheetFoot \{([^}]*)\}/.exec(screen)![1]!;
    expect(rule).toContain("position: var(--foot-position, static); bottom: 0;");
    expect(rule).toContain("display: flex; flex-direction: column; gap: 8px;");
    expect(rule).toContain("margin: auto calc(-1 * var(--foot-bleed-x, 0px)) calc(-1 * var(--foot-bleed-b, 0px));");
    expect(rule).toContain("padding: 12px var(--foot-bleed-x, 0px) var(--foot-pad-b, 0px);");
    expect(rule).toContain("background: var(--white);");
    // The column over it takes the height that is left, so the footer is on the bottom edge of a short screen too.
    expect(screen).toMatch(/\.fill \{ display: flex; flex-direction: column; gap: inherit; flex: 1 0 auto; min-width: 0; \}/);
    expect(screen).toMatch(/\.fillCenter \{ justify-content: center; \}/);
  });

  it("the top rule shows only while content scrolls under the footer", () => {
    expect(screen).toMatch(/@supports \(animation-timeline: scroll\(\)\) \{\s*\.sheetFoot \{ animation: sheetFootRule linear both; animation-timeline: scroll\(nearest block\); animation-range: calc\(100% - 12px\) 100%; \}\s*\}/);
    expect(screen).toMatch(/@keyframes sheetFootRule \{ from \{ box-shadow: inset 0 1px 0 var\(--border\); \} to \{ box-shadow: inset 0 1px 0 transparent; \} \}/);
    // While the modal's height follows a new step nothing scrolls: no rule.
    expect(join).toMatch(/\.body\[data-resizing\] \[data-sheet-footer\] \{ animation: none; \}/);
  });

  it("join modal: 24px sides and bottom on the card; on the phone sheet max(16px, the home indicator) under the button", () => {
    expect(join).toMatch(/\.dialog \{ --foot-position: sticky; --foot-bleed-x: 24px; --foot-bleed-b: 24px; --foot-pad-b: 24px; \}/);
    const phone = join.split("@media (max-width: 767px)")[1]!;
    expect(phone).toMatch(/\.dialog \{ --foot-bleed-b: calc\(24px \+ env\(safe-area-inset-bottom\)\); --foot-pad-b: max\(16px, env\(safe-area-inset-bottom\)\); \}/);
    // The bleed is exactly the body's padding (so the footer ends on the sheet's edge), and the sides stay 24px.
    expect(phone).toMatch(/\.inner \{[^}]*padding: 16px 24px calc\(24px \+ env\(safe-area-inset-bottom\)\); \}/);
    expect(join).toMatch(/\.inner \{[^}]*padding: 20px 24px 24px; \}/);
    // The steps fill the body's minimum height, so the footer is at the same place on every short step.
    expect(join).toMatch(/\.inner \{[^}]*min-height: min\(360px, calc\(100dvh - 140px\)\);/);
    expect(join).toMatch(/\.steps \{[^}]*flex: 1 0 auto;/);
    expect(join).toMatch(/\.step \{[^}]*flex: 1 0 auto;/);
    // Every CTA in the modal is 44px.
    expect(join).toMatch(/--cta-h: 44px;/);
  });

  it("account and login sheets: the same footer, 24px on phones with the safe area, 28px in the desktop modal", () => {
    const sheet = /\.sheet \{([^}]*)\}/.exec(screen)![1]!;
    expect(sheet).toContain("--foot-position: sticky; --foot-bleed-x: 24px; --foot-bleed-b: calc(24px + env(safe-area-inset-bottom, 0px)); --foot-pad-b: max(16px, env(safe-area-inset-bottom, 0px));");
    expect(sheet).toContain("padding: 0 24px calc(24px + env(safe-area-inset-bottom, 0px));");
    expect(sheet).toContain("--cta-h: 44px;");
    const modal = /\.modal\.modal \{([^}]*)\}/.exec(layout)![1]!;
    expect(modal).toContain("padding: 28px;");
    expect(modal).toContain("--foot-bleed-x: 28px; --foot-bleed-b: 28px; --foot-pad-b: 28px;");
    expect(modal).toContain("overflow-y: auto;");
  });
});
