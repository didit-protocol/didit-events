// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CancelSheet } from "./components/CancelSheet";
import { ResendTimer } from "./components/CodeParts";
import { RegisterFlow } from "./components/RegisterFlow";
import { AI_ERA } from "./fixtures";

vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn(), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  vi.useRealTimers();
});

const render = (el: ReactElement) => act(() => root.render(el));
const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
const type = (el: HTMLInputElement, value: string) =>
  act(() => {
    setValue.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const click = (el: Element) => act(() => (el as HTMLElement).click());
const submitButton = () => host.querySelector('button[type="submit"]') as HTMLButtonElement;
const field = (name: string) => host.querySelector(`input[name="${name}"]:not([type="hidden"])`) as HTMLInputElement;

describe("register details: consent gates Continue (R-01)", () => {
  it("Continue stays disabled until name, email and the consent box are all filled", () => {
    render(<RegisterFlow event={AI_ERA} initial={{ step: "form", values: {} }} action={async (s) => s} />);
    expect(submitButton().disabled).toBe(true);
    type(field("fullName"), "Ana Ruiz");
    type(field("email"), "ana@example.com");
    expect(submitButton().disabled).toBe(true);
    const consent = host.querySelector('input[type="checkbox"][name="consent"]') as HTMLInputElement;
    click(consent);
    expect(consent.checked).toBe(true);
    expect(submitButton().disabled).toBe(false);
    click(consent);
    expect(submitButton().disabled).toBe(true);
  });
});

describe("cancel sheet: reasons (U-26 / U-27)", () => {
  it("the button enables on a reason; picking 'Other' reveals the note, another reason hides it", () => {
    render(<CancelSheet event={AI_ERA} mode={{ mode: "cancel", hoursToStart: 48, late: false }} action={async (s) => s} />);
    expect(submitButton().disabled).toBe(true);
    expect(host.querySelector('textarea[name="note"]')).toBeNull();
    const radio = (r: string) => host.querySelector(`input[type="radio"][value="${r}"]`) as HTMLInputElement;
    click(radio("Other"));
    expect(radio("Other").checked).toBe(true);
    expect(submitButton().disabled).toBe(false);
    expect(host.querySelector('textarea[name="note"]')).not.toBeNull();
    click(radio("Feeling unwell"));
    expect(host.querySelector('textarea[name="note"]')).toBeNull();
  });
});

describe("ResendTimer (R-04 → R-05)", () => {
  it("counts down each second, then offers Resend code", () => {
    vi.useFakeTimers();
    const onResend = vi.fn();
    render(<ResendTimer seconds={3} onResend={onResend} />);
    expect(host.textContent).toBe("Resend code in 0:03");
    act(() => vi.advanceTimersByTime(1000));
    expect(host.textContent).toBe("Resend code in 0:02");
    act(() => vi.advanceTimersByTime(1000));
    expect(host.textContent).toBe("Resend code in 0:01");
    expect(host.querySelector("button")).toBeNull();
    act(() => vi.advanceTimersByTime(1000));
    const button = host.querySelector("button") as HTMLButtonElement;
    expect(button.textContent).toBe("Resend code");
    click(button);
    expect(onResend).toHaveBeenCalledOnce();
  });

  it("zero seconds shows the link straight away", () => {
    render(<ResendTimer seconds={0} onResend={() => {}} />);
    expect(host.querySelector("button")?.textContent).toBe("Resend code");
  });
});
