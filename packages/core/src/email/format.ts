// Date and text formatting for emails, in the event's time zone. Month and weekday names are fixed English so ICU
// data differences (en-GB "Sept") never change the copy: "Thu 8 Oct 2026, 18:30–21:30 CEST".

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

interface Parts {
  weekday: string;
  day: number;
  month: string;
  year: number;
  time: string;
  zone: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsOf(date: Date, timeZone: string): Parts {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZoneName: "short",
    });
    formatters.set(timeZone, f);
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => f.formatToParts(date).find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  // Weekday of the local calendar date (UTC noon avoids any DST edge).
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()]!;
  return { weekday, day, month: MONTHS[month - 1]!, year, time: `${get("hour")}:${get("minute")}`, zone: get("timeZoneName") };
}

/** "18:30" */
export const fmtTime = (d: Date, tz: string) => partsOf(d, tz).time;

/** "Thu 8 Oct" */
export function fmtDay(d: Date, tz: string): string {
  const p = partsOf(d, tz);
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "Fri 2 Oct, 11:20" */
export function fmtDayTime(d: Date, tz: string): string {
  const p = partsOf(d, tz);
  return `${p.weekday} ${p.day} ${p.month}, ${p.time}`;
}

/** "Tue 29 Sep, 18:14 CEST" */
export function fmtDayTimeZone(d: Date, tz: string): string {
  const p = partsOf(d, tz);
  return `${p.weekday} ${p.day} ${p.month}, ${p.time} ${p.zone}`;
}

/**
 * "Thu 8 Oct 2026, 18:30–21:30 CEST" (zones omitted with `zone: false`). Assumes a same-day event. When the range
 * crosses a DST change each end carries its own abbreviation: "Sun 25 Oct 2026, 01:30 CEST–03:30 CET".
 */
export function fmtWhen(start: Date, end: Date, tz: string, opts: { zone?: boolean } = {}): string {
  const s = partsOf(start, tz);
  const e = partsOf(end, tz);
  const day = `${s.weekday} ${s.day} ${s.month} ${s.year}`;
  if (opts.zone === false) return `${day}, ${s.time}–${e.time}`;
  if (s.zone !== e.zone) return `${day}, ${s.time} ${s.zone}–${e.time} ${e.zone}`;
  return `${day}, ${s.time}–${e.time} ${s.zone}`;
}

/** "481903" → "481 903" (codes are shown in two groups of three). */
export function fmtCode(code: string): string {
  const digits = code.replace(/\s+/g, "");
  return digits.length === 6 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}

/** 1 → "1 request", 2 → "2 requests". */
export const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** "https://events.didit.me/x" → "events.didit.me" (the host named in the legal line). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "events.didit.me";
  }
}
