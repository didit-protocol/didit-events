import { assetsOf, defineTemplate, place, preferencesLink, whereLong, whereShort, type EmailBase, type EmailEvent } from "../common.ts";
import { fmtDay, fmtTime, fmtWhen, plural } from "../format.ts";
import type { EmailDoc } from "../layout.ts";

export type EventChange =
  /** Door time moved (same day). `event.startsAt` is the new time. */
  | { kind: "time"; before: Date }
  /** Venue moved. `event` carries the new venue. */
  | { kind: "venue"; before: string }
  /** Same start and venue; the end time or the title changed. `event` carries the new details. */
  | { kind: "details" };

export interface M16Data extends EmailBase {
  event: EmailEvent;
  change: EventChange;
  calendarUrl: string;
}

export const M16 = defineTemplate<M16Data>({ code: "M-16", name: "Event update · time change", trigger: "admin edits date/time/venue" }, (d): EmailDoc => {
  const e = d.event;
  const base = {
    variant: "event" as const,
    assetsUrl: assetsOf(d),
    eyebrow: "EVENT UPDATE",
    footer: { legal: "You are going to a Didit event.", link: preferencesLink(d) },
  };
  const button = { kind: "buttons" as const, primary: { label: "Update my calendar", href: d.calendarUrl } };
  if (d.change.kind === "time") {
    const before = fmtTime(d.change.before, e.timeZone);
    const now = fmtTime(e.startsAt, e.timeZone);
    const minutes = Math.round((e.startsAt.getTime() - d.change.before.getTime()) / 60_000);
    const shift = `${plural(Math.abs(minutes), "minute")} ${minutes >= 0 ? "later" : "earlier"}`;
    return {
      ...base,
      subject: `Update: doors now open at ${now}`,
      preheader: `Same place, ${shift}.`,
      headline: "New door time",
      body: `Doors now open at ${now} instead of ${before}. Everything else stays the same. Your place is still confirmed.`,
      blocks: [
        {
          kind: "rows",
          labelWidth: 80,
          size: "md",
          rows: [
            { k: "Before", v: before, tone: "struck" },
            { k: "Now", v: `${now} · ${fmtDay(e.startsAt, e.timeZone)}`, tone: "strong" },
            { k: "Where", v: whereShort(e) },
          ],
        },
        button,
      ],
    };
  }
  if (d.change.kind === "details") {
    return {
      ...base,
      subject: `Update: ${e.shortName} details changed`,
      preheader: "Same start, same place.",
      headline: "Event updated",
      body: "The event details changed. The start time and the venue stay the same. Your place is still confirmed.",
      blocks: [
        { kind: "rows", labelWidth: 80, size: "md", rows: [{ k: "When", v: fmtWhen(e.startsAt, e.endsAt, e.timeZone), tone: "strong" }, { k: "Where", v: whereLong(e) }] },
        button,
      ],
    };
  }
  // Venue change: no design frame yet; same structure as the time change.
  return {
    ...base,
    subject: `Update: new venue for ${e.shortName}`,
    preheader: "Same time, new place.",
    headline: "New venue",
    body: `${place(e.venueName, e.street) ? `The event moves to ${place(e.venueName, e.street)}.` : "The venue changed."} The date and time stay the same. Your place is still confirmed.`,
    blocks: [
      {
        kind: "rows",
        labelWidth: 80,
        size: "md",
        rows: [
          { k: "Before", v: d.change.before, tone: "struck" },
          { k: "Now", v: whereLong(e), tone: "strong" },
          { k: "When", v: fmtWhen(e.startsAt, e.endsAt, e.timeZone) },
        ],
      },
      button,
    ],
  };
});
