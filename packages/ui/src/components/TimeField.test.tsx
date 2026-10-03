// @vitest-environment jsdom
import { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TimeField } from "./TimeField";
import { NumberField } from "./NumberField";
import { formatDuration, normalizeTime, timeSlots, timeToMinutes } from "./time";

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
const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
const type = (input: HTMLInputElement, value: string) => act(() => { setValue.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
const key = (el: HTMLElement, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });

describe("time helpers", () => {
  it.each([["19:00", "19:00"], ["1900", "19:00"], ["19", "19:00"], ["19h30", "19:30"], ["7.30", "07:30"], ["7pm", "19:00"], ["7:30 pm", "19:30"], ["7 p.m.", "19:00"], ["12am", "00:00"], ["12pm", "12:00"], ["noon", "12:00"], [" 8 AM ", "08:00"]])("%j → %s", (raw, out) => {
    expect(normalizeTime(raw)).toBe(out);
  });
  it.each(["25:00", "7:60", "13pm", "0am", "9:5", "abc", ""])("%j is not a time", (raw) => expect(normalizeTime(raw)).toBeNull());
  it("slots, minutes and durations", () => {
    expect(timeSlots()).toHaveLength(96);
    expect(timeSlots().slice(0, 3)).toEqual(["00:00", "00:15", "00:30"]);
    expect(timeToMinutes("7pm")).toBe(1140);
    expect([formatDuration(210), formatDuration(45), formatDuration(120)]).toEqual(["3 h 30 min", "45 min", "2 h"]);
  });
});

function Times({ start = "19:00", initialEnd = "" }: { start?: string; initialEnd?: string }) {
  const [end, setEnd] = useState(initialEnd);
  return (
    <form>
      <TimeField label="End" name="end" value={end} onChange={setEnd} after={start} durationFrom={start} />
    </form>
  );
}

describe("TimeField", () => {
  const input = () => host.querySelector<HTMLInputElement>("input[role=combobox]")!;
  const options = () => [...host.querySelectorAll<HTMLElement>("[role=option]")];

  it("is a combobox listing only slots after the start, each with the duration", () => {
    render(<Times />);
    act(() => input().focus());
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("[role=listbox]")!.getAttribute("aria-label")).toBe("End times");
    expect(options()[0]!.textContent).toBe("19:1515 min");
    expect(options().map((o) => o.querySelector("span")!.textContent)).not.toContain("19:00");
    expect(options().find((o) => o.textContent!.startsWith("22:30"))!.textContent).toBe("22:303 h 30 min");
    expect(options().at(-1)!.textContent).toMatch(/^23:45/);
  });

  it("keyboard: ArrowDown moves the active option, Enter selects, Escape closes", () => {
    render(<Times initialEnd="23:00" />);
    act(() => input().focus());
    const active = () => host.querySelector(`#${CSS.escape(input().getAttribute("aria-activedescendant") ?? "none")}`)?.textContent;
    expect(active()).toMatch(/^23:00/);
    key(input(), "ArrowDown");
    expect(active()).toMatch(/^23:15/);
    key(input(), "Enter");
    expect(input().value).toBe("23:15");
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).toContain("4 h 15 min");
    key(input(), "ArrowDown");
    expect(input().getAttribute("aria-expanded")).toBe("true");
    key(input(), "Escape");
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });

  it("typed entry is normalised on blur ('10:30pm' → 22:30) and posts HH:MM", () => {
    render(<Times />);
    act(() => input().focus());
    type(input(), "10:30pm");
    act(() => input().blur());
    expect(input().value).toBe("22:30");
    expect(new FormData(host.querySelector("form")!).get("end")).toBe("22:30");
    act(() => input().focus());
    type(input(), "later");
    act(() => input().blur());
    expect(input().value).toBe("later");
  });
});

const SERVER_RULE = (end: string) => (end === "19:00" ? "End must be after start" : "End must be after start. Events can’t run past midnight.");
function RuledTimes({ start = "19:00" }: { start?: string }) {
  const [end, setEnd] = useState("");
  return <TimeField label="End" name="end" value={end} onChange={setEnd} after={start} afterError={SERVER_RULE} />;
}

describe("TimeField range", () => {
  const input = () => host.querySelector<HTMLInputElement>("input[role=combobox]")!;
  const error = () => host.querySelector(`#${CSS.escape(input().id)}-error`)?.textContent ?? null;

  it("a typed end at or before `after` shows the form's inline error on commit (blur or Enter), not a silent commit", () => {
    render(<RuledTimes />);
    act(() => input().focus());
    type(input(), "6pm");
    expect(error()).toBeNull();
    act(() => input().blur());
    expect(input().value).toBe("18:00");
    expect(error()).toBe("End must be after start. Events can’t run past midnight.");
    expect(input().getAttribute("aria-invalid")).toBe("true");
    act(() => input().focus());
    type(input(), "19:00");
    expect(error()).toBeNull();
    key(input(), "Enter");
    expect(input().value).toBe("19:00");
    expect(error()).toBe("End must be after start");
    type(input(), "22:00");
    key(input(), "Enter");
    expect(input().value).toBe("22:00");
    expect(error()).toBeNull();
  });
  it("without a custom rule it still flags the typed time with a default message", () => {
    const Wrapper = () => { const [v, setV] = useState(""); return <TimeField label="End" value={v} onChange={setV} after="19:00" />; };
    render(<Wrapper />);
    act(() => input().focus());
    type(input(), "0700");
    act(() => input().blur());
    expect(error()).toBe("Pick a time after 19:00");
  });
});

function Capacity({ initial = "" }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return (
    <form>
      <NumberField label="Capacity" name="capacity" value={v} onChange={setV} min={1} max={10000} />
    </form>
  );
}

describe("NumberField", () => {
  const input = () => host.querySelector<HTMLInputElement>("input[inputmode=numeric]")!;
  const posted = () => new FormData(host.querySelector("form")!).get("capacity");
  it("shows thousands separators, posts digits, refuses letters and clamps the stepper", () => {
    render(<Capacity initial="1200" />);
    expect(input().value).toBe("1,200");
    expect(posted()).toBe("1200");
    act(() => input().focus());
    expect(input().value).toBe("1200");
    type(input(), "12a5.5");
    expect(input().value).toBe("1255");
    key(input(), "ArrowUp");
    expect(posted()).toBe("1256");
    act(() => input().blur());
    expect(input().value).toBe("1,256");
    type(input(), "99999");
    key(input(), "ArrowUp");
    expect(posted()).toBe("10000");
    act(() => host.querySelector<HTMLButtonElement>("[aria-label=Increase]")!.click());
    expect(posted()).toBe("10000");
    expect(host.querySelector<HTMLButtonElement>("[aria-label=Increase]")!.disabled).toBe(true);
  });
  it("the − button stops at the minimum; an empty field steps up from the minimum", () => {
    render(<Capacity />);
    act(() => host.querySelector<HTMLButtonElement>("[aria-label=Increase]")!.click());
    expect(posted()).toBe("1");
    expect(host.querySelector<HTMLButtonElement>("[aria-label=Decrease]")!.disabled).toBe(true);
  });
});
