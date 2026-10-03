// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InAppInfo } from "../auth/inapp";
import { JoinAuth } from "./components/join/JoinAuth";
import { LoginFlow } from "./components/LoginFlow";
import type { SignInStep } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const signIn = vi.fn(async () => ({ step: "choose" as const }));
const GOOGLE = "/api/auth/oidc/start?idp=google&next=%2Fe%2Fai-era%3Fjoin%3D1";
const X_IOS: InAppInfo = { app: "X", os: "ios", path: "/e/ai-era?join=1", openHref: "x-safari-https://events.didit.me/e/ai-era?join=1" };
const LINKEDIN_ANDROID: InAppInfo = { app: "LinkedIn", os: "android", path: "/login?next=%2Fme%2Fevents", openHref: "intent://events.didit.me/login?next=%2Fme%2Fevents#Intent;scheme=https;package=com.android.chrome;end" };
const WEBVIEW: InAppInfo = { app: "other", os: "other", path: "/login", openHref: null };

const login = (initial: SignInStep, inApp?: InAppInfo | null, layout: "sheet" | "modal" = "sheet") =>
  renderToStaticMarkup(<LoginFlow layout={layout} initial={initial} action={signIn} next="/e/ai-era?join=1" googleHref={GOOGLE} inApp={inApp} />);
const join = (inApp?: InAppInfo | null, initial?: SignInStep) =>
  renderToStaticMarkup(<JoinAuth action={signIn} next="/e/ai-era?join=1" googleHref={GOOGLE} titleId="request-title" eventName="AI Era" inApp={inApp} initial={initial} />);
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

let root: Root | null = null;
let host: HTMLElement | null = null;
function mount(node: ReactElement) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = host = null;
  vi.unstubAllGlobals();
});
const byText = (el: Element, selector: string, label: string) => Array.from(el.querySelectorAll<HTMLElement>(selector)).find((n) => n.textContent?.trim() === label);
const click = (el: Element) => {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => void el.dispatchEvent(event));
  return event;
};

describe("a real browser keeps today's sign-in", () => {
  it("/login: Google first, then the email code, and no in-app note (with no flag and with a null flag)", () => {
    const plain = login({ step: "choose" });
    expect(login({ step: "choose" }, null)).toBe(plain);
    expect(plain).toMatch(/Continue with Google<\/a><form[^>]*>.*Or use your email.*Email me a code<\/button><\/form><p class="disclosureNote"/);
    for (const absent of ["Open in browser", "Copy link", "force=1", "Your email"]) expect(plain).not.toContain(absent);
    // A copied /login?error=inapp link opened in Safari is the plain sign-in.
    expect(login({ step: "choose", banner: "inapp" })).toBe(plain);
    expect(login({ step: "choose", banner: "inapp" }, null, "modal")).toBe(login({ step: "choose" }, null, "modal"));
  });

  it("the join sheet: Google first, then the email code, and no in-app note", () => {
    const plain = join();
    expect(join(null)).toBe(plain);
    expect(plain).toMatch(/Continue with Google<\/a><form[^>]*>.*Or use your email.*Email me a code<\/button><\/form>/);
    for (const absent of ["Open in browser", "Copy link", "force=1", "Your email"]) expect(plain).not.toContain(absent);
  });

  it("a failed or cancelled Google sign-in says what to do, in plain words", () => {
    const failed = "Google sign-in did not finish. If you opened this from an app (X, LinkedIn, Instagram), open it in Safari or Chrome, or use the email code.";
    const cancelled = "Google sign-in was cancelled. Try again or use the email code.";
    for (const layout of ["sheet", "modal"] as const) {
      expect(login({ step: "choose", banner: "google_failed" }, null, layout)).toContain(failed);
      expect(login({ step: "choose", banner: "google_cancelled" }, null, layout)).toContain(cancelled);
    }
    expect(join(null, { step: "choose", banner: "google_failed" })).toContain(failed);
    expect(join(null, { step: "choose", banner: "google_cancelled" })).toContain(cancelled);
    for (const copy of [failed, cancelled]) expect(copy).not.toMatch(/[—–]/);
  });
});

describe("inside an in-app browser", () => {
  it("/login: the email code is first, Continue with Google stays below it and the note is closed", () => {
    for (const layout of ["sheet", "modal"] as const) {
      const out = login({ step: "choose" }, X_IOS, layout);
      expect(out).toMatch(/Email me a code<\/button><\/form>.*Continue with Google<\/a>/);
      expect(out.indexOf("Email me a code")).toBeLessThan(out.indexOf("Continue with Google"));
      expect(out).not.toContain("Or use your email");
      expect(out).not.toContain("Open in browser");
      expect(out).not.toContain("force=1");
      // The email code is never blocked.
      expect(out).toMatch(/<button type="submit" class="[^"]*primary[^"]*"[^>]*>Email me a code<\/button>/);
      expect(out).not.toMatch(/<button type="submit"[^>]*disabled/);
    }
  });

  it("the join sheet: the email code is first, Continue with Google stays below it", () => {
    const out = join(X_IOS);
    expect(out).toMatch(/Your email.*Email me a code<\/button><\/form>.*Continue with Google<\/a>/);
    expect(out).not.toContain("Open in browser");
    // Same button sizes as in a real browser.
    const google = /<a class="([^"]*)"[^>]*href="\/api\/auth\/oidc\/start/.exec(out)![1]!.split(" ");
    expect(google).toEqual(expect.arrayContaining(["button", "outline", "lg", "block"]));
  });

  it("?error=inapp (sent back by the Google start) opens the note: open in Safari, copy link, try anyway with force=1", () => {
    const out = text(login({ step: "choose", banner: "inapp" }, X_IOS));
    expect(out).toContain("Google sign-in doesn't work inside the X browser. Use the email code, or open this page in Safari.");
    expect(out).toMatch(/<a class="[^"]*"[^>]*href="x-safari-https:\/\/events\.didit\.me\/e\/ai-era\?join=1"[^>]*>Open in browser<\/a>/);
    expect(out).toContain(">Copy link</button>");
    expect(out).toContain("If nothing opens, tap ••• and choose Open in Safari, or copy the link.");
    expect(out).toMatch(/href="\/api\/auth\/oidc\/start\?idp=google&next=[^"]*&consent=[^"]*&force=1"[^>]*>Try Google anyway<\/a>/);
    // The lead stays: this is guidance, not an error screen.
    expect(out).toContain("Create a free Didit Events account");
  });

  it("a failed Google sign-in shows the note instead of a second message", () => {
    const out = text(login({ step: "choose", banner: "google_failed" }, LINKEDIN_ANDROID));
    expect(out).toContain("Google sign-in doesn't work inside the LinkedIn browser. Use the email code, or open this page in Chrome.");
    expect(out).toContain('href="intent://events.didit.me/login?next=%2Fme%2Fevents#Intent;scheme=https;package=com.android.chrome;end"');
    expect(out).not.toContain("Google sign-in did not finish");
    const joined = text(join(LINKEDIN_ANDROID, { step: "choose", banner: "google_failed" }));
    expect(joined).toContain("Google sign-in doesn't work inside the LinkedIn browser.");
    expect(joined).not.toContain("Google sign-in did not finish");
  });

  it("an unnamed webview with no known origin: plain wording, Copy link only", () => {
    const out = text(login({ step: "choose", banner: "inapp" }, WEBVIEW));
    expect(out).toContain("Google sign-in doesn't work inside this in-app browser. Use the email code, or open this page in Safari or Chrome.");
    expect(out).not.toContain("Open in browser");
    expect(out).toContain(">Copy link</button>");
  });

  it("tapping Continue with Google shows the note in place instead of leaving; the email form stays", () => {
    const el = mount(<JoinAuth action={signIn} next="/e/ai-era?join=1" googleHref={GOOGLE} titleId="request-title" eventName="AI Era" inApp={X_IOS} />);
    expect(el.textContent).not.toContain("Open in browser");
    const google = byText(el, "a", "Continue with Google")!;
    expect(click(google).defaultPrevented).toBe(true);
    expect(el.querySelector('[role="status"]')?.textContent).toContain("Google sign-in doesn't work inside the X browser.");
    expect(byText(el, "a", "Open in browser")?.getAttribute("href")).toBe("x-safari-https://events.didit.me/e/ai-era?join=1");
    expect(byText(el, "a", "Try Google anyway")?.getAttribute("href")).toMatch(/^\/api\/auth\/oidc\/start\?.*&force=1$/);
    expect(byText(el, "button", "Email me a code")).toBeTruthy();
    expect(el.querySelector('input[name="email"]')).toBeTruthy();
  });

  it("Copy link copies this page's URL with its query (?join=1 / next)", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const el = mount(<LoginFlow layout="sheet" initial={{ step: "choose", banner: "inapp" }} action={signIn} next="/e/ai-era?join=1" googleHref={GOOGLE} inApp={X_IOS} />);
    await act(async () => void byText(el, "button", "Copy link")!.click());
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/e/ai-era?join=1`);
    expect(byText(el, "button", "Link copied")).toBeTruthy();
  });

  it("a webview that refuses the clipboard shows the link to copy by hand", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    const el = mount(<LoginFlow layout="sheet" initial={{ step: "choose", banner: "inapp" }} action={signIn} next="/me/events" googleHref={GOOGLE} inApp={LINKEDIN_ANDROID} />);
    await act(async () => void byText(el, "button", "Copy link")!.click());
    expect(el.querySelector<HTMLInputElement>("input[readonly]")?.value).toBe(`${window.location.origin}/login?next=%2Fme%2Fevents`);
  });

  it("phones: the link field is 16px and every target in the note is 44px", () => {
    const css = readFileSync(resolve(import.meta.dirname, "components/InAppGoogle.module.css"), "utf8");
    expect(css).toMatch(/\.url \{[^}]*min-height: 44px;[^}]*font: 400 16px/);
    expect(css.slice(css.indexOf("@media (max-width: 767px)"))).toMatch(/\.anyway \{ min-height: 44px; \}/);
    // Open in browser and Copy link are the shared 44px (lg) buttons.
    const out = login({ step: "choose", banner: "inapp" }, X_IOS);
    expect(/<a class="([^"]*)"[^>]*>Open in browser/.exec(out)![1]!.split(" ")).toEqual(expect.arrayContaining(["button", "lg", "block"]));
    expect(/<button type="button" class="([^"]*)"[^>]*>Copy link/.exec(out)![1]!.split(" ")).toEqual(expect.arrayContaining(["button", "lg", "block"]));
  });
});
