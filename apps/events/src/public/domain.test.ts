import { describe, expect, it } from "vitest";
import { calendarTab } from "../../app/events/data";
import { badge, clock, dayMonthYear, longDate, shortDate, timeRange, zoneName } from "./format";
import { eventIcs, googleCalendarUrl } from "./ics";
import { AI_ERA, BCN_OPENING, CALENDAR, FIXED_NOW, MARIA } from "./fixtures";
import { cardWithoutRegistration, eventGate } from "./state";
import type { PublicEvent } from "./types";

describe("format (event time zone)", () => {
  it("AI Era copy", () => {
    expect(longDate(AI_ERA.startsAt, AI_ERA.timeZone)).toBe("Thursday, 8 October");
    expect(timeRange(AI_ERA.startsAt, AI_ERA.endsAt, AI_ERA.timeZone)).toBe("18:30 – 21:30 CEST");
    expect(badge(AI_ERA.startsAt, AI_ERA.timeZone)).toEqual({ month: "Oct", day: "8" });
    expect(clock(new Date("2026-10-08T18:02:00+02:00"), "Europe/Madrid")).toBe("18:02 CEST");
    expect(shortDate("2026-10-02T18:00:00+02:00", "Europe/Madrid")).toBe("Fri 2 Oct");
  });

  it("zone names per region and season", () => {
    expect(zoneName("2026-11-12T08:30:00+01:00", "Europe/Madrid")).toBe("CET");
    expect(zoneName("2026-12-04T18:00:00Z", "Europe/Lisbon")).toBe("WET");
    expect(zoneName("2026-04-14T18:30:00-07:00", "America/Los_Angeles")).toBe("PDT");
    expect(dayMonthYear("2026-04-14T18:30:00-07:00", "America/Los_Angeles")).toBe("14 Apr 2026");
  });
});

describe("event gate and anonymous card", () => {
  const at = (iso: string) => new Date(iso);
  it("open → closed after the deadline → ended after the end, whatever the stored status", () => {
    expect(eventGate(AI_ERA, at("2026-10-01T12:00:00+02:00"))).toBe("open");
    expect(eventGate(AI_ERA, FIXED_NOW)).toBe("closed");
    expect(eventGate({ ...AI_ERA, lifecycle: "live" }, at("2026-10-08T22:00:00+02:00"))).toBe("ended");
  });

  it("full at capacity; invite-only is closed to requests", () => {
    expect(eventGate({ ...BCN_OPENING, going: 150 }, at("2026-10-01T12:00:00+02:00"))).toBe("full");
    expect(eventGate({ ...BCN_OPENING, registration: "invite_only" }, at("2026-10-01T12:00:00+02:00"))).toBe("closed");
  });

  it("signed out → P-02a, signed in → P-01 request card", () => {
    const early = at("2026-10-01T12:00:00+02:00");
    expect(cardWithoutRegistration(AI_ERA, null, early)).toEqual({ kind: "signed_out" });
    expect(cardWithoutRegistration(AI_ERA, MARIA, early)).toEqual({ kind: "request", viewer: MARIA });
    expect(cardWithoutRegistration(AI_ERA, MARIA, FIXED_NOW)).toEqual({ kind: "closed" });
  });
});

describe("calendar tabs", () => {
  it("upcoming soonest first, past latest first (P-03 order)", () => {
    const names = (es: PublicEvent[]) => es.map((e) => e.title);
    expect(names(calendarTab(CALENDAR.events, "upcoming", FIXED_NOW))).toEqual([
      "Building, Raising & Scaling in the",
      "Barcelona Office Opening",
      "Madrid Fintech Breakfast",
      "Customer Roundtable Lisbon",
    ]);
    expect(names(calendarTab(CALENDAR.events, "past", FIXED_NOW))).toEqual(["Amsterdam Partner Evening", "San Francisco Launch Night", "Lisbon Founders Dinner"]);
  });

  it("an event moves to past once it ends; cancelled events are hidden", () => {
    const after = new Date("2026-10-09T00:00:00+02:00");
    expect(calendarTab(CALENDAR.events, "past", after)[0]?.slug).toBe("ai-era");
    expect(calendarTab([{ ...AI_ERA, lifecycle: "cancelled" }], "upcoming", FIXED_NOW)).toEqual([]);
  });
});

describe("calendar file", () => {
  it("RFC 5545 in UTC with escaped text and CRLF", () => {
    const ics = eventIcs(AI_ERA, "https://events.didit.me", new Date("2026-09-29T10:00:00Z"));
    expect(ics).toContain("DTSTART:20261008T163000Z\r\n");
    expect(ics).toContain("DTEND:20261008T193000Z\r\n");
    expect(ics).toContain("SUMMARY:Building\\, Raising & Scaling in the AI Era\r\n");
    expect(ics).toContain("URL:https://events.didit.me/e/ai-era\r\n");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("Google Calendar link", () => {
    const u = new URL(googleCalendarUrl(BCN_OPENING, "https://events.didit.me"));
    expect(u.searchParams.get("dates")).toBe("20261023T170000Z/20261023T210000Z");
    expect(u.searchParams.get("text")).toBe("Barcelona Office Opening");
  });
});

it.each(["\r", "\n", "\r\n"])("escapes every calendar line break %j as text", newline => {
  const injected = `Hello${newline}X-INJECTED:yes`, event = { ...AI_ERA, title: injected, accent: "", summary: injected, venue: { ...AI_ERA.venue, name: injected } };
  const ics = eventIcs(event, "https://events.test", FIXED_NOW);
  expect(ics).toContain("SUMMARY:Hello\\nX-INJECTED:yes");
  expect(ics).not.toMatch(/(?:^|[\r\n])X-INJECTED:/);
  expect(ics.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
});
