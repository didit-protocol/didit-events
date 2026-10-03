// @vitest-environment jsdom
import { act, useState, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatePicker } from "./DatePicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
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
const trigger = () => host.querySelector<HTMLButtonElement>("button[aria-haspopup=dialog]")!;
const hidden = () => host.querySelector<HTMLInputElement>("input[type=hidden]")!;
const dialog = () => host.querySelector<HTMLElement>("[role=dialog]");
const focused = () => document.activeElement as HTMLElement;
/** Opens the popover and waits for the lazily loaded month grid. */
async function open() {
  await act(async () => trigger().click());
  for (let i = 0; i < 20 && !host.querySelector("[role=grid]"); i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  expect(host.querySelector("[role=grid]")).not.toBeNull();
}
const key = (k: string, init: KeyboardEventInit = {}) => act(() => { focused().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })); });

function Harness({ initial = "", min, onChange }: { initial?: string; min?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <form>
      <DatePicker label="Date" name="date" value={value} min={min} onChange={(v) => { setValue(v); onChange?.(v); }} />
      <button type="button" id="outside">outside</button>
    </form>
  );
}

describe("DatePicker", () => {
  it("closed: outline trigger with the calendar icon and the placeholder, empty hidden value", () => {
    const html = renderToStaticMarkup(<DatePicker label="Date" name="date" value="" onChange={() => {}} />);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Pick a date");
    expect(html).toContain('<input type="hidden" name="date" value=""/>');
    expect(html).not.toContain('role="dialog"');
    const filled = renderToStaticMarkup(<DatePicker label="Date" name="date" value="2026-10-23" onChange={() => {}} error="Pick a date" />);
    expect(filled).toContain("Fri, 23 Oct 2026");
    expect(filled).toContain('value="2026-10-23"');
    expect(filled).toContain('aria-invalid="true"');
  });

  it("open: labelled dialog, Monday-first header, today marked, selected filled, outside days muted", async () => {
    render(<Harness initial="2026-10-23" />);
    await open();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(dialog()!.getAttribute("aria-label")).toBe("Choose date");
    expect(trigger().getAttribute("aria-controls")).toBe(dialog()!.id);
    expect([...host.querySelectorAll("th")].map((t) => t.textContent)).toEqual(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
    expect(host.querySelector("h2")!.textContent).toBe("October 2026");
    const sel = host.querySelector<HTMLElement>("[data-selected]")!;
    expect(sel.dataset.date).toBe("2026-10-23");
    expect(sel.closest("td")!.getAttribute("aria-selected")).toBe("true");
    expect(focused().dataset.date).toBe("2026-10-23");
    // October 2026 starts on a Thursday: the grid opens on Mon 28 Sep, muted; 30 Sep is today.
    const firstCell = host.querySelector<HTMLElement>("tbody button")!;
    expect(firstCell.dataset.date).toBe("2026-09-28");
    expect(firstCell.hasAttribute("data-outside")).toBe(true);
    expect(host.querySelector<HTMLElement>("[data-today]")!.dataset.date).toBe("2026-09-30");
    expect(host.querySelector("[data-today]")!.getAttribute("aria-current")).toBe("date");
    await act(async () => host.querySelector<HTMLButtonElement>("[aria-label='Next month']")!.click());
    expect(host.querySelector("h2")!.textContent).toBe("November 2026");
  });

  it("keyboard: arrows by day/week, PageUp/PageDown by month, Home/End to the week, Enter selects and returns focus", async () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-10-23" onChange={onChange} />);
    await open();
    key("ArrowRight"); expect(focused().dataset.date).toBe("2026-10-24");
    key("ArrowLeft"); key("ArrowLeft"); expect(focused().dataset.date).toBe("2026-10-22");
    key("ArrowDown"); expect(focused().dataset.date).toBe("2026-10-29");
    key("ArrowUp"); expect(focused().dataset.date).toBe("2026-10-22");
    key("PageDown"); expect(focused().dataset.date).toBe("2026-11-22");
    expect(host.querySelector("h2")!.textContent).toBe("November 2026");
    key("PageUp"); key("PageUp"); expect(focused().dataset.date).toBe("2026-09-22");
    key("Home"); expect(focused().dataset.date).toBe("2026-09-21");
    key("End"); expect(focused().dataset.date).toBe("2026-09-27");
    key("PageDown", { shiftKey: true }); expect(focused().dataset.date).toBe("2027-09-27");
    key("Enter");
    expect(onChange).toHaveBeenCalledWith("2027-09-27");
    expect(dialog()).toBeNull();
    expect(focused()).toBe(trigger());
    expect(hidden().value).toBe("2027-09-27");
    expect(trigger().textContent).toMatch(/Mon, 27 Sept? 2027$/);
    await open();
    key(" ");
    expect(onChange).toHaveBeenLastCalledWith("2027-09-27");
  });

  it("Escape closes without a change and returns focus to the trigger; a click outside closes", async () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-10-23" onChange={onChange} />);
    await open();
    key("ArrowRight");
    key("Escape");
    expect(dialog()).toBeNull();
    expect(focused()).toBe(trigger());
    expect(onChange).not.toHaveBeenCalled();
    expect(hidden().value).toBe("2026-10-23");
    await open();
    act(() => { host.querySelector("#outside")!.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(dialog()).toBeNull();
    await open();
    act(() => { host.querySelector("[role=grid]")!.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(dialog()).not.toBeNull();
  });

  it("days before min are disabled: not selectable by click or Enter, and the view cannot page before min", async () => {
    const onChange = vi.fn();
    render(<Harness min="2026-09-30" onChange={onChange} />);
    await open();
    expect(host.querySelector("h2")!.textContent).toBe("September 2026");
    expect(focused().dataset.date).toBe("2026-09-30");
    const past = host.querySelector<HTMLButtonElement>("[data-date='2026-09-29']")!;
    expect(past.getAttribute("aria-disabled")).toBe("true");
    expect(host.querySelector("[data-date='2026-09-30']")!.hasAttribute("aria-disabled")).toBe(false);
    await act(async () => past.click());
    expect(onChange).not.toHaveBeenCalled();
    key("ArrowLeft");
    key("Enter");
    expect(onChange).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLButtonElement>("[aria-label='Previous month']")!.disabled).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-date='2026-10-02']")!.click());
    expect(onChange).toHaveBeenCalledWith("2026-10-02");
    expect(hidden().value).toBe("2026-10-02");
  });

  it("submits the ISO value through the form", async () => {
    render(<Harness initial="2026-10-23" />);
    expect(new FormData(host.querySelector("form")!).get("date")).toBe("2026-10-23");
  });
});
