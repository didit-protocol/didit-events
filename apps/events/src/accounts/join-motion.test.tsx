// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JoinAuth } from "./components/join/JoinAuth";
import { JoinLauncher } from "./components/join/JoinLauncher";
import { JoinShell } from "./components/join/JoinShell";
import { StepPane } from "./components/join/Step";
import { StepLoading } from "./components/join/StepLoading";
import { LoginFlow } from "./components/LoginFlow";
import { AI_ERA } from "./fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const css = readFileSync(resolve(import.meta.dirname, "components/join/Join.module.css"), "utf8");
const signIn = vi.fn(async () => ({ step: "choose" as const }));
const classOf = (el: Element | null) => (el?.getAttribute("class") ?? "").split(" ");

describe("v9 J1: the join modal is a bottom sheet below 768px", () => {
  it("slides up from the bottom edge on phones and tablets in portrait; desktop keeps the centred card", () => {
    const phone = css.slice(css.indexOf("@media (max-width: 767px)"));
    expect(css).not.toContain("@media (max-width: 640px)");
    expect(phone).toMatch(/\.scrim \{ place-items: end stretch; padding: 0; \}/);
    expect(phone).toMatch(/\.dialog, \.dialogWide \{ width: 100%;[^}]*border-radius: 24px 24px 0 0; animation: sheet var\(--duration-slow\) var\(--ease-emphasized\); \}/);
    expect(css).toMatch(/@keyframes sheet \{ from \{ transform: translateY\(100%\); \} \}/);
    expect(phone).toMatch(/\.scrim\[data-leaving\] \.dialog \{ animation: sheetOut /);
    // Desktop: centred, fades and scales.
    expect(css).toMatch(/\.scrim \{\s*position: fixed; inset: 0; z-index: 60; display: grid; place-items: center;/);
    expect(css).toMatch(/@keyframes rise \{ from \{ opacity: 0; transform: scale\(0\.96\); \} \}/);
  });

  it("reduced motion: the sheet, the card and the steps only fade, and the height does not animate", () => {
    const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.scrim, \.dialog, \.dialogWide \{ animation: fade /);
    expect(reduced).toMatch(/\.stepIn, \.stepBack \{ animation: stepFade /);
    expect(reduced).toMatch(/\.body, \.dots > span \{ transition: none; \}/);
    expect(css.lastIndexOf("@media (prefers-reduced-motion: reduce)")).toBeGreaterThan(css.indexOf("@media (max-width: 767px)"));
  });

  describe("from the page", () => {
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

    it("the tap shows the modal's frame at once (a sheet on phones, with the Didit loader); the modal then takes its place without a second entrance", async () => {
      const trigger = document.createElement("a");
      trigger.href = "/e/ai-era?join=1";
      document.body.appendChild(trigger);
      try {
        await render(<JoinLauncher event={AI_ERA} open={false} initial={null} signIn={signIn} />);
        expect(host.querySelector('[role="dialog"]')).toBeNull();
        await act(async () => trigger.click());
        const waiting = host.querySelector('[role="dialog"]')!;
        expect(waiting.getAttribute("aria-busy")).toBe("true");
        expect(waiting.getAttribute("aria-label")).toBe("Request to join");
        expect(waiting.querySelector('[data-mark-loader="brand"]')).not.toBeNull();
        // Its own two classes (they ship with the event page), not inline desktop-only styles.
        expect(waiting.getAttribute("style")).toBeNull();
        expect(waiting.parentElement!.getAttribute("style")).toBeNull();
        expect(classOf(waiting)).toContain("dialog");
        expect(classOf(waiting.parentElement)).toContain("scrim");

        await render(<JoinLauncher event={AI_ERA} open initial={{ kind: "signed_out", requestsOpen: true }} signIn={signIn} />);
        await vi.waitFor(() => expect(host.querySelector("#request-title")).not.toBeNull());
        const modal = host.querySelector("[data-join-modal]")!;
        expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
        expect(modal.parentElement!.hasAttribute("data-instant")).toBe(true);
        // Focus lands on the email field.
        await vi.waitFor(() => expect((document.activeElement as HTMLElement | null)?.getAttribute("name")).toBe("email"));
      } finally {
        trigger.remove();
      }
    });

    it("a direct ?join=1 link (no tap here) plays the modal's own entrance", async () => {
      await render(<JoinLauncher event={AI_ERA} open initial={{ kind: "signed_out", requestsOpen: true }} signIn={signIn} />);
      await vi.waitFor(() => expect(host.querySelector("[data-join-modal]")).not.toBeNull());
      expect(host.querySelector("[data-join-modal]")!.parentElement!.hasAttribute("data-instant")).toBe(false);
    });

    it("the placeholder is the modal's frame at every width: a bottom sheet below 768px, the same minimum height", () => {
      const file = readFileSync(resolve(import.meta.dirname, "components/join/JoinPlaceholder.module.css"), "utf8");
      const phone = file.slice(file.indexOf("@media (max-width: 767px)"));
      expect(phone).toMatch(/\.scrim \{ place-items: end stretch; padding: 0; \}/);
      expect(phone).toMatch(/\.dialog \{ width: 100%; height: calc\(48px \+ min\(320px, 100dvh - 120px\)\); border-radius: 24px 24px 0 0; animation: sheet /);
      expect(file).toMatch(/height: calc\(52px \+ min\(360px, 100dvh - 140px\)\);/);
      expect(file).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.scrim, \.dialog \{ animation: fade /);
      expect(css).toMatch(/\.scrim\[data-instant\]:not\(\[data-leaving\]\), \.scrim\[data-instant\]:not\(\[data-leaving\]\) \.dialog \{ animation: none; \}/);
    });

    it("× plays the leave animation, then tells the page", async () => {
      let finish!: () => void;
      const finished = new Promise<void>((r) => (finish = r));
      const proto = Element.prototype as { getAnimations?: () => unknown[] };
      proto.getAnimations = function (this: Element) {
        return this.hasAttribute("data-leaving") ? [{ finished }] : [];
      };
      const onClose = vi.fn();
      try {
        await render(
          <JoinShell eventName="AI Era" onClose={onClose}>
            <h2 id="request-title">Request to join</h2>
          </JoinShell>,
        );
        await act(async () => (host.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click());
        expect(host.querySelector("[data-leaving]")).not.toBeNull();
        expect(onClose).not.toHaveBeenCalled();
        await act(async () => finish());
        expect(onClose).toHaveBeenCalledTimes(1);
      } finally {
        delete proto.getAnimations;
      }
    });
  });
});

describe("v9 J2: the modal's height follows its content smoothly", () => {
  it("the body's height is a 240ms transition and short steps keep a minimum height per breakpoint", () => {
    expect(readFileSync(resolve(import.meta.dirname, "../../../../packages/ui/src/tokens.css"), "utf8")).toMatch(/--duration-resize: 240ms;/);
    expect(css).toMatch(/\.body \{[^}]*transition: height var\(--duration-resize\) var\(--ease-standard\); \}/);
    expect(css).toMatch(/\.inner \{[^}]*min-height: min\(360px, calc\(100dvh - 140px\)\);/);
    expect(css.slice(css.indexOf("@media (max-width: 767px)"))).toMatch(/\.inner \{ min-height: min\(320px, calc\(100dvh - 120px\)\);/);
  });

  describe("in the page", () => {
    let host: HTMLDivElement;
    let root: Root;
    let observed: { target: Element; run: () => void }[];
    beforeEach(() => {
      host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
      observed = [];
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(private cb: () => void) {}
          observe(target: Element) {
            observed.push({ target, run: this.cb });
          }
          disconnect() {}
        },
      );
    });
    afterEach(() => {
      act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    });

    it("JoinShell sets the measured content height on the body; only a change of size is marked as resizing", async () => {
      await act(async () =>
        root.render(
          <JoinShell eventName="AI Era" onClose={() => undefined}>
            <h2 id="request-title">Request to join</h2>
          </JoinShell>,
        ),
      );
      const [watch] = observed;
      const body = watch!.target.parentElement as HTMLElement;
      const size = (px: number) => Object.defineProperty(watch!.target, "offsetHeight", { configurable: true, value: px });
      size(520);
      watch!.run();
      expect(body.style.height).toBe("520px");
      // The first size replaces `auto`, which never animates: nothing to hide.
      expect(body.hasAttribute("data-resizing")).toBe(false);
      size(300);
      watch!.run();
      expect(body.style.height).toBe("300px");
      expect(body.hasAttribute("data-resizing")).toBe(true);
    });

    it("a step change slides forward, and back when the new screen comes earlier in the flow", async () => {
      const pane = (step: string, order: number) => (
        <StepPane step={step} titleId="t" order={order}>
          <h2 id="t">{step}</h2>
        </StepPane>
      );
      await act(async () => root.render(pane("profile", 0)));
      const current = () => host.querySelector("[data-step]")!;
      expect(classOf(current())).toContain("stepIn");
      expect(classOf(current())).not.toContain("stepBack");
      await act(async () => root.render(pane("face", 2)));
      expect(current().getAttribute("data-step")).toBe("face");
      expect(classOf(current())).not.toContain("stepBack");
      await act(async () => root.render(pane("profile", 0)));
      expect(classOf(current())).toContain("stepBack");
      // Focus follows the screen.
      expect(document.activeElement?.id).toBe("t");
      // Without Web Animations there is no picture of the old screen left behind.
      expect(host.querySelector("[data-step-ghosts]")!.childElementCount).toBe(0);
    });

    it("with Web Animations the old screen leaves as an inert picture (no ids, typed values kept) and is then removed", async () => {
      let finish!: () => void;
      const finished = new Promise<void>((r) => (finish = r));
      const proto = Element.prototype as { getAnimations?: () => unknown[] };
      proto.getAnimations = function (this: Element) {
        return this.hasAttribute("inert") ? [{ finished }] : [];
      };
      try {
        const pane = (step: string) => (
          <StepPane step={step} titleId="t" order={step === "profile" ? 0 : 1}>
            <h2 id="t">{step}</h2>
            {step === "profile" ? <input name="fullName" defaultValue="" /> : null}
          </StepPane>
        );
        await act(async () => root.render(pane("profile")));
        (host.querySelector('[name="fullName"]') as HTMLInputElement).value = "María García";
        await act(async () => root.render(pane("face")));
        const ghost = host.querySelector("[data-step-ghosts]")!.firstElementChild as HTMLElement;
        expect(ghost).not.toBeNull();
        expect(classOf(ghost)).toEqual(expect.arrayContaining(["step", "stepOut"]));
        expect(ghost.hasAttribute("inert")).toBe(true);
        expect(ghost.querySelector("[id]")).toBeNull();
        expect(ghost.querySelector("input")!.value).toBe("María García");
        expect(ghost.querySelector("input")!.hasAttribute("name")).toBe(false);
        // One live title only.
        expect(host.querySelectorAll("#t")).toHaveLength(1);
        await act(async () => finish());
        expect(host.querySelector("[data-step-ghosts]")!.childElementCount).toBe(0);
      } finally {
        delete proto.getAnimations;
      }
    });
  });
});

describe("v9 J3 / J4: Didit loaders and equal sign-in buttons", () => {
  const html = (el: ReactElement) => renderToStaticMarkup(el);

  it("a loading step holds its space and announces itself with the Didit mark", () => {
    const out = html(<StepLoading />);
    expect(out).toContain("stepLoading");
    expect(out).toContain('data-mark-loader="brand"');
    expect(out).toContain('role="status"');
    expect(css).toMatch(/\.stepLoading \{[^}]*min-height: 240px; \}/);
    // Waiting states put the loader in the 56px box a result's status icon takes.
    expect(css).toMatch(/\.stateMark \{[^}]*width: 56px; height: 56px; \}/);
  });

  it("the join modal: Continue with Google and Email me a code are the same Button size", () => {
    const out = html(<JoinAuth action={signIn} next="/e/ai-era?join=1" googleHref="/api/auth/oidc/start?idp=google" titleId="request-title" eventName="AI Era" />);
    const google = /<a class="([^"]*)"[^>]*href="\/api\/auth\/oidc\/start/.exec(out)![1]!.split(" ");
    const email = /<button type="submit" class="([^"]*)"/.exec(out)![1]!.split(" ");
    expect(google).toEqual(expect.arrayContaining(["button", "outline", "lg", "block"]));
    expect(email).toEqual(expect.arrayContaining(["button", "primary", "lg", "block"]));
  });

  it("/login is the join sheet's design: the same 44px (lg) buttons in the sheet and in the desktop modal, 24px sides", () => {
    for (const layout of ["sheet", "modal"] as const) {
      const out = html(<LoginFlow layout={layout} initial={{ step: "choose" }} action={signIn} next="/me/events" googleHref="/api/auth/oidc/start?idp=google" />);
      const email = /<button type="submit" class="([^"]*)"/.exec(out)![1]!.split(" ");
      expect(email).toEqual(expect.arrayContaining(["button", "primary", "lg", "block"]));
      const google = /<a class="([^"]*)"[^>]*href="\/api\/auth\/oidc\/start/.exec(out)![1]!.split(" ");
      expect(google).toEqual(expect.arrayContaining(["button", "outline", "lg", "block"]));
    }
    const screen = readFileSync(resolve(import.meta.dirname, "components/Screen.module.css"), "utf8");
    expect(screen).toMatch(/\.sheet \{\s*--cta-h: 44px; --cta-pad: 20px; --cta-font: 15px;[^}]*padding: 0 24px calc\(24px \+ env\(safe-area-inset-bottom, 0px\)\);/);
    const phone = readFileSync(resolve(import.meta.dirname, "components/join/Join.module.css"), "utf8").split("@media (max-width: 767px)")[1]!;
    expect(phone).toMatch(/\.top \{ padding: 16px 24px 0; \}/);
    expect(phone).toMatch(/\.inner \{[^}]*padding: 16px 24px calc\(24px \+ env\(safe-area-inset-bottom\)\); \}/);
    // "Signing you in" shows the Didit mark.
    expect(html(<LoginFlow layout="sheet" signingIn initial={{ step: "choose" }} action={signIn} next="/me/events" googleHref="/x" />)).toContain('data-mark-loader="brand"');
  });
});
