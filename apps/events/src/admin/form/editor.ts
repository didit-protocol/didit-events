/**
 * Event model v2 in the editor (docs/event-model-v2.md): description Markdown, registration form, extra checks,
 * door, lifecycle emails and cover, kept as one typed object next to the A-03 values. Pure and zod-free (client
 * bundle). The server re-validates with the canonical schemas; these rules only mirror them for inline errors.
 *
 * Canonical editor values are sent directly to the versioned event service.
 */
import type { EventChecks, EventCover, EventDoor, EventEmailCode, EventEmails, EventForm, ExtraCheck, FormQuestion } from "../model/contract";
import { EMAIL_VARIABLES, EVENT_EMAIL_CODES, MANDATORY_EMAIL_CODES } from "../model/contract";
import { DESCRIPTION_MD_MAX, safeHttpsUrl } from "./url";

export interface EditorV2 {
  descriptionMd: string;
  checks: EventChecks;
  door: EventDoor;
  form: EventForm;
  /** Registration closes: local wall time in the event's zone ("2026-10-22T18:00"), "" = at the start. */
  closesAtLocal: string;
  emails: EventEmails;
  cover: EventCover;
  speakers?: { name: string; role: string; photoUrl?: string; email?: string }[];
  /** Event-page agenda, in display order. `time` is "HH:mm" in the event's zone on the event date (saved as ISO instants). */
  agenda?: AgendaRow[];
}

/** One agenda row in the editor. `id` is editor-only (keys, focus, error paths); it is not saved. */
export interface AgendaRow {
  id: string;
  time: string;
  /** Optional end ("HH:mm", after `time`): the event page and emails show "19:10–20:00". Saved as `endAt`. */
  until?: string;
  label: string;
  /** Kept from the stored item (panels are set in 500); the editor does not change it. */
  emphasis?: boolean;
  /** Days after the event date the item starts on (an item after midnight is 1); absent = the event date. Kept from the stored item. */
  day?: number;
  /** Days after the event date `until` falls on; absent = the item's own day. Kept from the stored item. */
  untilDay?: number;
  /**
   * The stored ISO instants of `time` / `until`, kept so an unchanged row saves the same instant (a wall time in a
   * DST fall-back overlap names two instants). The server re-derives from the wall time once it no longer matches.
   */
  at?: string;
  endAt?: string;
}

/** "YYYY-MM-DD" plus `days`. */
export const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);

export const QUESTION_LABEL_MAX = 200;
export const OPTION_LABEL_MAX = 100;
export const MAX_V2_QUESTIONS = 20;
export const MAX_OPTIONS = 20;
export const CONSENT_MAX = 2000;
export const SUBJECT_MAX = 200;
export const EMAIL_BODY_MAX = 10_000;
export const DEFAULT_THRESHOLD = 80;
export const AGENDA_MAX = 30;
export const AGENDA_LABEL_MAX = 120;
export const CHECK_ORDER: readonly ExtraCheck[] = ["phone", "id_document", "name_from_id"];

export const uuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

export const DEFAULT_V2: EditorV2 = {
  descriptionMd: "",
  checks: { version: 1, required: [], max_age: {} },
  door: { kiosk: false },
  form: { version: 1, mode: "request", closes_at: null, waitlist: true, fields: { phone_number: "off" }, questions: [], consent_text: null },
  closesAtLocal: "",
  emails: { version: 1, templates: {} },
  cover: { kind: "theme", theme: "aqua" },
  agenda: [],
};

/* ── Validation (inline messages; keys are stable paths) ──────────────────────────────── */

export type V2Errors = Record<string, string>;
const cp = (s: string) => Array.from(s).length;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const PROSE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const LOCAL_DT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function isEmailCode(code: string): code is EventEmailCode {
  return (EVENT_EMAIL_CODES as readonly string[]).includes(code);
}

/** Unknown `{{variables}}` in an override (only first_name, event_name, date, venue, maps_url are allowed). */
export function unknownVariables(text: string): string[] {
  const found = [...text.matchAll(/\{\{([^{}]*)\}\}/g)].map((m) => m[1]!);
  return [...new Set(found.filter((v) => !(EMAIL_VARIABLES as readonly string[]).includes(v)))];
}

/**
 * Why host email text would be refused (mirrors lane A's validEditorialText): unknown `{{variables}}`, stray braces,
 * link destinations that are not HTTPS (`{{maps_url}}` aside) and script/style/iframe tags. Null = acceptable.
 */
export function editorialTextError(text: string): string | null {
  const unknown = unknownVariables(text);
  if (unknown.length) return `Unknown variable: {{${unknown[0]}}}`;
  if (/[{}]/.test(text.replace(/\{\{(?:first_name|event_name|date|venue|maps_url)\}\}/g, ""))) return "Write variables as {{first_name}}; other braces aren’t allowed";
  for (const m of text.matchAll(/\]\(\s*<?([^\s)>]+)|^\s*\[[^\]]+\]:\s*<?([^\s>]+)/gm)) {
    const href = m[1] ?? m[2]!;
    if (href !== "{{maps_url}}" && !safeHttpsUrl(href)) return "Links must start with https://";
  }
  if (/<\s*(?:script|style|iframe)\b/i.test(text)) return "Remove the HTML tags";
  return null;
}

export function questionErrors(q: FormQuestion): V2Errors {
  const e: V2Errors = {};
  const label = q.label.trim();
  if (!label) e[`q:${q.id}:label`] = "Write the question";
  else if (cp(label) > QUESTION_LABEL_MAX) e[`q:${q.id}:label`] = `Keep it under ${QUESTION_LABEL_MAX} characters`;
  else if (CONTROL.test(label)) e[`q:${q.id}:label`] = "Remove line breaks and control characters";
  if (q.kind === "single" || q.kind === "multi") {
    const labels = q.options.map((o) => o.label.trim());
    if (q.options.length < 2) e[`q:${q.id}:options`] = "Add at least 2 choices";
    else if (q.options.length > MAX_OPTIONS) e[`q:${q.id}:options`] = `At most ${MAX_OPTIONS} choices`;
    else if (labels.some((l) => !l)) e[`q:${q.id}:options`] = "Every choice needs a label";
    else if (labels.some((l) => cp(l) > OPTION_LABEL_MAX)) e[`q:${q.id}:options`] = `Keep choices under ${OPTION_LABEL_MAX} characters`;
    else if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) e[`q:${q.id}:options`] = "Choices must be different";
  }
  return e;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Agenda rows: a valid time, an optional end after it, a one-line label of 1–120 characters, at most 30 rows. With the
 * event's date ("YYYY-MM-DD") and zone, the end is checked on the instants the save will store (retained instants
 * included, so a DST fall-back item shown as 02:45 → 02:15 is valid); without them, on the wall times.
 */
export function agendaErrors(rows: AgendaRow[], at?: { date: string; timeZone: string }): V2Errors {
  const e: V2Errors = {};
  if (rows.length > AGENDA_MAX) e.agenda = `At most ${AGENDA_MAX} agenda items`;
  for (const r of rows) {
    if (!r.time.trim()) e[`agenda:${r.id}:time`] = "Add a time";
    else if (!HHMM.test(r.time)) e[`agenda:${r.id}:time`] = "Use a time like 19:00";
    const until = r.until?.trim();
    if (until && !HHMM.test(until)) e[`agenda:${r.id}:until`] = "Use a time like 20:00";
    else if (until && HHMM.test(r.time) && untilBefore(r, until, at)) e[`agenda:${r.id}:until`] = AGENDA_UNTIL_ERROR;
    const label = r.label.trim();
    if (!label) e[`agenda:${r.id}:label`] = "Write what happens";
    else if (cp(label) > AGENDA_LABEL_MAX) e[`agenda:${r.id}:label`] = `Keep it under ${AGENDA_LABEL_MAX} characters`;
    else if (CONTROL.test(label)) e[`agenda:${r.id}:label`] = "Remove line breaks and control characters";
  }
  return e;
}

export const AGENDA_UNTIL_ERROR = "End after the start time";

/** The end is not after the start, comparing the days too (an end on a later day is after any start time). */
function untilBefore(r: AgendaRow, until: string, at?: { date: string; timeZone: string }): boolean {
  const day = r.day ?? 0, untilDay = r.untilDay ?? day;
  if (at) {
    try {
      const start = agendaInstant(`${addDays(at.date, day)}T${r.time}`, at.timeZone, r.at);
      const end = agendaInstant(`${addDays(at.date, untilDay)}T${until}`, at.timeZone, r.endAt);
      return Date.parse(end) <= Date.parse(start);
    } catch { /* a time in the spring-forward gap: fall back to the wall-clock order */ }
  }
  return untilDay < day || (untilDay === day && until <= r.time);
}
/** The end falls on a later day than the start (the editor then skips its same-day "after" check). */
export const untilNextDay = (r: AgendaRow): boolean => (r.untilDay ?? r.day ?? 0) > (r.day ?? 0);

/** A row outside the event's start–end (both "HH:mm"): shown as a warning, never blocks the save. */
export const agendaOutside = (time: string, start: string | null, end: string | null): boolean =>
  HHMM.test(time) && Boolean(start && end) && (time < start! || time > end!);

export function validateV2(v: EditorV2, eventStart?: string, timeZone?: string): V2Errors {
  const e: V2Errors = { ...agendaErrors(v.agenda ?? [], eventStart && timeZone ? { date: eventStart.slice(0, 10), timeZone } : undefined) };
  if (cp(v.descriptionMd) > DESCRIPTION_MD_MAX) e.descriptionMd = `Keep the description under ${DESCRIPTION_MD_MAX.toLocaleString("en-US")} characters`;
  else if (PROSE_CONTROL.test(v.descriptionMd)) e.descriptionMd = "Remove control characters";

  if (v.form.questions.length > MAX_V2_QUESTIONS) e.questions = `At most ${MAX_V2_QUESTIONS} questions`;
  for (const q of v.form.questions) Object.assign(e, questionErrors(q));
  const consent = v.form.consent_text ?? "";
  if (cp(consent) > CONSENT_MAX) e.consent = `Keep it under ${CONSENT_MAX} characters`;
  if (v.closesAtLocal) {
    const m = LOCAL_DT.exec(v.closesAtLocal);
    if (!m) e.closesAt = "Pick a date and time";
    else if (eventStart && v.closesAtLocal > eventStart) e.closesAt = "Requests must close before the event starts";
  }

  if (v.checks.age_min !== undefined && (!Number.isInteger(v.checks.age_min) || v.checks.age_min < 1 || v.checks.age_min > 100)) e.age = "Use an age from 1 to 100";
  if (v.door.kiosk && (!Number.isInteger(v.door.match_threshold) || v.door.match_threshold < 50 || v.door.match_threshold > 99)) e.threshold = "Use 50–99";

  for (const [code, o] of Object.entries(v.emails.templates)) {
    if (!o) continue;
    if (!o.enabled && (MANDATORY_EMAIL_CODES as readonly string[]).includes(code)) e[`email:${code}:enabled`] = "This notice can’t be turned off";
    if (o.subject !== undefined) {
      const subj = o.subject.trim();
      if (!subj) e[`email:${code}:subject`] = "Write a subject, or reset to the default";
      else if (/[\r\n]/.test(o.subject)) e[`email:${code}:subject`] = "Keep the subject on one line";
      else if (cp(subj) > SUBJECT_MAX) e[`email:${code}:subject`] = `Keep it under ${SUBJECT_MAX} characters`;
      else if (editorialTextError(o.subject)) e[`email:${code}:subject`] = editorialTextError(o.subject)!;
    }
    if (o.body_md !== undefined) {
      if (cp(o.body_md) > EMAIL_BODY_MAX) e[`email:${code}:body`] = `Keep it under ${EMAIL_BODY_MAX.toLocaleString("en-US")} characters`;
      else if (PROSE_CONTROL.test(o.body_md)) e[`email:${code}:body`] = "Remove control characters";
      else if (editorialTextError(o.body_md)) e[`email:${code}:body`] = editorialTextError(o.body_md)!;
    }
  }
  if (v.cover.kind === "asset" && !v.cover.alt.trim()) e.coverAlt = "Describe the image for screen readers";
  return e;
}

/** Canonical checks: sorted required list, only the max-age keys the selected checks use. */
export function canonicalChecks(c: EventChecks): EventChecks {
  const required = CHECK_ORDER.filter((k) => c.required.includes(k));
  const max: EventChecks["max_age"] = {};
  if (required.includes("phone") && c.max_age.phone) max.phone = c.max_age.phone;
  if ((required.includes("id_document") || required.includes("name_from_id")) && c.max_age.document) max.document = c.max_age.document;
  if (required.includes("name_from_id") && c.max_age.name_from_id) max.name_from_id = c.max_age.name_from_id;
  if (c.age_min !== undefined && c.max_age.age) max.age = c.max_age.age;
  return { version: 1, required, ...(c.age_min !== undefined ? { age_min: c.age_min } : {}), max_age: max };
}

/** Bounded parse of the posted `v2` field (JSON); anything malformed returns undefined, never a partial object. */
export function readV2(raw: unknown): EditorV2 | undefined {
  if (typeof raw !== "string" || !raw || raw.length > 512 * 1024) return undefined;
  try {
    const o = JSON.parse(raw) as Partial<EditorV2>;
    if (!o || typeof o !== "object" || typeof o.descriptionMd !== "string" || !o.checks || !o.door || !o.form || !o.emails || !o.cover) return undefined;
    if (Object.keys(o).some(k=>!["descriptionMd","checks","door","form","closesAtLocal","emails","cover","speakers","agenda"].includes(k))) return undefined;
    if (!Array.isArray(o.form.questions) || !Array.isArray(o.checks.required) || !o.emails.templates || !["theme","asset"].includes(o.cover.kind) || (o.speakers !== undefined && !Array.isArray(o.speakers)) || (o.agenda !== undefined && !Array.isArray(o.agenda))) return undefined;
    return {
      descriptionMd: o.descriptionMd,
      checks: o.checks,
      door: o.door,
      form: o.form,
      closesAtLocal: typeof o.closesAtLocal === "string" ? o.closesAtLocal : "",
      emails: o.emails,
      cover: o.cover,
      speakers: o.speakers ?? [],
      agenda: readAgendaRows(o.agenda ?? []),
    };
  } catch {
    return undefined;
  }
}

/** How far from the event date a stored agenda item may sit (a multi-day event). */
const AGENDA_MAX_DAYS = 31;

/** Posted agenda rows: strings only, bounded (the server keeps at most AGENDA_MAX + 1 so the limit still reports). */
function readAgendaRows(list: unknown[]): AgendaRow[] {
  return list.slice(0, AGENDA_MAX + 1).flatMap((r, i): AgendaRow[] => {
    if (!r || typeof r !== "object") return [];
    const o = r as Record<string, unknown>;
    const str = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : "");
    const until = str(o.until, 5);
    const days = (x: unknown) => (typeof x === "number" && Number.isInteger(x) && Math.abs(x) <= AGENDA_MAX_DAYS ? x : undefined);
    const day = days(o.day), untilDay = days(o.untilDay);
    const instant = (x: unknown) => (typeof x === "string" && x.length <= 40 && Number.isFinite(Date.parse(x)) ? new Date(x).toISOString() : undefined);
    const at = instant(o.at), endAt = until ? instant(o.endAt) : undefined;
    return [{ id: str(o.id, 40) || `a${i + 1}`, time: str(o.time, 5), ...(until ? { until } : {}), label: str(o.label, AGENDA_LABEL_MAX + 40), ...(o.emphasis === true ? { emphasis: true } : {}),
      ...(day ? { day } : {}), ...(untilDay !== undefined && untilDay !== (day ?? 0) ? { untilDay } : {}), ...(at ? { at } : {}), ...(endAt ? { endAt } : {}) }];
  });
}

const zonedParts = (at: Date, timeZone: string) =>
  Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((p) => [p.type, p.value]));
/** Whole days from the local date of `from` to the local date of `at`, in `timeZone`. */
const dayOffset = (at: Date, from: Date, timeZone: string) => {
  const date = (d: Date) => { const p = zonedParts(d, timeZone); return Date.parse(`${p.year}-${p.month}-${p.day}T00:00:00Z`); };
  return Math.round((date(at) - date(from)) / 86400_000);
};

/**
 * Stored agenda (`[{at,label}]` ISO instants; older `{time|t, title|label|l}` blocks too) → editor rows with "HH:mm"
 * in the event's zone. With the event's start, an item on another day (after midnight) keeps its day as `day` /
 * `untilDay`, so a save puts it back on the same date. Unreadable items are dropped.
 */
export function agendaRowsOf(stored: unknown, timeZone: string, eventStart?: Date | string): AgendaRow[] {
  const start = eventStart === undefined ? null : new Date(eventStart);
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((item, i): AgendaRow[] => {
    if (!item || typeof item !== "object") return [];
    const o = item as Record<string, unknown>;
    const label = [o.label, o.title, o.l].find((x): x is string => typeof x === "string") ?? "";
    let time = "", until = "", day = 0, untilDay = 0, atIso = "", endIso = "";
    if (typeof o.at === "string" && Number.isFinite(Date.parse(o.at))) {
      const at = new Date(o.at), p = zonedParts(at, timeZone);
      atIso = at.toISOString();
      time = `${p.hour}:${p.minute}`;
      if (start && Number.isFinite(start.getTime())) day = untilDay = dayOffset(at, start, timeZone);
      if (typeof o.endAt === "string" && Date.parse(o.endAt) > Date.parse(o.at)) {
        const endAt = new Date(o.endAt), q = zonedParts(endAt, timeZone);
        until = `${q.hour}:${q.minute}`;
        endIso = endAt.toISOString();
        if (start && Number.isFinite(start.getTime())) untilDay = dayOffset(endAt, start, timeZone);
      }
    } else time = [o.time, o.t].find((x): x is string => typeof x === "string") ?? "";
    return label || time ? [{ id: `a${i + 1}`, time, ...(until ? { until } : {}), label, ...(o.emphasis === true ? { emphasis: true } : {}),
      ...(day ? { day } : {}), ...(until && untilDay !== day ? { untilDay } : {}), ...(atIso ? { at: atIso } : {}), ...(endIso ? { endAt: endIso } : {}) }] : [];
  });
}

/** Dirty check over canonical values (key order does not matter). */
export function sameValue(a: unknown, b: unknown): boolean {
  const canon = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon((x as Record<string, unknown>)[k])])) : x;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

const wallClock = (at: number, timeZone: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at)).map(p => [p.type, p.value]));
  return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
};
/**
 * Resolve wall-clock form input with Intl, including DST; reject nonexistent local times (spring-forward gap). A wall
 * time in the fall-back overlap names two instants: the earlier one (the summer offset) is always chosen.
 */
export function localInstant(local: string, timeZone: string): Date {
  const target = new Date(`${local}:00Z`).getTime(), DAY = 86400_000;
  // The zone's offsets around the target (a zone changes offset at most once a day) → the instants with that wall time.
  const found = [target - DAY, target, target + DAY].map(t => target - (wallClock(t, timeZone) - t)).filter(at => wallClock(at, timeZone) === target);
  if (!found.length) throw new Error("InvalidLocalTime");
  return new Date(Math.min(...found));
}
/** A posted wall time → its instant: the row's stored instant while it still shows that wall time, else `localInstant`. */
export function agendaInstant(local: string, timeZone: string, stored: string | undefined): string {
  if (stored && Number.isFinite(Date.parse(stored)) && wallClock(Date.parse(stored), timeZone) === Date.parse(`${local}:00Z`)) return new Date(stored).toISOString();
  return localInstant(local, timeZone).toISOString();
}
