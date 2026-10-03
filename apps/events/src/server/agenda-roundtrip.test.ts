import { Events } from "@didit-events/core/admission/events";
import { queryable } from "@didit-events/core/db/tx";
import { agendaItems } from "@didit-events/core/notifications/lifecycle";
import { testDatabase } from "@didit-events/core/testing/database";
import { testStaffSession } from "@didit-events/core/testing/staff-session";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agendaRowsOf, type AgendaRow } from "../admin/form/editor";
import { BCN_FORM } from "../admin/form/fixtures";
import type { EventFormValues } from "../admin/form/types";
import { readEventForm, toEventInput, validateEventForm } from "../admin/form/validate";
import { eventInput, localInstant, publicAgenda, publicEvent } from "./b4-views";

let database: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { database = await testDatabase(process.env.TEST_DATABASE_URL ? "postgres" : "pglite"); }, 60000);
afterAll(async () => { await database?.close(); });

/** What the browser posts: the A-03 fields plus the v2 JSON (as EventForm's hidden inputs do). */
function post(values: EventFormValues): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) if (k !== "v2" && k !== "questions" && typeof v === "string") fd.set(k, v);
  fd.set("v2", JSON.stringify(values.v2));
  return fd;
}
const formInput = (values: EventFormValues) => {
  const read = readEventForm(post(values));
  expect(validateEventForm(read)).toEqual({});
  return eventInput(toEventInput(read));
};
/** One staff session per database (the fixture inserts the staff row). */
let staff: ReturnType<typeof makeActor> | undefined;
const makeActor = async () => { const session = await testStaffSession(database.db); return session.requireStaff(session.cookie); };
const staffActor = () => (staff ??= makeActor());
const shown = (agenda: unknown) => agendaRowsOf(agenda, "Europe/Madrid").map((r) => `${r.time} ${r.label}`);

describe("agenda through create and save", () => {
  it("rows are stored as [{at,label}] instants in the event's zone; edit, reorder and remove save in order; page and email follow", async () => {
    const actor = await staffActor();
    const events = new Events(database.db);
    const rows: AgendaRow[] = [
      { id: "a1", time: "19:00", label: "Doors" },
      { id: "a2", time: "20:00", label: " Welcome " },
      { id: "a3", time: "20:30", label: "Panel", emphasis: true },
    ];
    const values: EventFormValues = { ...BCN_FORM, date: "2026-10-23", v2: { ...BCN_FORM.v2!, agenda: rows } };

    // Create (A-03 "Create event").
    const created = await events.create(actor, { ...formInput(values), slug: "agenda-roundtrip" });
    // Madrid is UTC+2 on 23 Oct 2026; labels are trimmed; editor ids are not stored.
    expect(created.agenda).toEqual([
      { at: "2026-10-23T17:00:00.000Z", label: "Doors" },
      { at: "2026-10-23T18:00:00.000Z", label: "Welcome" },
      { at: "2026-10-23T18:30:00.000Z", label: "Panel", emphasis: true },
    ]);
    // The edit loader reopens the same rows.
    const reopened = agendaRowsOf(created.agenda, created.timezone);
    expect(reopened.map(({ time, label, emphasis }) => ({ time, label, ...(emphasis ? { emphasis } : {}) }))).toEqual([
      { time: "19:00", label: "Doors" }, { time: "20:00", label: "Welcome" }, { time: "20:30", label: "Panel", emphasis: true },
    ]);

    // Save (A-03 "Save changes"): edit one, move the panel first, remove Doors, add Drinks.
    const edited: AgendaRow[] = [reopened[2]!, { ...reopened[1]!, label: "Welcome from Alberto" }, { id: "new", time: "22:00", label: "Drinks" }];
    const saved = await events.update(actor, created.id, { ...formInput({ ...values, v2: { ...values.v2!, agenda: edited } }), expectedVersion: created.editVersion });
    expect(shown(saved.agenda)).toEqual(["20:30 Panel", "20:00 Welcome from Alberto", "22:00 Drinks"]);

    // Public page: same order, emphasis kept. Day-before email: HH:mm in the event's zone.
    expect(publicEvent(saved).agenda).toEqual([
      { at: "2026-10-23T18:30:00.000Z", label: "Panel", emphasis: true },
      { at: "2026-10-23T18:00:00.000Z", label: "Welcome from Alberto" },
      { at: "2026-10-23T20:00:00.000Z", label: "Drinks" },
    ]);
    expect(agendaItems(saved.agenda, saved.timezone)).toEqual([{ t: "20:30", l: "Panel" }, { t: "20:00", l: "Welcome from Alberto" }, { t: "22:00", l: "Drinks" }]);

    // Clearing the agenda saves [] (the public page hides the section).
    const cleared = await events.update(actor, created.id, { ...formInput({ ...values, v2: { ...values.v2!, agenda: [] } }), expectedVersion: saved.editVersion });
    expect(cleared.agenda).toEqual([]);
    expect(publicEvent(cleared).agenda).toEqual([]);

    // A stale edit version is refused (edit-version conflict covers the agenda too).
    await expect(events.update(actor, created.id, { ...formInput(values), expectedVersion: saved.editVersion })).rejects.toThrow("context_changed");
  });

  it("the server refuses what the editor refuses: over 30 rows or a label over 120 characters", () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ id: `r${i}`, time: "20:00", label: `Item ${i}` }));
    expect(() => eventInput(toEventInput({ ...BCN_FORM, v2: { ...BCN_FORM.v2!, agenda: many } }))).toThrow();
    expect(() => eventInput(toEventInput({ ...BCN_FORM, v2: { ...BCN_FORM.v2!, agenda: [{ id: "x", time: "20:00", label: "a".repeat(121) }] } }))).toThrow();
  });

  it("an optional until is stored as endAt; page and emails show the range; the server refuses an end before the start", async () => {
    const actor = await staffActor();
    const rows: AgendaRow[] = [{ id: "a1", time: "19:10", until: "20:00", label: "Talk" }, { id: "a2", time: "20:00", label: "Drinks" }];
    const values: EventFormValues = { ...BCN_FORM, date: "2026-10-23", v2: { ...BCN_FORM.v2!, agenda: rows } };
    const created = await new Events(database.db).create(actor, { ...formInput(values), slug: "agenda-until" });
    expect(created.agenda).toEqual([{ at: "2026-10-23T17:10:00.000Z", endAt: "2026-10-23T18:00:00.000Z", label: "Talk" }, { at: "2026-10-23T18:00:00.000Z", label: "Drinks" }]);
    expect(agendaRowsOf(created.agenda, created.timezone).map(({ time, until, label }) => ({ time, until, label }))).toEqual([{ time: "19:10", until: "20:00", label: "Talk" }, { time: "20:00", until: undefined, label: "Drinks" }]);
    expect(publicEvent(created).agenda).toEqual([{ at: "2026-10-23T17:10:00.000Z", endAt: "2026-10-23T18:00:00.000Z", label: "Talk" }, { at: "2026-10-23T18:00:00.000Z", label: "Drinks" }]);
    expect(agendaItems(created.agenda, created.timezone)).toEqual([{ t: "19:10–20:00", l: "Talk" }, { t: "20:00", l: "Drinks" }]);
    expect(() => eventInput(toEventInput({ ...BCN_FORM, v2: { ...BCN_FORM.v2!, agenda: [{ id: "x", time: "20:00", until: "19:00", label: "Backwards" }] } }))).toThrow();
  });

  it("an item after midnight (and a range across midnight) keeps its date and endAt through load and save", async () => {
    const actor = await staffActor();
    const events = new Events(database.db);
    const values: EventFormValues = { ...BCN_FORM, date: "2026-10-23", v2: { ...BCN_FORM.v2!, agenda: [{ id: "a1", time: "20:00", label: "Doors" }] } };
    const created = await events.create(actor, { ...formInput(values), slug: "agenda-midnight" });
    // Stored by another writer (or an earlier save): DJ 23:30–00:30 and an after-party at 01:00 the next day (Madrid, UTC+2).
    const stored = [
      { at: "2026-10-23T18:00:00.000Z", label: "Doors" },
      { at: "2026-10-23T21:30:00.000Z", endAt: "2026-10-23T22:30:00.000Z", label: "DJ" },
      { at: "2026-10-23T23:00:00.000Z", endAt: "2026-10-24T00:00:00.000Z", label: "After-party" },
    ];
    const [row] = await queryable(database.db).query<{ edit_version: number }>("update events set agenda=$2::jsonb where id=$1 returning edit_version", [created.id, JSON.stringify(stored)]);
    const reopened = agendaRowsOf(stored, created.timezone, created.startsAt);
    expect(reopened.map(({ time, until, day, untilDay, label }) => ({ time, until, day, untilDay, label }))).toEqual([
      { time: "20:00", until: undefined, day: undefined, untilDay: undefined, label: "Doors" },
      { time: "23:30", until: "00:30", day: undefined, untilDay: 1, label: "DJ" },
      { time: "01:00", until: "02:00", day: 1, untilDay: undefined, label: "After-party" },
    ]);
    // The editor accepts the range across midnight; saving changes nothing.
    const saved = await events.update(actor, created.id, { ...formInput({ ...values, v2: { ...values.v2!, agenda: reopened } }), expectedVersion: row!.edit_version });
    expect(saved.agenda).toEqual(stored);
    // A row posted through the form (JSON) keeps its day too.
    expect(readEventForm(post({ ...values, v2: { ...values.v2!, agenda: reopened } })).v2!.agenda!.map(r => [r.day, r.untilDay])).toEqual([[undefined, undefined], [undefined, 1], [1, undefined]]);
  });

  it("the page only shows well-formed {at,label} items", () => {
    expect(publicAgenda([{ at: "2026-10-23T17:00:00.000Z", label: "Doors" }, { time: "18:30", title: "Old" }, { at: "nope", label: "x" }, { at: "2026-10-23T17:00:00.000Z", label: " " }, null])).toEqual([{ at: "2026-10-23T17:00:00.000Z", label: "Doors" }]);
    expect(publicAgenda("x")).toEqual([]);
    expect(publicAgenda([{ at: "2026-10-23T17:10:00.000Z", endAt: "2026-10-23T18:00:00.000Z", label: "Talk" }, { at: "2026-10-23T17:10:00.000Z", endAt: "2026-10-23T17:00:00.000Z", label: "Odd" }])).toEqual([
      { at: "2026-10-23T17:10:00.000Z", endAt: "2026-10-23T18:00:00.000Z", label: "Talk" }, { at: "2026-10-23T17:10:00.000Z", label: "Odd" },
    ]);
  });

  it("DST fall-back overlap: unchanged items keep their stored instants; edited ones take the earlier offset", () => {
    // Madrid falls back on 25 Oct 2026 at 03:00 CEST → 02:00 CET: 02:30 local is 00:30Z and again 01:30Z.
    expect(localInstant("2026-10-25T02:30", "Europe/Madrid").toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(localInstant("2026-10-25T01:59", "Europe/Madrid").toISOString()).toBe("2026-10-24T23:59:00.000Z");
    expect(localInstant("2026-10-25T03:00", "Europe/Madrid").toISOString()).toBe("2026-10-25T02:00:00.000Z");
    expect(() => localInstant("2026-03-29T02:30", "Europe/Madrid")).toThrow("InvalidLocalTime");
    const values: EventFormValues = { ...BCN_FORM, date: "2026-10-24", start: "22:00", end: "23:30" };
    const startsAt = new Date("2026-10-24T20:00:00.000Z");
    const save = (rows: AgendaRow[]) => formInput({ ...values, v2: { ...values.v2!, agenda: rows } }).agenda;
    for (const stored of [
      [{ at: "2026-10-25T00:30:00.000Z", endAt: "2026-10-25T00:45:00.000Z", label: "First pass" }],
      [{ at: "2026-10-25T01:30:00.000Z", endAt: "2026-10-25T01:45:00.000Z", label: "Second pass" }],
      [{ at: "2026-10-25T00:30:00.000Z", endAt: "2026-10-25T01:45:00.000Z", label: "Across the change" }],
    ]) {
      const reopened = agendaRowsOf(stored, "Europe/Madrid", startsAt);
      expect(save(reopened)).toEqual(stored);
      // A label-only edit keeps the instants too.
      expect(save(reopened.map((r) => ({ ...r, label: "Renamed" })))).toEqual(stored.map((x) => ({ ...x, label: "Renamed" })));
    }
    // An edited time is re-derived (earlier offset), and so is a stored instant that no longer shows the posted time.
    const [row] = agendaRowsOf([{ at: "2026-10-25T01:30:00.000Z", endAt: "2026-10-25T01:45:00.000Z", label: "Moved" }], "Europe/Madrid", startsAt);
    expect(save([{ ...row!, time: "02:35" }])).toEqual([{ at: "2026-10-25T00:35:00.000Z", endAt: "2026-10-25T01:45:00.000Z", label: "Moved" }]);
    expect(save([{ ...row!, at: "2026-10-25T05:00:00.000Z" }])).toEqual([{ at: "2026-10-25T00:30:00.000Z", endAt: "2026-10-25T01:45:00.000Z", label: "Moved" }]);
  });
});
