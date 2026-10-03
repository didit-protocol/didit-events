/**
 * Pure date/time helpers for the pickers (and the forms that validate what they submit). No Intl state, no DOM:
 * the same module runs in the browser and in server actions.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Typed time → "HH:MM" (24 h), else null. Accepts "19:00", "1900", "19",
 * "19h30", "7.30", "7pm", "7:30 pm", "7 p.m.", "noon", "midnight".
 */
export function normalizeTime(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "").replace(/([ap])\.?m?\.?$/, "$1m").replace(/\./g, ":");
  if (s === "noon") return "12:00";
  if (s === "midnight") return "00:00";
  const m = /^(\d{1,2})(?:[:h]?(\d{2}))?(am|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  const suffix = m[3];
  if (min > 59) return null;
  if (suffix) {
    if (h < 1 || h > 12) return null;
    if (suffix.startsWith("a")) h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else if (h > 23) return null;
  return `${pad(h)}:${pad(min)}`;
}

/** "19:30" → 1170 (minutes after midnight); anything not "HH:MM"-normalisable → null. */
export function timeToMinutes(raw: string): number | null {
  const t = normalizeTime(raw);
  if (!t) return null;
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
}

export const minutesToTime = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

/** 210 → "3 h 30 min", 45 → "45 min", 120 → "2 h". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ") || "0 min";
}

/** Every `step` minutes of a day: "00:00", "00:15", … "23:45". */
export function timeSlots(step = 15): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += step) out.push(minutesToTime(m));
  return out;
}

export interface YMD {
  y: number;
  /** 1–12 */
  m: number;
  d: number;
}

/** "2026-10-23" → { y, m, d } if it is a real calendar date. */
export function parseIsoDate(raw: string): YMD | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d ? { y, m: mo, d } : null;
}
export const isoDate = (c: YMD) => `${String(c.y).padStart(4, "0")}-${pad(c.m)}-${pad(c.d)}`;
/** Day arithmetic in UTC so DST never shifts a calendar day. */
export function addDays(c: YMD, days: number): YMD {
  const t = new Date(Date.UTC(c.y, c.m - 1, c.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
/** Same day next/previous month, clamped to the month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonths(c: YMD, months: number): YMD {
  const first = new Date(Date.UTC(c.y, c.m - 1 + months, 1));
  const y = first.getUTCFullYear(), m = first.getUTCMonth() + 1;
  return { y, m, d: Math.min(c.d, daysInMonth(y, m)) };
}
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Monday = 0 … Sunday = 6. */
export const weekdayMon = (c: YMD) => (new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay() + 6) % 7;
export const compareYmd = (a: YMD, b: YMD) => a.y - b.y || a.m - b.m || a.d - b.d;
/** Today in the browser's (or the given) time zone as a calendar date. */
export function todayYmd(now = new Date(), timeZone?: string): YMD {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parseIsoDate(parts)!;
}
/** "Fri, 23 Oct 2026" (the trigger label). */
export function formatLongDate(c: YMD): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(c.y, c.m - 1, c.d)));
}
