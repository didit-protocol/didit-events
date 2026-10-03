import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FRAMES_APP, FrameView, getFrame } from "../../../frames";
import { EventForm } from "./EventForm";
import { BCN_FORM, BCN_WELCOME, EMPTY_EVENT, ERROR_FORM, FORM_STATES } from "./fixtures";
import { formFrames } from "./frames";
import type { EventFormValues } from "./types";
import {
  END_BEFORE_START,
  composeAddress,
  effectiveAddress,
  searchTimezones,
  splitAddress,
  toIsoDate,
  utcOffsetLabel,
  validateEventField,
  fixFieldsMessage,
  isPristine,
  parseDate,
  parseTime,
  previewOf,
  questionMeta,
  readEventForm,
  savedLabel,
  timezoneLabel,
  toEventInput,
  validateEventForm,
} from "./validate";

const v = (patch: Partial<EventFormValues>): EventFormValues => ({ ...BCN_FORM, ...patch });
const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

describe("validateEventForm (A-03b messages)", () => {
  it("accepts the Barcelona Office Opening", () => {
    expect(validateEventForm(BCN_FORM)).toEqual({});
  });

  it("A-03b: exactly the three drawn errors", () => {
    expect(validateEventForm(ERROR_FORM)).toEqual({ name: "Give the event a name", end: END_BEFORE_START, capacity: "At least 1" });
    expect(fixFieldsMessage(3)).toBe("Fix 3 fields before saving.");
    expect(fixFieldsMessage(1)).toBe("Fix 1 field before saving.");
  });

  it.each([
    [{ name: "   " }, "name", "Give the event a name"],
    [{ name: "x".repeat(121) }, "name", "Keep the name under 120 characters"],
    [{ date: "" }, "date", "Pick a date"],
    [{ date: "31 Feb 2026" }, "date", "Use a date like 23 Oct 2026"],
    [{ date: "tomorrow" }, "date", "Use a date like 23 Oct 2026"],
    [{ start: "" }, "start", "Add a start time"],
    [{ start: "25:00" }, "start", "Use a time like 19:00"],
    [{ end: "" }, "end", "Add an end time"],
    [{ end: "7:75" }, "end", "Use a time like 23:00"],
    [{ end: "7pm" }, "end", "End must be after start"],
    [{ end: "19:00" }, "end", "End must be after start"],
    [{ end: "18:00" }, "end", END_BEFORE_START],
    [{ end: "00:30" }, "end", END_BEFORE_START],
    [{ timezone: "Mars/Olympus" }, "timezone", "Pick a timezone"],
    [{ venue: "" }, "venue", "Add a venue"],
    [{ address: " ", street: "", city: "", postalCode: "", country: "" }, "address", "Add the address"],
    [{ venue: "x".repeat(121) }, "venue", "Keep the venue under 120 characters"],
    [{ street: "" }, "street", "Add the street"],
    [{ city: " " }, "city", "Add the city"],
    [{ postalCode: "08@18" }, "postalCode", "Use a postal code like 08018"],
    [{ country: "Atlantis" }, "country", "Pick a country"],
    [{ placeId: "ChIJ5TCOcRaYpBIRCmZHTz37sEQ", lat: "41.4", lng: "", mapsUrl: "https://maps.google.com/?cid=1" }, "address", "Pick the location again"],
    [{ placeId: "ChIJ5TCOcRaYpBIRCmZHTz37sEQ", lat: "41.4", lng: "2.19", mapsUrl: "https://evil.example/?cid=1" }, "address", "Pick the location again"],
    // Canonical questions carry UUIDs and report field-level validation errors.
    [{ v2: { ...BCN_FORM.v2!, form: { ...BCN_FORM.v2!.form, questions: [{ id: "00000000-0000-4000-8000-000000000001", label: " ", kind: "short", required: false }] } } }, "registration", "Write the question"],
    [{ capacity: "0" }, "capacity", "At least 1"],
    [{ capacity: "" }, "capacity", "At least 1"],
    [{ capacity: "-3" }, "capacity", "At least 1"],
    [{ capacity: "12.5" }, "capacity", "At least 1"],
    [{ capacity: "10001" }, "capacity", "At most 10,000"],
    [{ description: "x".repeat(501) }, "description", "Keep it under 500 characters"],
  ] as const)("%j → %s: %s", (patch, field, message) => {
    expect(validateEventForm(v(patch as Partial<EventFormValues>))).toEqual({ [field]: message });
  });

  it("checks the cover type and size", () => {
    expect(validateEventForm(BCN_FORM, { size: 1000, type: "image/gif" })).toEqual({ cover: "Use a JPG or PNG" });
    expect(validateEventForm(BCN_FORM, { size: 6 * 1024 * 1024, type: "image/png" })).toEqual({ cover: "Up to 5 MB" });
    expect(validateEventForm(BCN_FORM, { size: 0, type: "" })).toEqual({});
  });
});

describe("form helpers", () => {
  it("parses dates and times", () => {
    expect(parseDate("23 Oct 2026")).toEqual({ y: 2026, m: 10, d: 23 });
    expect(parseDate("2026-10-23")).toEqual({ y: 2026, m: 10, d: 23 });
    expect(parseDate("23 october 2026")).toEqual({ y: 2026, m: 10, d: 23 });
    expect(parseDate("30 Feb 2026")).toBeNull();
    expect(parseTime("9:05")).toBe(545);
    expect(parseTime("24:00")).toBeNull();
  });

  it("labels the timezone with the event's summer or winter name", () => {
    expect(timezoneLabel("Europe/Madrid", parseDate("23 Oct 2026"))).toBe("Europe/Madrid (CEST)");
    expect(timezoneLabel("Europe/Madrid", parseDate("4 Dec 2026"))).toBe("Europe/Madrid (CET)");
    expect(timezoneLabel("Europe/Madrid", null)).toBe("Europe/Madrid (CEST)");
    expect(timezoneLabel("America/New_York", parseDate("4 Dec 2026"))).toBe("America/New_York (EST)");
  });

  it("builds the guest page preview from the inputs", () => {
    expect(previewOf(BCN_FORM)).toEqual({ name: "Barcelona Office Opening", when: "Fri 23 Oct 2026 · 19:00–23:00", where: "Didit HQ, Carrer de Pallars 99" });
    expect(previewOf(EMPTY_EVENT)).toEqual({ name: null, when: null, where: null });
    expect(previewOf(v({ end: "18:00" })).when).toBe("Fri 23 Oct 2026 · 19:00");
  });

  it("round-trips FormData and maps to the service input", () => {
    const fd = new FormData();
    for (const k of ["name", "date", "start", "end", "timezone", "venue", "address", "street", "city", "postalCode", "country", "placeId", "lat", "lng", "mapsUrl", "capacity", "description"] as const) fd.set(k, BCN_FORM[k]);
    fd.set("requestForm", "on");
    fd.set("welcomeEmail", "on");
    fd.set("threshold", "80");
    fd.set("questions", JSON.stringify(BCN_FORM.questions));
    // The editor posts canonical v2 JSON instead of projecting it through hidden legacy fields.
    fd.set("v2", JSON.stringify(BCN_FORM.v2));
    expect(readEventForm(fd)).toMatchObject(BCN_FORM);
    expect(toEventInput(BCN_FORM)).toMatchObject({ startsAtLocal: "2026-10-23T19:00", endsAtLocal: "2026-10-23T23:00", capacity: 150, matchThreshold: 80 });
    fd.set("threshold", "55");
    fd.set("questions", "not json");
    fd.delete("welcomeEmail");
    expect(readEventForm(fd)).toMatchObject({ threshold: 80, questions: [], welcomeEmail: false, v2: BCN_FORM.v2 });
  });

  it("question meta, saved label and pristine check", () => {
    expect(BCN_FORM.questions.map(questionMeta)).toEqual(["Short text · required", "Short text"]);
    expect(savedLabel("2026-10-08T17:30:00+02:00", new Date("2026-10-08T17:30:20+02:00"))).toBe("Saved · just now");
    expect(savedLabel("2026-10-08T17:30:00+02:00", new Date("2026-10-08T17:33:10+02:00"))).toBe("Saved · 3 min ago");
    expect(isPristine(EMPTY_EVENT, EMPTY_EVENT)).toBe(true);
    expect(isPristine({ ...EMPTY_EVENT, name: "B" }, EMPTY_EVENT)).toBe(false);
  });
});

describe("EventForm states", () => {
  const noop = async () => FORM_STATES.empty;
  const render = (state: keyof typeof FORM_STATES, extra: { mode?: "new" | "edit"; pending?: boolean } = {}) =>
    decode(
      renderToStaticMarkup(
        <EventForm mode={extra.mode ?? "new"} crumb="New event" cancelHref="/admin" action={noop} initialState={FORM_STATES[state]} welcome={BCN_WELCOME} forcePending={extra.pending} now={new Date("2026-10-08T17:30:05+02:00")} />,
      ),
    );

  it("A-03a: Create event is disabled on the untouched form; the preview shows placeholders", () => {
    const html = render("empty");
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Create event<\/button>/);
    expect(html).toContain("Event name</span>");
    expect(html).toContain("Date · Venue");
    expect(html).not.toContain("role=\"alert\"");
  });

  it("A-03b: banner, invalid fields and messages", () => {
    const html = render("errors");
    expect(html).toContain("Fix 3 fields before saving.");
    for (const m of ["Give the event a name", "End must be after start", "At least 1"]) expect(html).toContain(m);
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(3);
    expect(html).toMatch(/<button type="submit"(?![^>]*disabled)[^>]*>Create event<\/button>/);
  });

  it("A-03c: Saving… with a busy button and read-only fields", () => {
    const html = render("saving", { pending: true });
    expect(html).toContain("Saving…");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain(`readOnly="" name="name" value="Barcelona Office Opening"`);
  });

  it("A-03d: Edit event, saved just now, Save changes", () => {
    const html = render("saved", { mode: "edit" });
    expect(html).toContain(">Edit event</h1>");
    expect(html).toContain("✓ Saved · just now");
    expect(html).toContain(">Save changes</button>");
    // v2 editor: six sections on one page; the loader supplies canonical questions and door settings.
    for (const label of ["Details", "Description", "Registration form", "Verification", "Door", "Emails"]) expect(html).toContain(`>${label}</a>`);
    const v2 = JSON.parse(html.split('name="v2" value="')[1]!.split('"/>')[0]!);
    expect(v2.form.questions.map((q: { label: string; required: boolean }) => [q.label, q.required])).toEqual([["Company", true], ["Role", false]]);
    expect(v2.door).toEqual({ kiosk: true, mode: "supervised", match_threshold: 80 });
  });
});

describe("A-03 frames", () => {
  it("registers A-03a–d at 1440×1320 with the design labels", () => {
    expect(formFrames.map((f) => f.code)).toEqual(["A-03a", "A-03b", "A-03c", "A-03d"]);
    const labels = formFrames.map((f) => /data-screen-label="([^"]+)"/.exec(renderToStaticMarkup(<>{f.render()}</>))?.[1]);
    expect(labels).toEqual(["A-03 New event / empty", "A-03 New event / validation errors", "A-03 New event / saving", "A-03 Edit event / saved"]);
    for (const f of formFrames) {
      expect(f.viewport).toEqual({ w: 1440, h: 1320 });
      const html = renderToStaticMarkup(<FrameView app={FRAMES_APP} code={f.code} />);
      expect(getFrame(f.code, FRAMES_APP)).toBeDefined();
      expect(html).toContain("width:1440px");
    }
  });
});

describe("A-03 field rules (shared by the client form and the server actions)", () => {
  it("times: typed entries normalise the same way the TimeField does", () => {
    expect(parseTime("7pm")).toBe(19 * 60);
    expect(parseTime("1930")).toBe(19 * 60 + 30);
    expect(validateEventForm(v({ start: "7pm", end: "11pm" }))).toEqual({});
    expect(toEventInput(v({ start: "7pm", end: "10:30 pm" }))).toMatchObject({ startsAtLocal: "2026-10-23T19:00", endsAtLocal: "2026-10-23T22:30" });
  });

  it("dates: the picker's ISO value and the older '23 Oct 2026' text both validate and map to the same day", () => {
    expect(toIsoDate("23 Oct 2026")).toBe("2026-10-23");
    expect(toIsoDate("2026-10-23")).toBe("2026-10-23");
    expect(toIsoDate("nope")).toBe("");
    expect(toEventInput(v({ date: "23 Oct 2026" })).startsAtLocal).toBe(toEventInput(v({ date: "2026-10-23" })).startsAtLocal);
  });

  it("addresses: compose, split legacy one-liners, and pick the effective address", () => {
    expect(composeAddress({ street: "Carrer de Pallars 99", city: "Barcelona", postalCode: "08018", country: "Spain" })).toBe("Carrer de Pallars 99, 08018 Barcelona, Spain");
    expect(splitAddress("Carrer de Pallars 99, 08018 Barcelona")).toEqual({ street: "Carrer de Pallars 99", postalCode: "08018", city: "Barcelona", country: "" });
    expect(splitAddress("1 Market St, Floor 3, San Francisco 94105, United States")).toEqual({ street: "1 Market St, Floor 3", city: "San Francisco", postalCode: "94105", country: "United States" });
    expect(splitAddress("Lisbon")).toEqual({ street: "Lisbon", city: "", postalCode: "", country: "" });
    // A legacy address with no parts still saves as typed.
    const legacy = v({ street: "", city: "", postalCode: "", country: "", address: "Didit HQ rooftop" });
    expect(validateEventForm(legacy)).toEqual({});
    expect(effectiveAddress(legacy)).toBe("Didit HQ rooftop");
    expect(toEventInput(BCN_FORM)).toMatchObject({ address: "Carrer de Pallars 99, 08018 Barcelona, Spain", placeId: null, lat: null, lng: null, mapsUrl: null });
  });

  it("a picked Google place keeps its formatted address and coordinates", () => {
    const place = v({ placeId: "ChIJ5TCOcRaYpBIRCmZHTz37sEQ", lat: "41.4036", lng: "2.1916", mapsUrl: "https://maps.google.com/?cid=4949212542133135882", address: "Carrer de Pallars, 99, Sant Martí, 08018 Barcelona, Spain", street: "Carrer de Pallars, 99", country: "Spain" });
    expect(validateEventForm(place)).toEqual({});
    expect(toEventInput(place)).toMatchObject({ address: "Carrer de Pallars, 99, Sant Martí, 08018 Barcelona, Spain", placeId: "ChIJ5TCOcRaYpBIRCmZHTz37sEQ", lat: 41.4036, lng: 2.1916, mapsUrl: "https://maps.google.com/?cid=4949212542133135882" });
  });

  it("capacity: the stepper's grouped display never reaches the server as text", () => {
    const fd = new FormData();
    fd.set("capacity", "1,200");
    expect(readEventForm(fd).capacity).toBe("1200");
  });

  it("timezones: searchable by city, id or abbreviation, with the UTC offset of the event day", () => {
    expect(searchTimezones("madrid").map((z) => z.id)).toEqual(["Europe/Madrid"]);
    expect(searchTimezones("New York").map((z) => z.id)).toEqual(["America/New_York"]);
    expect(searchTimezones("tokyo").map((z) => z.id)).toEqual(["Asia/Tokyo"]);
    expect(searchTimezones("EDT").map((z) => z.id)).toEqual(["America/New_York", "America/Toronto"]);
    expect(utcOffsetLabel("Europe/Madrid", parseDate("23 Oct 2026"))).toBe("UTC+02:00");
    expect(utcOffsetLabel("Europe/Madrid", parseDate("4 Dec 2026"))).toBe("UTC+01:00");
    expect(utcOffsetLabel("America/New_York", parseDate("4 Dec 2026"))).toBe("UTC-05:00");
    expect(utcOffsetLabel("UTC", null)).toBe("UTC");
  });

  it("client and server agree: every blur message equals the full validation's message for that field", () => {
    const samples: Partial<EventFormValues>[] = [ERROR_FORM, { start: "25:00" }, { end: "01:00" }, { date: "31 Feb 2026" }, { street: "", city: "" }, { capacity: "abc" }, { timezone: "Mars/Olympus" }, { venue: "" }];
    for (const patch of samples) {
      const values = v(patch);
      const server = validateEventForm(values);
      for (const field of Object.keys(server) as (keyof typeof server)[]) expect(validateEventField(field, values)).toBe(server[field]);
      // What the server action reads back from the posted form is validated identically.
      const fd = new FormData();
      for (const [k, val] of Object.entries(values)) if (typeof val === "string") fd.set(k, val);
      fd.set("questions", JSON.stringify(values.questions));
      if (values.requestForm) fd.set("requestForm", "on");
      if (values.welcomeEmail) fd.set("welcomeEmail", "on");
      fd.set("threshold", String(values.threshold));
      expect(validateEventForm(readEventForm(fd))).toEqual(server);
    }
  });
});
