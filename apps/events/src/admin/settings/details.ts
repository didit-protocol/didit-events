import { normalizeTime, parseIsoDate } from "@didit-events/ui/time";
import { END_BEFORE_START, NAME_MAX } from "../form/validate";

/** Settings → Event details: the inline name, date and times (same rules and messages as the full editor). */
export interface DetailsValues {
  name: string;
  /** ISO "YYYY-MM-DD". */
  date: string;
  /** "HH:MM". */
  start: string;
  end: string;
}

export type DetailsErrors = Partial<Record<keyof DetailsValues, string>>;

export function validateDetails(v: DetailsValues): DetailsErrors {
  const e: DetailsErrors = {};
  const name = v.name.trim();
  if (!name) e.name = "Give the event a name";
  else if (name.length > NAME_MAX) e.name = `Keep the name under ${NAME_MAX} characters`;
  if (!v.date.trim()) e.date = "Pick a date";
  else if (!parseIsoDate(v.date)) e.date = "Pick a valid date";
  const start = normalizeTime(v.start), end = normalizeTime(v.end);
  if (!v.start.trim()) e.start = "Add a start time";
  else if (!start) e.start = "Use a time like 19:00";
  if (!v.end.trim()) e.end = "Add an end time";
  else if (!end) e.end = "Use a time like 23:00";
  else if (start && end === start) e.end = "End must be after start";
  // Same-day events only: an end before the start would cross midnight.
  else if (start && end < start) e.end = END_BEFORE_START;
  return e;
}

export const sameDetails = (a: DetailsValues, b: DetailsValues) =>
  a.name.trim() === b.name.trim() && a.date === b.date && normalizeTime(a.start) === normalizeTime(b.start) && normalizeTime(a.end) === normalizeTime(b.end);

/** "1 question", "3 questions": the Request form summary on Settings. */
export const questionCount = (n: number) => (n === 1 ? "1 question" : `${n} questions`);
