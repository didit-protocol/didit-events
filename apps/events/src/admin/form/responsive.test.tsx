// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventForm } from "./EventForm";
import { BCN_FORM } from "./fixtures";
import type { EventFormState } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
const formCss = read("./EventForm.module.css");
const sectionsCss = read("./Sections.module.css");

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

const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
const type = (input: HTMLInputElement, value: string) => act(() => { setValue.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
const byLabel = (text: string) => {
  const label = [...host.querySelectorAll("label")].find((l) => l.textContent === text);
  return host.querySelector<HTMLInputElement>(`#${CSS.escape(label!.htmlFor)}`)!;
};
const edit = () => {
  const action = vi.fn(async (_p: EventFormState, _fd: FormData): Promise<EventFormState> => ({ status: "idle", values: BCN_FORM }));
  act(() => root.render(<EventForm mode="edit" eventId="e1" crumb="Barcelona Office Opening" cancelHref="/admin" action={action} initialState={{ status: "idle", values: BCN_FORM }} />));
};

describe("A-03 event editor, responsive", () => {
  it("a bottom save bar repeats the actions: armed once there is something to save", () => {
    edit();
    const bar = host.querySelector<HTMLElement>(".saveBar")!;
    expect(bar.parentElement).toBe(host.querySelector("form"));
    expect(bar.hasAttribute("data-dirty")).toBe(false);
    expect(bar.querySelector("button[type=submit]")!.textContent).toBe("Save changes");
    expect(bar.querySelector("a")!.textContent).toBe("Cancel");
    type(byLabel("Event name"), "Barcelona Office Opening 2");
    expect(bar.hasAttribute("data-dirty")).toBe(true);
    expect(bar.textContent).toContain("Unsaved changes");
    // Wide: the bar shows only while dirty. Narrow: always, and it replaces the head's buttons.
    expect(formCss).toContain(".saveBar[data-dirty] { display: flex; }");
    const narrow = formCss.slice(formCss.indexOf("@container eventform (max-width: 640px)"));
    expect(narrow).toContain(".head .actions { display: none; }");
    expect(narrow).toMatch(/\.saveBar \{ display: flex;/);
  });

  it("the date row keeps its values readable: the timezone shows the city, the duration has a narrow fallback", () => {
    edit();
    expect(byLabel("Timezone").value).toBe("Madrid (CEST)");
    expect(new FormData(host.querySelector("form")!).get("timezone")).toBe("Europe/Madrid");
    expect(host.querySelector(".end .endHint")!.textContent).toBe("4 h");
    expect(formCss).toMatch(/\.row4 \{ display: grid; grid-template-columns: minmax\(150px/);
    // Four tracks only where the timezone gets ~240px; otherwise it takes its own line, two tracks wide.
    for (const query of ["@container eventform (max-width: 899px)", "@container eventform (min-width: 1081px) and (max-width: 1299px)"]) {
      const rule = formCss.slice(formCss.indexOf(query), formCss.indexOf("\n}", formCss.indexOf(query)));
      expect(rule).toContain('.row4 > [data-field="timezone"] { grid-column: 1 / span 2; }');
    }
    const narrow = formCss.slice(formCss.indexOf("@container eventform (max-width: 440px)"));
    expect(narrow).toContain(".endHint { display: block; }");
  });

  it("section tabs are marked for the sideways scroller and the theme picker has a visible caption", () => {
    edit();
    expect([...host.querySelectorAll<HTMLElement>("nav[aria-label='Editor sections'] a")].map((a) => a.dataset.section)).toEqual(["details", "description", "agenda", "registration", "verification", "door", "emails"]);
    expect(formCss).toContain(".sectionNav[data-more]");
    expect(host.querySelector(".themeField")!.textContent).toContain("Theme when there is no square cover");
  });

  it("breakpoints measure the form's own column (never the shell), with 44px targets and 16px inputs when narrow", () => {
    expect(formCss).toContain("container: eventform / inline-size");
    for (const css of [formCss, sectionsCss, read("./MarkdownEditor.module.css"), read("./RouteStates.module.css")]) expect(css).not.toContain("@container admin");
    const narrow = formCss.slice(formCss.indexOf("@container eventform (max-width: 640px)"));
    expect(narrow).toContain("--control-h: 44px");
    expect(narrow).toContain("font-size: 16px");
    expect(narrow).toContain(".iconBtn { width: 44px; height: 44px; }");
    const sections = sectionsCss.slice(sectionsCss.indexOf("@container eventform (max-width: 640px)"));
    expect(sections).toContain(".iconBtn { width: 44px; height: 44px; }");
    expect(sections).toContain(".segmented.segmented > label { flex: 1 1 0; min-width: 0; }");
    expect(sections).toContain(".fixedRule { flex-basis: 100%;");
    // Stacked agenda and host rows have no tools line of their own: the buttons sit in the grid beside the fields.
    // Agenda cards: "What happens" leads on a wide line of its own; Time, Until, ↑ and ↓ share the second.
    expect(sectionsCss).toMatch(/@container eventform \(max-width: 640px\) \{[^{]*\.agendaRow \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\) 44px 44px/);
    expect(sectionsCss).toContain(".agendaRow > [data-agenda-label] { grid-area: 1 / 1 / auto / 4; }");
    expect(sectionsCss).toContain(".agendaRow > .agendaTools { display: contents; }");
    expect(narrow).toContain(".hostRow > .hostTools { display: contents; }");
    const markdown = read("./MarkdownEditor.module.css");
    expect(markdown.slice(markdown.indexOf("@container eventform (max-width: 640px)"))).toContain(".tool { min-width: 44px; height: 44px; }");
  });
});
