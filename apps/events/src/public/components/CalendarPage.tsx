import { preload } from "react-dom";
import { EmptyState, SegmentedNav, StatusPill, cx } from "@didit-events/ui";
import { dayMonth, dayMonthYear, time, venueLabel, weekday, zoneName } from "../format";
import { links } from "../links";
import { coverPhoto, coverSrc } from "../photos";
import type { Calendar, PublicEvent, Viewer } from "../types";
import { CalendarHeader } from "./CalendarHeader";
import type { CardActions } from "./CardButton";
import { SiteHeader } from "./SiteHeader";
import s from "./CalendarPage.module.css";

export type CalendarTab = "upcoming" | "past";

export interface CalendarPageProps {
  calendar: Calendar;
  tab: CalendarTab;
  /** Events for the tab, already filtered and ordered (upcoming soonest first, past latest first). */
  events: PublicEvent[];
  viewer: Viewer | null;
  actions: CardActions;
}

const countLabel = (e: PublicEvent, tab: CalendarTab) =>
  tab === "past"
    ? `${e.attended ?? 0} attended`
    : e.listingNote ?? (e.registration === "invite_only" ? "Invite only" : `${e.going} going${e.registration === "request" ? " · approval required" : ""}`);

/** Consecutive events on the same local day share one date header (the list is already ordered by start). */
function byDay(events: PublicEvent[]): { key: string; events: PublicEvent[] }[] {
  const days: { key: string; events: PublicEvent[] }[] = [];
  for (const e of events) {
    const key = dayMonthYear(e.startsAt, e.timeZone);
    const last = days[days.length - 1];
    if (last?.key === key) last.events.push(e);
    else days.push({ key, events: [e] });
  }
  return days;
}

/** P-03 Didit Events calendar: banner, host block, Upcoming / Past, one row per day with a card per event. */
export function CalendarPage({ calendar, tab, events, viewer }: CalendarPageProps) {
  // The banner is the page's largest image but a CSS background (CalendarHeader), which the preload scanner cannot
  // see: this hint puts it in the document head, fetched first.
  preload(calendar.coverUrl ?? coverPhoto("aqua"), { as: "image", fetchPriority: "high" });
  return (
    <div className={s.page}>
      <SiteHeader viewer={viewer} next={links.calendar()} />
      <main className={s.main}>
        <CalendarHeader
          profile={calendar}
        />
        <SegmentedNav
          label="Events"
          items={[
            { label: "Upcoming", href: links.calendar(), current: tab === "upcoming" },
            { label: "Past", href: links.past(), current: tab === "past" },
          ]}
        />
        {events.length ? (
          <ol className={s.list}>
            {byDay(events).map((day) => {
              const first = day.events[0]!;
              return (
                <li key={day.key} className={s.row}>
                  <div className={s.date}>
                    <span className={s.day}>{dayMonth(first.startsAt, first.timeZone)}</span>
                    <span className={s.weekday}>{weekday(first.startsAt, first.timeZone)}</span>
                  </div>
                  <ul className={s.cards} data-stagger="">
                    {day.events.map((e) => {
                      const tz = e.timeZone;
                      const ended = tab === "past" || e.lifecycle === "ended";
                      return (
                        <li key={e.slug}>
                          <a href={links.event(e.slug)} className={s.card}>
                            <span className={s.cardText}>
                              <span className={s.time}>{`${time(e.startsAt, tz)} ${zoneName(e.startsAt, tz)}`}</span>
                              <span className={s.title}>{e.title}</span>
                              <span className={s.location}>{venueLabel(e.venue)}</span>
                              <span className={s.status}>
                                <StatusPill status={ended ? "ended" : "open"} />
                                <span className={s.count}>{countLabel(e, tab)}</span>
                              </span>
                            </span>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={coverSrc(e.cover, 192)} alt="" width={96} height={96} loading="lazy" decoding="async" className={s.thumb} />
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState
            className={cx(s.empty)}
            title={tab === "upcoming" ? "No upcoming events" : "No past events yet"}
            description={tab === "upcoming" ? "The next Didit event will be announced here." : "Events appear here once they have ended."}
          />
        )}
      </main>
    </div>
  );
}
