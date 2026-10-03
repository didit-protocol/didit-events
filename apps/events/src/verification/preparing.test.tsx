// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VerificationPreparing } from "./Preparing";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("automatically retries the protected form once per pending response and cancels on unmount", async () => {
  const submit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {});
  const render = (retryKey: string) => act(() => root.render(<VerificationPreparing slug="event" token="link" retryKey={retryKey} action={async () => {}} />));
  render("one");
  act(() => vi.advanceTimersByTime(999)); expect(submit).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1)); expect(submit).toHaveBeenCalledOnce();
  const form = submit.mock.instances[0] as HTMLFormElement;
  expect(new FormData(form).get("slug")).toBe("event"); expect(new FormData(form).get("token")).toBe("link");
  expect(form.querySelector('input[name="csrf"]')).not.toBeNull();
  act(() => vi.advanceTimersByTime(5000)); expect(submit).toHaveBeenCalledOnce();
  render("two"); act(() => vi.advanceTimersByTime(1000)); expect(submit).toHaveBeenCalledTimes(2);
  render("three"); act(() => root.render(null)); act(() => vi.advanceTimersByTime(1000)); expect(submit).toHaveBeenCalledTimes(2);
});

it("a manual retry suppresses the scheduled retry while its action is in progress", async () => {
  const submit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {});
  let finish!: () => void;
  const action = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  act(() => root.render(<VerificationPreparing slug="event" retryKey="one" action={action} />));
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  act(() => vi.advanceTimersByTime(1000));
  expect(action).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled();
  await act(async () => finish());
});
