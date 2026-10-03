import { links } from "./links";
import type { PublicEvent } from "./types";

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
import { icsText as escape } from "@didit-events/core/ics";
const title = (e: PublicEvent) => [e.title, e.accent].filter(Boolean).join(" ");

/** RFC 5545 calendar file for "Add to calendar" / "Apple / .ics" (UTC times, CRLF lines). */
export function eventIcs(event: PublicEvent, origin: string, now: Date): string {
  const url = new URL(links.event(event.slug), origin).toString();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Didit//Didit Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.slug}@events.didit.me`,
    `DTSTAMP:${stamp(now.toISOString())}`,
    `DTSTART:${stamp(event.startsAt)}`,
    `DTEND:${stamp(event.endsAt)}`,
    `SUMMARY:${escape(title(event))}`,
    `LOCATION:${escape(`${event.venue.name}, ${event.venue.address}`)}`,
    `DESCRIPTION:${escape(`${event.summary}\n\nFace check-in by Didit: at the door, just look at the screen.\n${url}`)}`,
    `URL:${url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

/** Google Calendar "add event" link. */
export function googleCalendarUrl(event: PublicEvent, origin: string): string {
  const u = new URL("https://calendar.google.com/calendar/render");
  u.searchParams.set("action", "TEMPLATE");
  u.searchParams.set("text", title(event));
  u.searchParams.set("dates", `${stamp(event.startsAt)}/${stamp(event.endsAt)}`);
  u.searchParams.set("location", `${event.venue.name}, ${event.venue.address}`);
  u.searchParams.set("details", `${event.summary}\n${new URL(links.event(event.slug), origin).toString()}`);
  u.searchParams.set("ctz", event.timeZone);
  return u.toString();
}
