// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderSafeMarkdown } from "@didit-events/core/content/markdown";
import { renderDescriptionPreview } from "../../server/markdown-preview";
import { EventForm } from "./EventForm";
import { moveRow } from "./AgendaField";
import { BCN_FORM } from "./fixtures";
import type { EventFormState, EventFormValues } from "./types";
import { agendaErrors, agendaOutside, agendaRowsOf, readV2, sameValue, type AgendaRow, type EditorV2 } from "./editor";
import { readEventForm, validateEventForm } from "./validate";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EVENT = "3f0a6c1e-8b1d-4c1a-9d5e-2a7b6c5d4e3f";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, data: [] })));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = (el: ReactElement) => act(() => root.render(el));
const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
const type = (input: HTMLInputElement, value: string) => act(() => { setValue.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
const flush = async () => { await act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); }); };
const v2 = (): EditorV2 => JSON.parse(new FormData(host.querySelector("form")!).get("v2") as string);
const button = (label: string, scope: ParentNode = host) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent === label)!;
const rows = () => [...host.querySelectorAll<HTMLElement>("[data-agenda-row]")];
/** [time, label, until] inputs of one row (DOM order is time, until, label). */
const inputs = (row: HTMLElement) => {
  const [time, until, label] = [...row.querySelectorAll<HTMLInputElement>("input")];
  return [time, label, until];
};
const labels = () => v2().agenda!.map((r) => `${r.time} ${r.label}`);
const key = (el: HTMLElement, k: string, alt = false) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, altKey: alt, bubbles: true, cancelable: true })); });
const drag = (el: HTMLElement, kind: string) => act(() => {
  const e = new Event(kind, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", { value: { setData: () => {}, effectAllowed: "" } });
  el.dispatchEvent(e);
});

const AGENDA: AgendaRow[] = [
  { id: "a1", time: "19:00", label: "Doors" },
  { id: "a2", time: "20:00", label: "Welcome" },
  { id: "a3", time: "20:30", label: "Demos", emphasis: true },
];
const withAgenda = (agenda: AgendaRow[]): EventFormValues => ({ ...BCN_FORM, v2: { ...BCN_FORM.v2!, agenda } });

async function form(values: EventFormValues, extra: { mode?: "new" | "edit"; action?: (p: EventFormState, f: FormData) => Promise<EventFormState>; renderMarkdown?: (s: string) => Promise<string | null> } = {}) {
  const action = extra.action ?? vi.fn(async (_p: EventFormState, _f: FormData): Promise<EventFormState> => ({ status: "idle", values }));
  const mode = extra.mode ?? "edit";
  render(<EventForm mode={mode} crumb="BCN" cancelHref="/admin" eventId={mode === "edit" ? EVENT : undefined} editVersion={4} action={action} initialState={{ status: "idle", values }} renderMarkdown={extra.renderMarkdown} />);
  // The Description and Agenda sections are code-split (React.lazy): wait for both chunks, however cold the transform.
  for (let i = 0; i < 400 && !(host.querySelector('[role="tablist"]') && button("Add agenda item")); i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  await flush();
  return action;
}

describe("agenda rules", () => {
  it("time required and valid, label 1–120 characters on one line, at most 30 rows", () => {
    expect(agendaErrors(AGENDA)).toEqual({});
    // DST fall-back overlap (Madrid, 2026-10-25): 00:45Z → 01:15Z reads 02:45 → 02:15 yet is a valid 30-minute item.
    const tz = { date: "2026-10-24", timeZone: "Europe/Madrid" };
    const [overlap] = agendaRowsOf([{ at: "2026-10-25T00:45:00Z", endAt: "2026-10-25T01:15:00Z", label: "Late set" }], "Europe/Madrid", "2026-10-24T18:00:00Z");
    expect(overlap).toMatchObject({ time: "02:45", until: "02:15", day: 1 });
    expect(agendaErrors([overlap!], tz)).toEqual({});
    // Edited end before the start (wall clock) → rejected.
    expect(agendaErrors([{ ...overlap!, until: "02:30" }], tz)["agenda:a1:until"]).toBe("End after the start time");
    // Retained first-occurrence start (00:45Z) + edited end 02:50 (first occurrence, 00:50Z) → valid, like the server.
    expect(agendaErrors([{ ...overlap!, until: "02:50" }], tz)).toEqual({});
    // Retained second-occurrence start (01:45Z = 02:45 CET) + edited end 02:50 resolves to the first 02:50 (00:50Z) → rejected.
    const [late] = agendaRowsOf([{ at: "2026-10-25T01:45:00Z", endAt: "2026-10-25T02:30:00Z", label: "Later set" }], "Europe/Madrid", "2026-10-24T18:00:00Z");
    expect(late).toMatchObject({ time: "02:45", until: "03:30" });
    expect(agendaErrors([late!], tz)).toEqual({});
    expect(agendaErrors([{ ...late!, until: "02:50" }], tz)["agenda:a1:until"]).toBe("End after the start time");
    // The end moved to the previous day keeps its retained wall time but not its date → rejected.
    expect(agendaErrors([{ ...overlap!, untilDay: 0 }], tz)["agenda:a1:until"]).toBe("End after the start time");
    // Without the event's date and zone: the wall-clock rule.
    expect(agendaErrors([overlap!])["agenda:a1:until"]).toBe("End after the start time");
    expect(agendaErrors([{ id: "x", time: "", label: "" }])).toEqual({ "agenda:x:time": "Add a time", "agenda:x:label": "Write what happens" });
    expect(agendaErrors([{ id: "x", time: "25:00", label: "a".repeat(121) }])).toEqual({ "agenda:x:time": "Use a time like 19:00", "agenda:x:label": "Keep it under 120 characters" });
    expect(agendaErrors([{ id: "x", time: "19:00", label: "a\nb" }])["agenda:x:label"]).toBe("Remove line breaks and control characters");
    expect(agendaErrors([{ id: "x", time: "19:00", label: "a".repeat(120) }])).toEqual({});
    const many = Array.from({ length: 31 }, (_, i) => ({ id: `r${i}`, time: "19:00", label: `Item ${i}` }));
    expect(agendaErrors(many).agenda).toBe("At most 30 agenda items");
    expect(agendaErrors(many.slice(0, 30)).agenda).toBeUndefined();
    // Form level: grouped under the Agenda section.
    expect(validateEventForm(withAgenda([{ id: "x", time: "19:00", label: " " }])).agenda).toBe("Write what happens");
    expect(validateEventForm(withAgenda(AGENDA)).agenda).toBeUndefined();
  });

  it("an optional until must be a valid time after the start", () => {
    expect(agendaErrors([{ id: "x", time: "19:10", until: "20:00", label: "Talk" }])).toEqual({});
    expect(agendaErrors([{ id: "x", time: "19:10", until: "", label: "Talk" }])).toEqual({});
    expect(agendaErrors([{ id: "x", time: "19:10", until: "19:10", label: "Talk" }])).toEqual({ "agenda:x:until": "End after the start time" });
    expect(agendaErrors([{ id: "x", time: "19:10", until: "18:00", label: "Talk" }])).toEqual({ "agenda:x:until": "End after the start time" });
    expect(agendaErrors([{ id: "x", time: "19:10", until: "8pm", label: "Talk" }])).toEqual({ "agenda:x:until": "Use a time like 20:00" });
    expect(validateEventForm(withAgenda([{ id: "x", time: "19:10", until: "19:00", label: "Talk" }])).agenda).toBe("End after the start time");
  });

  it("outside the event's start–end is a warning only", () => {
    expect(agendaOutside("18:30", "19:00", "23:00")).toBe(true);
    expect(agendaOutside("23:30", "19:00", "23:00")).toBe(true);
    expect(agendaOutside("19:00", "19:00", "23:00")).toBe(false);
    expect(agendaOutside("23:00", "19:00", "23:00")).toBe(false);
    expect(agendaOutside("18:00", null, "23:00")).toBe(false);
    expect(validateEventForm(withAgenda([{ id: "x", time: "18:30", label: "Doors" }])).agenda).toBeUndefined();
  });

  it("stored {at,label} instants open as HH:mm in the event's zone; older {time,title} blocks too", () => {
    expect(agendaRowsOf([{ at: "2026-10-23T17:00:00.000Z", label: "Doors" }, { at: "2026-10-23T18:30:00.000Z", label: "Panel", emphasis: true }], "Europe/Madrid")).toEqual([
      { id: "a1", time: "19:00", label: "Doors", at: "2026-10-23T17:00:00.000Z" },
      { id: "a2", time: "20:30", label: "Panel", emphasis: true, at: "2026-10-23T18:30:00.000Z" },
    ]);
    expect(agendaRowsOf([{ at: "2026-10-23T17:00:00.000Z", label: "Doors" }], "America/New_York")[0]!.time).toBe("13:00");
    expect(agendaRowsOf([{ time: "18:30", title: "Doors" }, { bogus: true }, null], "Europe/Madrid")).toEqual([{ id: "a1", time: "18:30", label: "Doors" }]);
    expect(agendaRowsOf(null, "Europe/Madrid")).toEqual([]);
    // endAt reopens as the "until" time; an end not after the start is ignored.
    expect(agendaRowsOf([{ at: "2026-10-23T17:10:00.000Z", endAt: "2026-10-23T18:00:00.000Z", label: "Talk" }, { at: "2026-10-23T17:10:00.000Z", endAt: "2026-10-23T17:00:00.000Z", label: "Odd" }], "Europe/Madrid")).toEqual([
      { id: "a1", time: "19:10", until: "20:00", label: "Talk", at: "2026-10-23T17:10:00.000Z", endAt: "2026-10-23T18:00:00.000Z" },
      { id: "a2", time: "19:10", label: "Odd", at: "2026-10-23T17:10:00.000Z" },
    ]);
  });

  it("the posted v2 field carries the agenda; a v2 without it reads as empty; non-arrays are refused", () => {
    const fd = new FormData();
    fd.set("v2", JSON.stringify({ ...BCN_FORM.v2!, agenda: AGENDA }));
    expect(readEventForm(fd).v2!.agenda).toEqual(AGENDA);
    const { agenda: _drop, ...noAgenda } = BCN_FORM.v2!;
    expect(readV2(JSON.stringify(noAgenda))!.agenda).toEqual([]);
    expect(readV2(JSON.stringify({ ...BCN_FORM.v2!, agenda: "x" }))).toBeUndefined();
    expect(sameValue(readV2(JSON.stringify(noAgenda)), readV2(JSON.stringify({ ...BCN_FORM.v2!, agenda: [] })))).toBe(true);
  });

  it("moveRow", () => {
    expect(moveRow([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveRow([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
  });
});

describe("Agenda section", () => {
  it("add, edit, reorder (buttons, Alt+arrows, handle arrows, drag) and remove: the posted agenda follows", async () => {
    await form(withAgenda(AGENDA));
    expect(rows()).toHaveLength(3);
    expect(labels()).toEqual(["19:00 Doors", "20:00 Welcome", "20:30 Demos"]);

    // Add: the new row starts 30 min after the last one and is posted.
    act(() => button("Add agenda item").click());
    expect(rows()).toHaveLength(4);
    type(inputs(rows()[3]!)[1]!, "Drinks");
    expect(labels()).toEqual(["19:00 Doors", "20:00 Welcome", "20:30 Demos", "21:00 Drinks"]);

    // Edit a label.
    type(inputs(rows()[1]!)[1]!, "Welcome from Alberto");
    expect(labels()[1]).toBe("20:00 Welcome from Alberto");

    // Reorder: buttons.
    act(() => button("Move Drinks up").click());
    expect(labels()).toEqual(["19:00 Doors", "20:00 Welcome from Alberto", "21:00 Drinks", "20:30 Demos"]);
    // Alt+ArrowDown anywhere in the row.
    key(inputs(rows()[0]!)[1]!, "ArrowDown", true);
    expect(labels()[1]).toBe("19:00 Doors");
    // ArrowUp on the handle.
    key(button("Reorder Doors"), "ArrowUp");
    expect(labels()[0]).toBe("19:00 Doors");
    expect(host.textContent).toContain("Moved Doors to position 1 of 4");
    // Drag Demos onto the first row.
    drag(button("Reorder Demos"), "dragstart");
    drag(rows()[0]!, "dragover");
    drag(rows()[0]!, "drop");
    expect(labels()).toEqual(["20:30 Demos", "19:00 Doors", "20:00 Welcome from Alberto", "21:00 Drinks"]);
    // Emphasis survives edits and moves.
    expect(v2().agenda![0]!.emphasis).toBe(true);

    // Remove.
    act(() => button("Remove Drinks").click());
    expect(labels()).toEqual(["20:30 Demos", "19:00 Doors", "20:00 Welcome from Alberto"]);
    // The editor is dirty: the save bar says so.
    expect(host.textContent).toContain("Unsaved changes");
  });

  it("an empty agenda says the page hides the section; a row outside the event time is flagged, not blocked", async () => {
    const action = await form(withAgenda([]));
    expect(host.textContent).toContain("The event page hides the section");
    act(() => button("Add agenda item").click());
    // An empty agenda's first row starts at the event start.
    expect(v2().agenda![0]!.time).toBe("19:00");
    const [time, label] = inputs(rows()[0]!);
    type(label!, "Doors");
    // Typed time commits on blur.
    act(() => { time!.focus(); });
    type(time!, "18:30");
    act(() => { time!.blur(); });
    expect(v2().agenda![0]!.time).toBe("18:30");
    expect(host.querySelector("[data-agenda-warning]")!.textContent).toContain("Outside the event’s 19:00–23:00");
    // Optional "until": typed, committed on blur, posted with the row.
    const until = inputs(rows()[0]!)[2]!;
    act(() => { until.focus(); });
    type(until, "19:30");
    act(() => { until.blur(); });
    expect(v2().agenda![0]!.until).toBe("19:30");
    await act(async () => host.querySelector("form")!.requestSubmit());
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("an invalid row blocks the save, marks the Agenda section and shows the row's message", async () => {
    const action = await form(withAgenda([...AGENDA, { id: "bad", time: "19:30", label: "" }]));
    await act(async () => host.querySelector("form")!.requestSubmit());
    expect(action).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Write what happens");
    const nav = [...host.querySelectorAll("nav a")].find((a) => a.textContent?.startsWith("Agenda"))!;
    expect(nav.hasAttribute("data-invalid")).toBe(true);
    expect(button("Add agenda item").disabled).toBe(false);
  });

  it("30 rows: Add is disabled", async () => {
    await form(withAgenda(Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, time: "20:00", label: `Item ${i}` }))));
    expect(button("Add agenda item").disabled).toBe(true);
    expect(host.textContent).toContain("30/30");
  });
});

describe("Description preview", () => {
  const SOURCE = "# Title\n\nSome **bold**, _it_ and [Didit](https://didit.me).\n\n- a\n- b\n\n<script>alert(1)</script> [x](javascript:alert(1))";

  it("the editor preview is the public page's HTML (renderSafeMarkdown), sanitised", async () => {
    expect(renderDescriptionPreview(SOURCE)).toBe(renderSafeMarkdown(SOURCE));
    expect(renderDescriptionPreview(42)).toBeNull();
    expect(renderDescriptionPreview("x".repeat(20_001))).toBeNull();

    const render = vi.fn(async (s: string) => renderDescriptionPreview(s));
    await form({ ...BCN_FORM, v2: { ...BCN_FORM.v2!, descriptionMd: SOURCE } }, { mode: "new", renderMarkdown: render });
    const tab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent === "Preview")!;
    act(() => tab.click());
    await flush();
    expect(render).toHaveBeenCalledWith(SOURCE);
    const panel = host.querySelector<HTMLElement>('[data-preview="public"]')!;
    // The exact string the event page sets as its description HTML.
    expect(panel.innerHTML).toBe(renderSafeMarkdown(SOURCE));
    expect(panel.innerHTML).not.toMatch(/<script|href="javascript|<h1/);
  });

  it("falls back to the local safe preview when the renderer is unavailable", async () => {
    await form({ ...BCN_FORM, v2: { ...BCN_FORM.v2!, descriptionMd: "Some **bold**" } }, { renderMarkdown: async () => null });
    const tab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent === "Preview")!;
    act(() => tab.click());
    await flush();
    expect(host.querySelector('[data-preview="local"]')!.innerHTML).toContain("<strong>bold</strong>");
  });

  it("the toolbar, tabs and the 20,000 character counter are in the editor", async () => {
    await form({ ...BCN_FORM, v2: { ...BCN_FORM.v2!, descriptionMd: "hello" } }, { mode: "new" });
    for (const label of ["Bold", "Italic", "Heading", "Bulleted list", "Link"]) expect(button(label)).toBeTruthy();
    expect(host.textContent).toContain("5/20,000");
  });
});
