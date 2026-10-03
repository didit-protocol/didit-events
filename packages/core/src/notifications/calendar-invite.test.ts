import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
import { mail } from "../admission/shared.ts";
import type { Db } from "../db/index.ts";
import { queryable,withTx } from "../db/tx.ts";
import type { Registration } from "../domain/services.ts";
import { JobRegistry } from "../jobs.ts";
import { dispatchOutbox,OutboxRegistry } from "../outbox.ts";
import { resetDatabase,testDatabase } from "../testing/database.ts";
import { buildCalendarInvite,calendarAttachment,calendarUid,foldLine,icsText,type CalendarInviteInput } from "./calendar-invite.ts";
import { startFakeResend,type FakeResend } from "./fake-resend.ts";
import { notifyEventChanged,notifyHostCancellation,registerNotifications } from "./index.ts";

const NOW = new Date("2027-03-01T10:00:00.000Z");
const base: CalendarInviteInput = {
  method: "REQUEST", uid: calendarUid("2f0c1f6e-7a5d-4c38-9a1c-1f1b2c3d4e5f"), sequence: 0, now: NOW,
  startsAt: new Date("2027-03-10T18:00:00.000Z"), endsAt: new Date("2027-03-10T21:00:00.000Z"),
  summary: "AI Era; builders, founders & friends", venue: "Didit HQ", address: "Carrer de Pallars 99, Barcelona",
  geo: { lat: 41.3984, lng: 2.1969 }, url: "https://events.didit.me/e/ai-era", attendee: { email: "ana@example.test", name: "Ana \"Nana\"" },
};
/** Unfolds per RFC 5545 §3.1 and splits into content lines. */
const unfold = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n").filter(Boolean);
const prop = (ics: string, name: string) => unfold(ics).filter(l => l.startsWith(`${name}:`) || l.startsWith(`${name};`));

describe("iCalendar invite (RFC 5545)", () => {
  it("is a CRLF-only, folded, UTC REQUEST with organizer, accepted attendee, geo and a 1 h alarm", () => {
    const ics = buildCalendarInvite(base);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const lines = unfold(ics);
    expect(lines.slice(0, 6)).toEqual(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Didit//Didit Events//EN", "CALSCALE:GREGORIAN", "METHOD:REQUEST", "BEGIN:VEVENT"]);
    expect(lines).toContain("UID:2f0c1f6e-7a5d-4c38-9a1c-1f1b2c3d4e5f@events.didit.me");
    expect(lines).toContain("SEQUENCE:0");
    expect(lines).toContain("DTSTAMP:20270301T100000Z");
    expect(lines).toContain("DTSTART:20270310T180000Z");
    expect(lines).toContain("DTEND:20270310T210000Z");
    expect(lines).toContain("SUMMARY:AI Era\\; builders\\, founders & friends");
    expect(lines).toContain("LOCATION:Didit HQ\\, Carrer de Pallars 99\\, Barcelona");
    expect(lines).toContain("GEO:41.3984;2.1969");
    expect(lines).toContain("URL:https://events.didit.me/e/ai-era");
    expect(lines).toContain("ORGANIZER;CN=\"Didit Events\":mailto:events@example.com");
    expect(lines).toContain("ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE;CN=\"Ana Nana\":mailto:ana@example.test");
    expect(lines).toContain("STATUS:CONFIRMED");
    expect(prop(ics, "DESCRIPTION")[0]).toBe("DESCRIPTION:Your face is your ticket: look at the screen at the door to check in.\\n\\nEvent page: https://events.didit.me/e/ai-era");
    expect(lines.slice(lines.indexOf("BEGIN:VALARM"), lines.indexOf("END:VALARM") + 1)).toEqual(["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:AI Era\\; builders\\, founders & friends", "TRIGGER:-PT1H", "END:VALARM"]);
    // Every BEGIN has its END, in order.
    const stack: string[] = [];
    for (const l of lines) { if (l.startsWith("BEGIN:")) stack.push(l.slice(6)); if (l.startsWith("END:")) expect(stack.pop()).toBe(l.slice(4)); }
    expect(stack).toEqual([]);
  });
  it("CANCEL keeps the UID, marks the event cancelled and drops the alarm", () => {
    const ics = buildCalendarInvite({ ...base, method: "CANCEL", sequence: 2 });
    const lines = unfold(ics);
    expect(lines).toContain("METHOD:CANCEL");
    expect(lines).toContain("STATUS:CANCELLED");
    expect(lines).toContain("SEQUENCE:2");
    expect(lines).toContain(`UID:${base.uid}`);
    expect(lines).not.toContain("BEGIN:VALARM");
  });
  it("escapes TEXT and folds long lines at 75 octets without splitting UTF-8 characters", () => {
    expect(icsText("a\\b;c,d\r\ne\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
    const long = `SUMMARY:${"é".repeat(60)}`;
    const folded = foldLine(long);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every(p => p.startsWith(" "))).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
    expect(foldLine("short")).toBe("short");
    const ics = buildCalendarInvite({ ...base, summary: `Fiesta 🎉 ${"x".repeat(200)}`, geo: null, venue: null, address: null, attendee: { email: "a@b.test" } });
    expect(unfold(ics).find(l => l.startsWith("SUMMARY:"))).toBe(`SUMMARY:Fiesta 🎉 ${"x".repeat(200)}`);
    expect(unfold(ics).some(l => l.startsWith("GEO:") || l.startsWith("LOCATION:"))).toBe(false);
    expect(unfold(ics)).toContain("ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:a@b.test");
  });
  it("attaches as invite.ics with the text/calendar METHOD parameter", () => {
    const a = calendarAttachment("BEGIN:VCALENDAR\r\n", "REQUEST");
    expect(a).toEqual({ filename: "invite.ics", content: Buffer.from("BEGIN:VCALENDAR\r\n").toString("base64"), content_type: "text/calendar; charset=UTF-8; method=REQUEST" });
    expect(calendarAttachment("x", "CANCEL").content_type).toBe("text/calendar; charset=UTF-8; method=CANCEL");
  });
});

describe("calendar invite lifecycle (pglite)", () => {
  let db: Db, close: () => Promise<void>, resend: FakeResend, registry: OutboxRegistry;
  beforeAll(async () => { ({ db, close } = await testDatabase("pglite")); resend = await startFakeResend(); }, 60_000);
  beforeEach(async () => {
    await resetDatabase(db); resend.reset();
    registry = new OutboxRegistry();
    registerNotifications({ now: () => NOW, baseUrl: "https://events.example.test", resend: { apiKey: "re_test", apiUrl: resend.url }, db }, { outbox: registry, jobs: new JobRegistry() });
  });
  afterAll(async () => { await resend?.close(); await close?.(); });
  const q = () => queryable(db);
  const drain = async () => { while (await dispatchOutbox(db, registry)) { /* until idle */ } };

  async function setup() {
    const accountId = randomUUID(), eventId = randomUUID();
    await q().query("insert into accounts (id,email,first_name) values ($1,$2,'Ana')", [accountId, `${accountId}@example.test`]);
    await q().query(`insert into events (id,slug,name,starts_at,ends_at,capacity,status,venue,address,lat,lng) values ($1,$2,'AI Era',$3,$4,50,'published','Didit HQ','Carrer de Pallars 99, Barcelona',41.3984,2.1969)`,
      [eventId, `ev-${eventId.slice(0, 8)}`, new Date(NOW.getTime() + 10 * 86400_000), new Date(NOW.getTime() + 10 * 86400_000 + 3 * 3600_000)]);
    const [r] = await q().query<{ id: string }>("insert into registrations(legacy_imported,policy_version,form_version,event_id,account_id,admission) values(true,1,1,$1,$2,'approved') returning id", [eventId, accountId]);
    const registration = { id: r!.id, accountId, eventId } as Registration;
    return { accountId, eventId, registration };
  }
  const invites = () => resend.calls.map(c => {
    const attachments = (c.body.attachments ?? []) as { filename: string; content: string; content_type: string }[];
    return { subject: c.body.subject as string, attachments, ics: attachments[0] ? Buffer.from(attachments[0].content, "base64").toString("utf8") : null };
  });
  const seq = (ics: string | null) => unfold(ics ?? "").find(l => l.startsWith("SEQUENCE:"));

  it("M-06 carries the REQUEST; an update moves SEQUENCE once per change; a cancellation sends CANCEL with the same UID", async () => {
    const { eventId, registration, accountId } = await setup();
    await withTx(tx => mail(tx, "M-06", registration, "h1"), db);
    await withTx(tx => mail(tx, "M-06", registration, "h1"), db); // deduped: no new email, SEQUENCE unchanged
    await drain();
    let sent = invites();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.attachments[0]).toMatchObject({ filename: "invite.ics", content_type: "text/calendar; charset=UTF-8; method=REQUEST" });
    const lines = unfold(sent[0]!.ics!);
    expect(lines).toContain("METHOD:REQUEST");
    expect(lines).toContain(`UID:${registration.id}@events.didit.me`);
    expect(lines).toContain("SEQUENCE:0");
    expect(lines).toContain(`ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE;CN="Ana":mailto:${accountId}@example.test`);
    expect(lines).toContain("GEO:41.3984;2.1969");
    expect(lines).toContain("URL:https://events.example.test/e/ev-" + eventId.slice(0, 8));

    const before = { name: "AI Era", startsAt: new Date(NOW.getTime() + 10 * 86400_000), endsAt: new Date(NOW.getTime() + 10 * 86400_000 + 3 * 3600_000), venue: "Didit HQ", address: "Carrer de Pallars 99, Barcelona" };
    const moved = { ...before, startsAt: new Date(before.startsAt.getTime() + 3600_000) };
    await q().query("update events set starts_at=$2 where id=$1", [eventId, moved.startsAt]);
    expect(await withTx(tx => notifyEventChanged(tx, { eventId, before, after: moved }), db)).toBe(1);
    expect(await withTx(tx => notifyEventChanged(tx, { eventId, before, after: moved }), db)).toBe(0); // same change: deduped
    await drain();
    sent = invites();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.attachments[0]!.content_type).toBe("text/calendar; charset=UTF-8; method=REQUEST");
    expect(seq(sent[1]!.ics)).toBe("SEQUENCE:1");
    expect(unfold(sent[1]!.ics!)).toContain(`DTSTART:${moved.startsAt.toISOString().replace(/[-:]|\.\d{3}/g, "")}`);

    await q().query("update registrations set admission='cancelled_by_guest' where id=$1", [registration.id]);
    await withTx(tx => mail(tx, "M-20", registration, "h2", { kind: "cancelled" }), db);
    await drain();
    sent = invites();
    expect(sent).toHaveLength(3);
    expect(sent[2]!.attachments[0]).toMatchObject({ filename: "cancel.ics", content_type: "text/calendar; charset=UTF-8; method=CANCEL" });
    expect(unfold(sent[2]!.ics!)).toEqual(expect.arrayContaining(["METHOD:CANCEL", "STATUS:CANCELLED", "SEQUENCE:2", `UID:${registration.id}@events.didit.me`]));

    // Nothing left in the calendar: a second cancellation notice carries no CANCEL.
    await withTx(tx => notifyHostCancellation(tx, { eventId, registrationIds: [registration.id], occasion: "again" }), db);
    await drain();
    expect(invites()[3]!.attachments).toEqual([]);
    const [row] = await q().query<{ sequence: number; method: string }>("select sequence,method from calendar_invites where registration_id=$1", [registration.id]);
    expect(row).toEqual({ sequence: 2, method: "CANCEL" });

    // Approved again (re-join): same UID, next SEQUENCE.
    await q().query("update registrations set admission='approved' where id=$1", [registration.id]);
    await withTx(tx => mail(tx, "M-06", registration, "h3"), db);
    await drain();
    expect(unfold(invites()[4]!.ics!)).toEqual(expect.arrayContaining(["METHOD:REQUEST", "SEQUENCE:3", `UID:${registration.id}@events.didit.me`]));
  });

  it("an end-time-only change sends a REQUEST with the new DTEND; A→B→A→B sends every saved change, SEQUENCE always rising", async () => {
    const { eventId, registration } = await setup();
    await withTx(tx => mail(tx, "M-06", registration, "h1"), db);
    const startsAt = new Date(NOW.getTime() + 10 * 86400_000);
    const A = { name: "AI Era", startsAt, endsAt: new Date(startsAt.getTime() + 3 * 3600_000), venue: "Didit HQ", address: "Carrer de Pallars 99, Barcelona" };
    const B = { ...A, endsAt: new Date(startsAt.getTime() + 4 * 3600_000) };
    // A saved edit (B4's update): the row changes and the edit_version trigger bumps the revision, then the hook runs.
    const save = (from: typeof A, to: typeof A) => withTx(async tx => {
      await tx.query("update events set ends_at=$2,name=$3 where id=$1", [eventId, to.endsAt, to.name]);
      return notifyEventChanged(tx, { eventId, before: from, after: to });
    }, db);
    expect(await save(A, B)).toBe(1);
    await drain();
    let sent = invites();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.subject).toBe("Update: AI Era details changed");
    expect(unfold(sent[1]!.ics!)).toEqual(expect.arrayContaining(["METHOD:REQUEST", "SEQUENCE:1", `DTEND:${B.endsAt.toISOString().replace(/[-:]|\.\d{3}/g, "")}`]));
    expect(await save(B, A)).toBe(1);
    expect(await save(A, B)).toBe(1);
    // The same hook call again in the same revision is a duplicate.
    expect(await withTx(tx => notifyEventChanged(tx, { eventId, before: A, after: B }), db)).toBe(0);
    // A title-only change is an update too.
    expect(await save(B, { ...B, name: "AI Era II" })).toBe(1);
    await drain();
    sent = invites();
    expect(sent).toHaveLength(5);
    expect(sent.slice(1).map(i => seq(i.ics))).toEqual(["SEQUENCE:1", "SEQUENCE:2", "SEQUENCE:3", "SEQUENCE:4"]);
    // The final state (B) is what the last end-time REQUEST carries.
    expect(unfold(sent[3]!.ics!)).toContain(`DTEND:${B.endsAt.toISOString().replace(/[-:]|\.\d{3}/g, "")}`);
    expect(unfold(sent[4]!.ics!)).toContain("SUMMARY:AI Era II");
  });

  it("a withdrawal or host cancellation of a request that never had an invite carries no calendar part", async () => {
    const { eventId, registration } = await setup();
    await withTx(tx => mail(tx, "M-20", registration, "w1", { kind: "withdrawn" }), db);
    await withTx(tx => mail(tx, "M-21", registration, "w2"), db);
    await withTx(tx => notifyHostCancellation(tx, { eventId, registrationIds: [registration.id], occasion: "event-cancelled" }), db);
    await drain();
    expect(invites().map(i => i.attachments)).toEqual([[], [], []]);
    expect(await q().query("select 1 from calendar_invites")).toEqual([]);
  });

  it("host revocation and event cancellation (M-21) send CANCEL once per occasion", async () => {
    const { eventId, registration } = await setup();
    await withTx(tx => mail(tx, "M-06", registration, "h1"), db);
    expect(await withTx(tx => notifyHostCancellation(tx, { eventId, registrationIds: [registration.id], occasion: "event-cancelled" }), db)).toBe(1);
    expect(await withTx(tx => notifyHostCancellation(tx, { eventId, registrationIds: [registration.id], occasion: "event-cancelled" }), db)).toBe(0);
    await drain();
    const sent = invites();
    expect(sent).toHaveLength(2);
    expect(unfold(sent[1]!.ics!)).toEqual(expect.arrayContaining(["METHOD:CANCEL", "SEQUENCE:1"]));
  });
});
