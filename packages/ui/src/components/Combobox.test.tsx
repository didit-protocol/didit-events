// @vitest-environment jsdom
import { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Combobox, type ComboboxOption } from "./Combobox";

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
const key = (el: HTMLElement, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });

const OPTIONS: ComboboxOption[] = [
  { value: "a", label: "Alpha", disabled: true },
  { value: "b", label: "Bravo" },
  { value: "c", label: "Charlie", disabled: true },
  { value: "d", label: "Delta" },
  { value: "e", label: "Echo", disabled: true },
];

function Pick({ initial, options = OPTIONS, picks }: { initial: string; options?: ComboboxOption[]; picks: string[] }) {
  const [value, setValue] = useState(initial);
  return (
    <Combobox label="Pick" inputValue={options.find((o) => o.value === value)?.label ?? ""} onInputChange={() => {}} options={options} activeValue={value} openOnFocus listLabel="Letters"
      onSelect={(o) => { picks.push(o.value); setValue(o.value); }} />
  );
}

describe("Combobox with disabled options", () => {
  const input = () => host.querySelector<HTMLInputElement>("input[role=combobox]")!;
  const active = () => host.querySelector(`#${CSS.escape(input().getAttribute("aria-activedescendant") ?? "none")}`)?.textContent ?? null;

  it("when the current value is disabled the active descendant starts at the first enabled option", () => {
    const picks: string[] = [];
    render(<Pick initial="c" picks={picks} />);
    act(() => input().focus());
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(active()).toBe("Bravo");
    key(input(), "Enter");
    expect(picks).toEqual(["b"]);
  });
  it("Enter never targets a disabled row; arrows skip disabled rows both ways", () => {
    const picks: string[] = [];
    render(<Pick initial="a" picks={picks} />);
    act(() => input().focus());
    expect(active()).toBe("Bravo");
    key(input(), "ArrowDown");
    expect(active()).toBe("Delta");
    key(input(), "ArrowDown");
    expect(active()).toBe("Bravo");
    key(input(), "ArrowUp");
    expect(active()).toBe("Delta");
    key(input(), "Enter");
    expect(picks).toEqual(["d"]);
    expect(host.querySelectorAll('[role=option][aria-selected="true"][aria-disabled="true"]')).toHaveLength(0);
  });
  it("closed list: ArrowUp opens on the last enabled option, and an active row that turns disabled is never chosen", () => {
    const picks: string[] = [];
    render(<Pick initial="e" picks={picks} />);
    key(input(), "ArrowUp");
    expect(active()).toBe("Delta");
    // The options change under the open list: Delta becomes disabled.
    render(<Pick initial="e" picks={picks} options={OPTIONS.map((o) => (o.value === "d" ? { ...o, disabled: true } : o))} />);
    expect(active()).toBeNull();
    key(input(), "Enter");
    expect(picks).toEqual([]);
  });
});
