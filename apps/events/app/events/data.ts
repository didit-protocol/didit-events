/**
 * Data access for /events and / (P-03). Wiring (F1): published events of the calendar, split at `now` by end time
 * (an event past its end counts as past even if its status is still live), plus the subscriber count.
 */
import { cache } from "react";
import { calendarSubscribers, publicEvent, publishedEvents } from "../../src/server/b4-views";
import { getCalendarProfile } from "@didit-events/core/calendar";
import { calendarProfile } from "../../src/public/calendar-profile";
import type { Calendar, CalendarProfile, PublicEvent } from "../../src/public/types";

export type CalendarTab = "upcoming" | "past";

export async function getCalendar(tab: CalendarTab, now: Date): Promise<{ calendar: Calendar; events: PublicEvent[] }> {
  const [published, profile, subscribers] = await Promise.all([publishedEvents(), getProfile(), calendarSubscribers()]);
  const events = published.map(e => publicEvent(e));
  const calendar: Calendar = { ...profile, subscribers, events };
  return { calendar, events: calendarTab(events, tab, now) };
}

/**
 * The P-03 header: the row staff saved in /admin/calendar, else the built-in Didit header. One read per render
 * (React cache): generateMetadata and the page share it.
 */
export const getProfile = cache(async (): Promise<CalendarProfile> => calendarProfile(await getCalendarProfile()));

/** Upcoming soonest first, past latest first; cancelled events are hidden. */
export function calendarTab(all: PublicEvent[], tab: CalendarTab, now: Date): PublicEvent[] {
  const t = now.getTime();
  const ended = (e: PublicEvent) => e.lifecycle === "ended" || new Date(e.endsAt).getTime() <= t;
  const visible = all.filter((e) => e.lifecycle !== "cancelled");
  const at = (e: PublicEvent) => new Date(e.startsAt).getTime();
  return tab === "upcoming" ? visible.filter((e) => !ended(e)).sort((a, b) => at(a) - at(b)) : visible.filter(ended).sort((a, b) => at(b) - at(a));
}

export { getViewer } from "../e/[slug]/data";
