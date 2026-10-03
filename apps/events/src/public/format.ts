/** Date and time copy for the guest pages, always in the event's own time zone (en-GB wording, 24 h clock). */

type Parts = { weekday: string; weekdayShort: string; day: string; month: string; monthShort: string; year: string; hour: string; minute: string };

function parts(iso: string, timeZone: string): Parts {
  const get = (opts: Intl.DateTimeFormatOptions, locale = "en-GB") => {
    const out: Record<string, string> = {};
    for (const p of new Intl.DateTimeFormat(locale, { timeZone, ...opts }).formatToParts(new Date(iso))) out[p.type] = p.value;
    return out;
  };
  const long = get({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
  // en-US short names: "Sep" (en-GB ICU now says "Sept"), "Thu".
  const short = get({ weekday: "short", month: "short" }, "en-US");
  const time = get({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return {
    weekday: long.weekday ?? "",
    weekdayShort: short.weekday ?? "",
    day: long.day ?? "",
    month: long.month ?? "",
    monthShort: short.month ?? "",
    year: long.year ?? "",
    hour: time.hour ?? "",
    minute: time.minute ?? "",
  };
}

/** "CEST", "CET", "WET", "PDT": en-GB names for Europe, en-US where en-GB only has a GMT offset. */
export function zoneName(iso: string, timeZone: string): string {
  const name = (locale: string) =>
    new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" }).formatToParts(new Date(iso)).find((p) => p.type === "timeZoneName")?.value ?? "";
  const gb = name("en-GB");
  return gb.startsWith("GMT") || gb.startsWith("UTC") ? name("en-US") || gb : gb;
}

/** "18:30" */
export const time = (iso: string, tz: string) => {
  const p = parts(iso, tz);
  return `${p.hour}:${p.minute}`;
};

/** "18:30 – 21:30 CEST" */
/** An agenda row's time: "19:10", or "19:10–20:00" when it has an end after its start. */
export const agendaTime = (item: { at: string; endAt?: string }, tz: string) =>
  item.endAt && Date.parse(item.endAt) > Date.parse(item.at) ? `${time(item.at, tz)}–${time(item.endAt, tz)}` : time(item.at, tz);
export const timeRange = (start: string, end: string, tz: string, sep = " – ") => `${time(start, tz)}${sep}${time(end, tz)} ${zoneName(start, tz)}`;

/** "Thursday, 8 October" */
export const longDate = (iso: string, tz: string) => {
  const p = parts(iso, tz);
  return `${p.weekday}, ${p.day} ${p.month}`;
};

/** "Fri 2 Oct" */
export const shortDate = (iso: string, tz: string) => {
  const p = parts(iso, tz);
  return `${p.weekdayShort} ${p.day} ${p.monthShort}`;
};

/** "29 Sep" */
export const dayMonth = (iso: string, tz: string) => {
  const p = parts(iso, tz);
  return `${p.day} ${p.monthShort}`;
};

/** "14 Apr 2026" */
export const dayMonthYear = (iso: string, tz: string) => {
  const p = parts(iso, tz);
  return `${p.day} ${p.monthShort} ${p.year}`;
};

/** { month: "Oct", day: "8" } for the date badge. */
export const badge = (iso: string, tz: string) => {
  const p = parts(iso, tz);
  return { month: p.monthShort, day: p.day };
};

/** "Thursday" */
export const weekday = (iso: string, tz: string) => parts(iso, tz).weekday;

/** "Fri 23 Oct 2026" */
export const fullShortDate = (iso: string, tz: string) => {
  const p = parts(iso, tz);
  return `${p.weekdayShort} ${p.day} ${p.monthShort} ${p.year}`;
};

/** "18:02 CEST": the header clock (P-01). */
export const clock = (now: Date, tz: string) => `${time(now.toISOString(), tz)} ${zoneName(now.toISOString(), tz)}`;

export const count = (n: number) => new Intl.NumberFormat("en-US").format(n);

/** "<venue>, <city>"; just the one when the other is missing or they are the same ("Lisbon"). */
export const venueLabel = (venue: { name: string; city?: string }) =>
  [...new Set([venue.name.trim(), venue.city?.trim() ?? ""].filter(Boolean))].join(", ");

/** Generated-cover copy for events that set none (the cover components' own defaults are the AI Era design sample). */
export const COVER_EYEBROW = "EVENTS BY DIDIT";
export const COVER_TAG = "DIDIT EVENTS";
