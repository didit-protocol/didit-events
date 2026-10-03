import { contactEmail } from "../contact-email.ts";
/**
 * v5 calendar invites (Luma-style): approved guests get an iCalendar REQUEST attached to their email, so Gmail, Apple
 * Mail and Outlook show it as an invitation and add it to the calendar. Every later message about the same place uses
 * the same UID (`<registrationId>@events.didit.me`) with a higher SEQUENCE: a REQUEST updates the entry (time or venue
 * change), a CANCEL removes it (guest cancels, host revokes, event cancelled).
 *
 * The SEQUENCE lives in `calendar_invites` (one row per registration). It is taken inside the caller's transaction,
 * stored in the outbox payload, and only committed when the outbox row is new, so a deduped email never moves it.
 */
import type { Tx } from "../db/tx.ts";

export type CalendarMethod = "REQUEST" | "CANCEL";
/**
 * The guest emails that carry an invite: "You're in" (approval) adds the event to the calendar; a cancellation of an
 * approved place removes it. Event changes (M-16 REQUEST) and event cancellation (M-21 CANCEL) attach theirs in lifecycle.
 */
export const CALENDAR_METHOD_BY_CODE = { "M-06": "REQUEST", "M-16": "REQUEST", "M-20": "CANCEL", "M-21": "CANCEL" } as const satisfies Record<string, CalendarMethod>;
export const calendarMethodFor = (code: string): CalendarMethod | null =>
  (CALENDAR_METHOD_BY_CODE as Record<string, CalendarMethod>)[code] ?? null;
/** Stored in the email payload (`data.calendar`); the .ics body is built at send time from the current event row. */
export interface CalendarRef { registrationId: string; method: CalendarMethod; sequence: number }

export const CALENDAR_ORGANIZER = { name: "Didit Events", get email() { return contactEmail(); } } as const;
export const calendarUid = (registrationId: string): string => `${registrationId}@events.didit.me`;

export interface CalendarInviteInput {
  method: CalendarMethod;
  uid: string;
  sequence: number;
  /** DTSTAMP (the instant this version of the invite was produced). */
  now: Date;
  startsAt: Date;
  endsAt: Date;
  summary: string;
  venue: string | null;
  address: string | null;
  geo?: { lat: number; lng: number } | null;
  url: string;
  attendee: { email: string; name?: string };
}

/** RFC 5545 §3.3.5 UTC form: 20270301T100000Z. */
export const icsStamp = (at: Date): string => at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
import { icsText } from "../ics.ts";
export { icsText } from "../ics.ts";
/** Quoted parameter value (§3.2): DQUOTE and control characters are not allowed inside, so they are removed. */
const icsParam = (value: string): string => `"${value.replace(/["\p{Cc}]/gu, "").trim()}"`;
const mailto = (email: string): string => `mailto:${email.replace(/[\s"<>]/g, "")}`;

/**
 * Folds a content line at 75 octets (§3.1): continuation lines start with one space, and a multi-byte UTF-8 character
 * is never split across lines.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder(), out: string[] = [];
  let current = "", size = 0, limit = 75;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (size + n > limit) { out.push(current); current = ""; size = 0; limit = 74; }
    current += ch; size += n;
  }
  out.push(current);
  return out.join("\r\n ");
}

/** A complete VCALENDAR with METHOD REQUEST or CANCEL (CRLF line endings, folded, UTC times). */
export function buildCalendarInvite(input: CalendarInviteInput): string {
  const cancel = input.method === "CANCEL";
  const location = [input.venue, input.address].map(v => v?.trim()).filter(Boolean).join(", ");
  const description = cancel
    ? `This place was cancelled.\n${input.url}`
    : `Your face is your ticket: look at the screen at the door to check in.\n\nEvent page: ${input.url}`;
  const attendeeName = input.attendee.name?.trim();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Didit//Didit Events//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${icsStamp(input.now)}`,
    `DTSTART:${icsStamp(input.startsAt)}`,
    `DTEND:${icsStamp(input.endsAt)}`,
    `SUMMARY:${icsText(input.summary)}`,
    ...(location ? [`LOCATION:${icsText(location)}`] : []),
    ...(input.geo && Number.isFinite(input.geo.lat) && Number.isFinite(input.geo.lng) ? [`GEO:${input.geo.lat};${input.geo.lng}`] : []),
    `DESCRIPTION:${icsText(description)}`,
    `URL:${input.url}`,
    `ORGANIZER;CN=${icsParam(CALENDAR_ORGANIZER.name)}:${mailto(CALENDAR_ORGANIZER.email)}`,
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE${attendeeName ? `;CN=${icsParam(attendeeName)}` : ""}:${mailto(input.attendee.email)}`,
    `STATUS:${cancel ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    ...(cancel ? [] : ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(input.summary)}`, "TRIGGER:-PT1H", "END:VALARM"]),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** The Resend attachment for an invite: `invite.ics` sent as text/calendar with the METHOD parameter mail clients read. */
export function calendarAttachment(ics: string, method: CalendarMethod): { filename: string; content: string; content_type: string } {
  return { filename: method === "CANCEL" ? "cancel.ics" : "invite.ics", content: Buffer.from(ics, "utf8").toString("base64"), content_type: `text/calendar; charset=UTF-8; method=${method}` };
}

/**
 * The next calendar step for a registration, read under a row lock in the caller's transaction. A CANCEL is only
 * produced while the guest's calendar holds a live REQUEST (nothing to remove otherwise); a REQUEST always is.
 */
export async function nextCalendarRef(tx: Tx, registrationId: string, method: CalendarMethod): Promise<CalendarRef | null> {
  const [row] = await tx.query<{ sequence: number; method: CalendarMethod }>("select sequence,method from calendar_invites where registration_id=$1 for update", [registrationId]);
  if (method === "CANCEL" && row?.method !== "REQUEST") return null;
  return { registrationId, method, sequence: row ? Number(row.sequence) + 1 : 0 };
}
/** Records a sent-to-outbox step. Called only when the email row was actually created. */
export async function commitCalendarRef(tx: Tx, ref: CalendarRef): Promise<void> {
  await tx.query(`insert into calendar_invites (registration_id,sequence,method) values ($1,$2,$3)
    on conflict (registration_id) do update set sequence=excluded.sequence,method=excluded.method,updated_at=clock_timestamp()`, [ref.registrationId, ref.sequence, ref.method]);
}
/** Enqueues an email carrying a calendar step: the ref goes into `data.calendar`, and the SEQUENCE moves only for a new row. */
export async function withCalendar(tx: Tx, registrationId: string, method: CalendarMethod, enqueue: (calendar: CalendarRef | null) => Promise<string | null>): Promise<string | null> {
  const ref = await nextCalendarRef(tx, registrationId, method);
  const id = await enqueue(ref);
  if (id && ref) await commitCalendarRef(tx, ref);
  return id;
}

export function isCalendarRef(value: unknown): value is CalendarRef {
  const v = value as Partial<CalendarRef> | null;
  return !!v && typeof v === "object" && typeof v.registrationId === "string" && (v.method === "REQUEST" || v.method === "CANCEL") && Number.isInteger(v.sequence) && v.sequence! >= 0;
}
