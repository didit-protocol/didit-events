// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeInput } from "./CodeInput";

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
});

const render = (el: ReactElement) => act(() => root.render(el));
const input = () => host.querySelector("input") as HTMLInputElement;
const boxes = () => Array.from(host.querySelectorAll("span[aria-hidden]")).map((b) => b.textContent);
const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

/** What the browser does for a keystroke, autofill or backspace: new value, then an `input` event. */
function type(value: string) {
  act(() => {
    setValue.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** A paste with `text` on the clipboard; returns whether the component took it over (preventDefault). */
function paste(text: string) {
  const e = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "clipboardData", { value: { getData: () => text } });
  act(() => {
    input().dispatchEvent(e);
  });
  return e.defaultPrevented;
}

describe("CodeInput interaction", () => {
  it("has no maxLength that would cut a formatted code short", () => {
    render(<CodeInput name="code" label="6-digit code" />);
    expect(input().hasAttribute("maxlength")).toBe(false);
  });

  it("typing fills the boxes one by one and completes on the sixth digit", () => {
    const onComplete = vi.fn();
    const onChange = vi.fn();
    render(<CodeInput name="code" label="6-digit code" onChange={onChange} onComplete={onComplete} />);
    let v = "";
    for (const d of "48190") {
      v += d;
      type(v);
    }
    expect(boxes()).toEqual(["4", "8", "1", "9", "0", ""]);
    expect(onComplete).not.toHaveBeenCalled();
    type("x"); // a non-digit keystroke is dropped
    expect(input().value).toBe("");
    type("481903");
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith("481903");
    expect(onChange).toHaveBeenLastCalledWith("481903");
  });

  it("backspace clears the last digit; retyping it completes again", () => {
    const onComplete = vi.fn();
    render(<CodeInput name="code" label="6-digit code" defaultValue="481903" onComplete={onComplete} />);
    type("48190");
    expect(input().value).toBe("48190");
    expect(boxes()[5]).toBe("");
    type("481904");
    expect(onComplete).toHaveBeenCalledWith("481904");
  });

  it.each(["481 903", "481-903", " 481903", "481903 ", "Your code: 481 903"])("pasting %j normalises to 481903 and completes", (text) => {
    const onComplete = vi.fn();
    render(<CodeInput name="code" label="6-digit code" onComplete={onComplete} />);
    expect(paste(text)).toBe(true);
    expect(input().value).toBe("481903");
    expect(onComplete).toHaveBeenCalledWith("481903");
  });

  it.each(["481 903", "481-903", " 481903"])("autofill of %j (input event, no paste) completes", (text) => {
    const onComplete = vi.fn();
    render(<CodeInput name="code" label="6-digit code" onComplete={onComplete} />);
    type(text);
    expect(input().value).toBe("481903");
    expect(onComplete).toHaveBeenCalledWith("481903");
  });

  it("a paste replaces a full wrong code and completes with the new one", () => {
    const onComplete = vi.fn();
    render(<CodeInput name="code" label="6-digit code" defaultValue="111111" invalid onComplete={onComplete} />);
    paste("481-903");
    expect(input().value).toBe("481903");
    expect(onComplete).toHaveBeenCalledWith("481903");
  });

  it("a paste without digits is left to the browser", () => {
    render(<CodeInput name="code" label="6-digit code" />);
    expect(paste("hello")).toBe(false);
    expect(input().value).toBe("");
  });

  it("controlled: reports the normalised value to onChange", () => {
    const onChange = vi.fn();
    render(<CodeInput name="code" label="6-digit code" value="" onChange={onChange} />);
    paste("481 903");
    expect(onChange).toHaveBeenCalledWith("481903");
  });
});
