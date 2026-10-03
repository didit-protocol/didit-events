// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventEmails } from "../model/contract";
import { EmailEditor, parseSender } from "./EmailEditor";
import { setOverride, stubEmailTemplates, type EmailTransport, type SamplePreview } from "./emails";
import { samplePreview } from "./email-samples";

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

const flush = async (ms = 10) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
const type = (input: HTMLInputElement, value: string) => act(() => { setValue.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;
const row = (code: string) => [...host.querySelectorAll("li")].find((li) => li.querySelector("span")?.textContent === code)!;

const PREVIEW = { subject: "You're in: AI Era", html: "<html><body>Hi María</body></html>", text: "Hi", from: "Didit Events <events@updates.didit.me>", replyTo: "events@example.com", rendererVersion: "r1" };

function transport(over: Partial<EmailTransport> = {}): EmailTransport & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    preview: vi.fn(async (_id, input) => { calls.push(["preview", input]); return { ok: true as const, data: PREVIEW }; }),
    sendTest: vi.fn(async (_id, input) => { calls.push(["test", input]); return { ok: true as const, data: { testId: "t1", status: "queued" as const, errorCode: null } }; }),
    testStatus: vi.fn(async () => ({ ok: true as const, data: { testId: "t1", status: "delivered" as const, errorCode: null } })),
    ...over,
  };
}

let latest: EventEmails;
function Harness({ t, newEvent = false, sample }: { t: EmailTransport; newEvent?: boolean; sample?: SamplePreview }) {
  const [v, setV] = useState<EventEmails>({ version: 1, templates: {} });
  const change = (next: EventEmails) => {
    latest = next;
    setV(next);
  };
  return <EmailEditor value={v} onChange={change} eventId={newEvent ? undefined : "ev1"} editVersion={4} transport={t} errors={{}} debounceMs={0} samplePreview={sample} />;
}

describe("Emails section", () => {
  it("lists every lifecycle email with its trigger, sender and reply-to; critical notices are locked on with the reason", () => {
    act(() => root.render(<Harness t={transport()} />));
    expect(host.querySelectorAll("li")).toHaveLength(19);
    expect(host.textContent).toContain("Didit Events <events@updates.didit.me>");
    expect(host.textContent).toContain("events@example.com");
    for (const code of ["M-03", "M-06", "M-16", "M-20", "M-21"]) {
      const toggle = row(code).querySelector<HTMLInputElement>('input[role="switch"]')!;
      expect(toggle.disabled).toBe(true);
      expect(toggle.checked).toBe(true);
      expect(row(code).textContent).toContain("Always sent");
    }
    expect(row("M-06").textContent).toContain("You're in");
    expect(row("M-13").textContent).toContain("it is not the admission email");
    act(() => row("M-13").querySelector<HTMLInputElement>('input[role="switch"]')!.click());
    expect(latest.templates["M-13"]).toEqual({ enabled: false });
  });

  it("opens a real preview (600 / 390) from the server with the unsaved override, then sends a test to any address", async () => {
    const t = transport();
    act(() => root.render(<Harness t={t} />));
    act(() => row("M-06").querySelector<HTMLButtonElement>("button")!.click());
    await flush();
    expect(t.preview).toHaveBeenCalledWith("ev1", { template: "M-06", preview: { kind: "sample" }, override: undefined, expectedEventVersion: 4 });
    expect(host.querySelector("iframe")).not.toBeNull();
    expect(host.textContent).toContain("You're in: AI Era");
    expect(host.textContent).toContain("Reply-to: events@example.com");
    const mobile = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => r.value === "mobile")!;
    act(() => mobile.click());
    expect(host.querySelector('[data-screen-label], .mobile, [class*="mobile"]')).not.toBeNull();

    const subject = [...host.querySelectorAll("label")].find((l) => l.textContent?.startsWith("Subject"))!;
    type(host.querySelector<HTMLInputElement>(`#${CSS.escape(subject.htmlFor)}`)!, "Welcome {{first_name}}");
    expect(latest.templates["M-06"]).toEqual({ enabled: true, subject: "Welcome {{first_name}}" });
    await flush();
    expect((t.preview as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]).toMatchObject({ override: { enabled: true, subject: "Welcome {{first_name}}" } });

    const to = host.querySelector<HTMLInputElement>('input[type="email"]')!;
    act(() => button("Send test").click());
    expect(host.textContent).toContain("Enter an email address");
    type(to, "someone@othercompany.test");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => { button("Send test").click(); });
    expect(t.sendTest).toHaveBeenCalledWith("ev1", expect.objectContaining({ template: "M-06", to: "someone@othercompany.test", expectedEventVersion: 4, idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) }));
    expect(host.textContent).toContain("someone@othercompany.test: Queued");
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(host.textContent).toContain("someone@othercompany.test: Delivered.");
  });

  it("rate limit and a missing email service are reported, never shown as sent", async () => {
    const limited = transport({ sendTest: vi.fn(async () => ({ ok: false as const, error: { code: "rate_limited" as const, message: "", retryAfterMs: 20 * 60_000 } })) });
    act(() => root.render(<Harness t={limited} />));
    act(() => row("M-02").querySelector<HTMLButtonElement>("button")!.click());
    await flush();
    type(host.querySelector<HTMLInputElement>('input[type="email"]')!, "a@b.co");
    await act(async () => { button("Send test").click(); });
    expect(host.textContent).toContain("Test limit reached: 10 per hour. Try again in 20 min.");

    act(() => root.unmount());
    root = createRoot(host);
    const missing = transport({ sendTest: vi.fn(async () => ({ ok: false as const, error: { code: "unavailable" as const, message: "" } })) });
    act(() => root.render(<Harness t={missing} />));
    act(() => row("M-02").querySelector<HTMLButtonElement>("button")!.click());
    await flush();
    type(host.querySelector<HTMLInputElement>('input[type="email"]')!, "a@b.co");
    await act(async () => { button("Send test").click(); });
    expect(host.textContent).toContain("Test sending isn’t connected yet. Nothing was sent.");
  });

  it("without the preview route (or on a new event) it shows a labelled sample of the default template", async () => {
    const t = transport({ preview: vi.fn(async () => ({ ok: false as const, error: { code: "unavailable" as const, message: "" } })) });
    act(() => root.render(<Harness t={t} newEvent sample={samplePreview} />));
    act(() => row("M-02").querySelector<HTMLButtonElement>("button")!.click());
    for (let i = 0; i < 50 && !host.querySelector("iframe"); i++) await flush(20);
    expect(t.preview).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Sample of the default template");
    expect(host.querySelector("iframe")).not.toBeNull();
    expect(button("Send test").disabled).toBe(true);
    expect(host.textContent).toContain("Save the event as a draft to send tests.");
  });
});

describe("real routes (no sample renderer)", () => {
  it("say why there is no preview instead of showing fixture data", async () => {
    const t = transport({ preview: vi.fn(async () => ({ ok: false as const, error: { code: "unavailable" as const, message: "" } })) });
    act(() => root.render(<Harness t={t} />));
    act(() => row("M-02").querySelector<HTMLButtonElement>("button")!.click());
    await flush();
    expect(host.textContent).toContain("Previews aren’t available yet");
    expect(host.querySelector("iframe")).toBeNull();
    act(() => root.render(<Harness t={t} newEvent />));
    act(() => row("M-02").querySelector<HTMLButtonElement>("button")!.click());
    act(() => row("M-02").querySelector<HTMLButtonElement>("button")!.click());
    await flush();
    expect(host.textContent).toContain("Save the event as a draft to preview its emails.");
  });
});

describe("email model helpers", () => {
  it("overrides equal to the default are dropped; the sender splits for the inbox header", () => {
    expect(setOverride({ version: 1, templates: { "M-02": { enabled: true, subject: "x" } } }, "M-02", { enabled: true })).toEqual({ version: 1, templates: {} });
    expect(setOverride({ version: 1, templates: {} }, "M-11", { enabled: true, body_md: "" })).toEqual({ version: 1, templates: {} });
    expect(stubEmailTemplates({ version: 1, templates: { "M-06": { enabled: false } } }).find((t) => t.code === "M-06")!.enabled).toBe(true);
    expect(parseSender("Didit Events <events@updates.didit.me>")).toEqual({ name: "Didit Events", address: "events@updates.didit.me" });
  });
});
