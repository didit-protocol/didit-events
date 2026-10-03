// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EventChecks, EventDoor, EventForm as FormModel } from "../model/contract";
import { DoorSection } from "./DoorSection";
import { FormBuilder } from "./FormBuilder";
import { VerificationSection, guestSteps } from "./VerificationSection";
import { BCN_FORM } from "./fixtures";
import { readEventForm, toEventInput, validateEventForm } from "./validate";
import { DEFAULT_V2, uuid, canonicalChecks, editorialTextError, readV2, sameValue, unknownVariables, validateV2, type EditorV2 } from "./editor";

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

const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
const setSelect = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
const type = (input: HTMLInputElement, value: string) => act(() => { setValue.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
const choose = (select: HTMLSelectElement, value: string) => act(() => { setSelect.call(select, value); select.dispatchEvent(new Event("change", { bubbles: true })); });
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text || b.getAttribute("aria-label") === text)!;
const byLabel = (text: string) => {
  const label = [...host.querySelectorAll("label")].find((l) => l.textContent === text)!;
  return host.querySelector<HTMLInputElement>(`#${CSS.escape(label.htmlFor)}`) ?? label.querySelector("input")!;
};

describe("FormBuilder", () => {
  let latest: FormModel;
  function Harness({ phoneIsCheck = false }: { phoneIsCheck?: boolean }) {
    const [form, setForm] = useState<FormModel>(DEFAULT_V2.form);
    const [closes, setCloses] = useState("");
    const change = (next: FormModel) => {
      latest = next;
      setForm(next);
    };
    return <FormBuilder value={form} onChange={change} closesAtLocal={closes} onClosesAt={setCloses} phoneIsCheck={phoneIsCheck} errors={{}} />;
  }

  it("requests close is the editor's date picker and time field: no native datetime-local, the combined value goes up", () => {
    let closes = "";
    function Closes() {
      const [value, setValue] = useState("2026-10-24T10:00");
      closes = value;
      return <FormBuilder value={DEFAULT_V2.form} onChange={() => {}} closesAtLocal={value} onClosesAt={setValue} phoneIsCheck={false} errors={{}} />;
    }
    act(() => root.render(<Closes />));
    expect(host.querySelector('input[type="datetime-local"]')).toBeNull();
    const group = host.querySelector<HTMLElement>('[role="group"]')!;
    expect(group.textContent).toContain("Requests close");
    expect(group.textContent).toContain("Sat, 24 Oct 2026");
    const time = [...group.querySelectorAll("input")].find((i) => i.value === "10:00")!;
    type(time, "18:30");
    act(() => { time.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(closes).toBe("2026-10-24T18:30");
    act(() => [...group.querySelectorAll("button")].find((b) => b.textContent === "Clear")!.click());
    expect(closes).toBe("");
  });

  it("adds questions of every kind with stable UUIDs, bounded choices, required flag and reordering", () => {
    act(() => root.render(<Harness />));
    expect(host.textContent).toContain("Full name");
    expect(host.textContent).toContain("LinkedIn or website");
    act(() => button("+ Add question").click());
    act(() => button("+ Add question").click());
    expect(latest.questions).toHaveLength(2);
    const [q1, q2] = latest.questions;
    expect(q1!.id).toMatch(/^[0-9a-f-]{36}$/);
    type(host.querySelector<HTMLInputElement>('[data-q] input[type="text"], [data-q] input:not([type])')!, "Which panel?");
    expect(latest.questions[0]!.label).toBe("Which panel?");

    // A different kind is a different question: it gets a new ID and, for choices, two empty options.
    choose(host.querySelectorAll<HTMLSelectElement>("[data-q] select")[0]!, "single");
    const single = latest.questions[0]!;
    expect(single.kind).toBe("single");
    expect(single.id).not.toBe(q1!.id);
    expect("options" in single && single.options).toHaveLength(2);
    act(() => button("+ Add choice").click());
    expect("options" in latest.questions[0]! && latest.questions[0].options).toHaveLength(3);

    act(() => (host.querySelector<HTMLInputElement>('[data-q] input[type="checkbox"]')!).click());
    expect(latest.questions[0]!.required).toBe(true);

    act(() => button("Move question 2 up").click());
    expect(latest.questions.map((q) => q.id)).toEqual([q2!.id, single.id]);
    expect(button("Move question 1 up").disabled).toBe(true);
  });

  it("phone contact field: off / optional / required, replaced by one verified number when phone is a check", () => {
    act(() => root.render(<Harness />));
    const required = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => r.value === "required")!;
    act(() => required.click());
    expect(latest.fields.phone_number).toBe("required");
    act(() => root.render(<Harness phoneIsCheck />));
    expect(host.textContent).toContain("Required and verified");
  });

  it("stops at 20 questions", () => {
    act(() => root.render(<Harness />));
    for (let i = 0; i < 21; i++) act(() => button("+ Add question").click());
    expect(latest.questions).toHaveLength(20);
    expect(button("+ Add question").disabled).toBe(true);
  });
});

describe("VerificationSection", () => {
  let latest: EventChecks;
  function Harness({ caps = { phone: true, document: true, age: true, reason: null } }: { caps?: { phone: boolean; document: boolean; age: boolean; reason: string | null } }) {
    const [c, setC] = useState<EventChecks>(DEFAULT_V2.checks);
    const change = (next: EventChecks) => {
      latest = next;
      setC(next);
    };
    return <VerificationSection value={c} onChange={change} capabilities={caps} errors={{}} acceptedPolicyCounts={[{ policyVersion: 1, registrations: 12 }]} />;
  }

  it("baseline is fixed; extras and age ≥ N are independent; guests see what they will be asked", () => {
    act(() => root.render(<Harness />));
    expect(host.textContent).toContain("Always required");
    expect(host.textContent).toContain("Face · selfie with liveness");
    expect(host.textContent).toContain("No extra checks");
    const box = (name: string) => [...host.querySelectorAll("label")].find((l) => l.textContent?.startsWith(name))!.querySelector("input")!;
    act(() => box("Name from ID").click());
    act(() => box("Phone").click());
    expect(latest.required).toEqual(["phone", "name_from_id"]);
    act(() => byLabel("Minimum age").click());
    expect(latest.age_min).toBe(18);
    expect(host.textContent).toContain("Be 18 or older (from the date of birth on the ID)");
    expect(host.textContent).toContain("12 guests on version 1 keep the checks they accepted");
  });

  it("an unavailable provider feature is disabled with the reason", () => {
    act(() => root.render(<Harness caps={{ phone: false, document: true, age: true, reason: "Phone needs a first top-up on your Didit account." }} />));
    const phone = [...host.querySelectorAll("label")].find((l) => l.textContent?.startsWith("Phone"))!;
    expect(phone.querySelector("input")!.disabled).toBe(true);
    expect(phone.textContent).toContain("first top-up");
  });

  it("guest steps follow the workflow plan", () => {
    expect(guestSteps({ version: 1, required: [], max_age: {} })).toHaveLength(2);
    expect(guestSteps({ version: 1, required: ["phone"], age_min: 21, max_age: {} }).slice(2)).toEqual(["Confirm their phone number with an SMS code", "Pass an age check for 21+ (a quick selfie estimate; an ID is offered if it is borderline)"]);
  });
});

describe("DoorSection", () => {
  it("strictness and mode appear only with a kiosk", () => {
    let latest: EventDoor = { kiosk: false };
    function Harness() {
      const [d, setD] = useState<EventDoor>({ kiosk: false });
      const change = (next: EventDoor) => {
        latest = next;
        setD(next);
      };
      return <DoorSection value={d} onChange={change} errors={{}} />;
    }
    act(() => root.render(<Harness />));
    expect(host.textContent).not.toContain("Matching strictness");
    expect(host.textContent).toContain("Manual check-in never skips those checks");
    act(() => byLabel("Face kiosk at the door").click());
    expect(latest).toEqual({ kiosk: true, mode: "supervised", match_threshold: 80 });
    expect(host.textContent).toContain("Matching strictness");
    const strict = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => r.value === "strict")!;
    act(() => strict.click());
    expect(latest).toMatchObject({ mode: "strict" });
    const relaxed = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => r.value === "70")!;
    act(() => relaxed.click());
    expect(latest).toEqual({ kiosk: true, mode: "strict", match_threshold: 70 });
  });
});

describe("v2 model", () => {
  const v2 = (p: Partial<EditorV2> = {}): EditorV2 => ({ ...structuredClone(DEFAULT_V2), ...p });

  it("round-trips canonical editor documents without a legacy projection", () => {
    // Model v2 keeps question IDs and all question kinds supplied by the editor loader.
    const h = v2({descriptionMd:"## Event",door:{kiosk:true,mode:"supervised",match_threshold:80}, form:{...DEFAULT_V2.form,mode:"invite_only",questions:[{id:uuid(),kind:"yes_no",label:"Coming?",required:true}]},emails:{version:1,templates:{"M-13":{enabled:false}}}});
    expect(readV2(JSON.stringify(h))).toMatchObject(h);
    expect(readV2(JSON.stringify(h))!.form.questions[0]!.id).toBe(h.form.questions[0]!.id);
    expect(DEFAULT_V2.door).toEqual({kiosk:false});
  });

  it("validates questions, choices, consent, closing time, age, threshold and email overrides", () => {
    const e = validateV2(v2({
      form: { ...DEFAULT_V2.form, questions: [{ id: "a", label: " ", kind: "short", required: false }, { id: "b", label: "Pick", kind: "multi", required: true, options: [{ id: "o1", label: "Same" }, { id: "o2", label: "same" }] }], consent_text: "x".repeat(2001) },
      closesAtLocal: "2026-10-24T10:00",
      checks: { version: 1, required: [], age_min: 101, max_age: {} },
      door: { kiosk: true, mode: "supervised", match_threshold: 45 },
      emails: { version: 1, templates: { "M-06": { enabled: false }, "M-02": { enabled: true, subject: "Hi {{first_name}} {{ticket}}" } } },
    }), "2026-10-23T19:00");
    expect(e).toEqual({
      "q:a:label": "Write the question",
      "q:b:options": "Choices must be different",
      consent: "Keep it under 2000 characters",
      closesAt: "Requests must close before the event starts",
      age: "Use an age from 1 to 100",
      threshold: "Use 50–99",
      "email:M-06:enabled": "This notice can’t be turned off",
      "email:M-02:subject": "Unknown variable: {{ticket}}",
    });
    expect(unknownVariables("{{first_name}} {{event_name}} {{date}} {{venue}} {{maps_url}}")).toEqual([]);
    expect(editorialTextError("Hi {first_name}")).toBe("Write variables as {{first_name}}; other braces aren’t allowed");
    expect(editorialTextError("[map]({{maps_url}}) [site](https://didit.me)")).toBeNull();
    expect(editorialTextError("[x](http://didit.me)")).toBe("Links must start with https://");
    expect(editorialTextError("<script>x</script>")).toBe("Remove the HTML tags");
  });

  it("canonical checks: sorted, only relevant max-age keys", () => {
    expect(canonicalChecks({ version: 1, required: ["name_from_id", "phone"], max_age: { phone: 100, document: 200, age: 300 } })).toEqual({ version: 1, required: ["phone", "name_from_id"], max_age: { phone: 100, document: 200 } });
  });

  it("round-trips all v2 fields through FormData and groups errors by section", () => {
    const value = v2({ descriptionMd: "## Hi", form: { ...DEFAULT_V2.form, questions: [{ id: "q", label: "Company", kind: "long", required: true }, { id: "r", label: "Link", kind: "url", required: false }] } });
    const fd = new FormData();
    for (const [k, v] of Object.entries({ ...BCN_FORM, capacity: "150" })) if (typeof v === "string") fd.set(k, v);
    fd.set("v2", JSON.stringify(value));
    const read = readEventForm(fd);
    expect(read.v2).toMatchObject({ descriptionMd: "## Hi" });
    // Model v2 sends all question kinds directly, without hidden legacy fields.
    expect(read.v2!.form.questions).toEqual(value.form.questions);
    expect(read.v2!.door).toEqual(value.door);
    expect(read.v2!.emails).toEqual(value.emails);
    expect(toEventInput(read).v2).toEqual(read.v2);
    expect(readV2("{not json")).toBeUndefined();
    expect(readV2(JSON.stringify({ descriptionMd: "x" }))).toBeUndefined();
    expect(validateEventForm({ ...read, v2: { ...value, checks: { ...value.checks, age_min: 0 }, descriptionMd: "x".repeat(20_001) } })).toEqual({ verification: "Use an age from 1 to 100", descriptionMd: "Keep the description under 20,000 characters" });
  });

  it("dirty comparison ignores key order", () => {
    expect(sameValue({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
  });
});
