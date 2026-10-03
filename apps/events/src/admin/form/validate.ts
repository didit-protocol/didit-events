/**
 * A-03 form rules: pure, shared by the client form (preview, dirty state) and the server actions (the authority).
 * No zod here on purpose: this module ships in the form's client bundle.
 */
import { normalizeTime } from "@didit-events/ui/time";
import { type EventFormErrors, type EventFormField, type EventFormValues, type EventInput, type EventQuestion, type Strictness } from "./types";
import { readV2, validateV2, type V2Errors } from "./editor";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const NAME_MAX = 120;
export const VENUE_MAX = 120;
export const STREET_MAX = 160;
export const CITY_MAX = 80;
export const ADDRESS_MAX = 300;
export const QUESTION_MAX = 120;
export const DESCRIPTION_MAX = 500;
export const CAPACITY_MAX = 10000;
export const COVER_MAX_BYTES = 5 * 1024 * 1024;
/** Non-file event fields, incl. the v2 editor JSON (Markdown description + lifecycle email bodies). */
export const EVENT_FIELDS_MAX_BYTES = 512 * 1024;
export const COVER_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Zones staff pick from, with their standard / summer abbreviations for the option label. */
export const TIMEZONES: ReadonlyArray<{ id: string; std: string; dst: string }> = [
  { id: "Europe/Madrid", std: "CET", dst: "CEST" },
  { id: "Europe/Lisbon", std: "WET", dst: "WEST" },
  { id: "Europe/London", std: "GMT", dst: "BST" },
  { id: "Europe/Amsterdam", std: "CET", dst: "CEST" },
  { id: "Europe/Berlin", std: "CET", dst: "CEST" },
  { id: "Europe/Paris", std: "CET", dst: "CEST" },
  { id: "America/New_York", std: "EST", dst: "EDT" },
  { id: "America/Los_Angeles", std: "PST", dst: "PDT" },
  { id: "America/Mexico_City", std: "CST", dst: "CST" },
  { id: "America/Sao_Paulo", std: "BRT", dst: "BRT" },
  { id: "Europe/Dublin", std: "GMT", dst: "IST" },
  { id: "Europe/Brussels", std: "CET", dst: "CEST" },
  { id: "Europe/Zurich", std: "CET", dst: "CEST" },
  { id: "Europe/Rome", std: "CET", dst: "CEST" },
  { id: "Europe/Stockholm", std: "CET", dst: "CEST" },
  { id: "Europe/Warsaw", std: "CET", dst: "CEST" },
  { id: "Europe/Athens", std: "EET", dst: "EEST" },
  { id: "America/Toronto", std: "EST", dst: "EDT" },
  { id: "America/Chicago", std: "CST", dst: "CDT" },
  { id: "America/Denver", std: "MST", dst: "MDT" },
  { id: "America/Bogota", std: "COT", dst: "COT" },
  { id: "Asia/Dubai", std: "GST", dst: "GST" },
  { id: "Asia/Kolkata", std: "IST", dst: "IST" },
  { id: "Asia/Singapore", std: "SGT", dst: "SGT" },
  { id: "Asia/Hong_Kong", std: "HKT", dst: "HKT" },
  { id: "Asia/Tokyo", std: "JST", dst: "JST" },
  { id: "UTC", std: "UTC", dst: "UTC" },
];

/** Countries the manual address offers (the Places flow fills any country Google returns). */
export const COUNTRIES = [
  "Spain", "Portugal", "France", "Germany", "Italy", "Netherlands", "Belgium", "Switzerland", "Austria", "Ireland", "United Kingdom",
  "Sweden", "Denmark", "Norway", "Finland", "Poland", "Greece", "United States", "Canada", "Mexico", "Brazil", "Argentina", "Colombia",
  "United Arab Emirates", "Israel", "India", "Singapore", "Japan", "Australia",
] as const;

export interface CalendarDate {
  y: number;
  m: number; // 1–12
  d: number;
}

/** "23 Oct 2026", "23 october 2026" or "2026-10-23" → a real calendar date, else null. */
export function parseDate(raw: string): CalendarDate | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const human = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(s);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (human) {
    const idx = MONTHS.findIndex((mo) => human[2]!.toLowerCase().startsWith(mo.toLowerCase()));
    if (idx < 0) return null;
    [y, m, d] = [Number(human[3]), idx + 1, Number(human[1])];
  } else return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** "19:00", "9:30", "7pm", "1900" → minutes after midnight, else null (the TimeField's own normaliser). */
export function parseTime(raw: string): number | null {
  const t = normalizeTime(raw);
  return t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const weekday = (c: CalendarDate) => DAYS[new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay()]!;

/** "Fri 23 Oct 2026" */
export const formatDate = (c: CalendarDate) => `${weekday(c)} ${c.d} ${MONTHS[c.m - 1]} ${c.y}`;
/** "23 Oct 2026" (the older free-text field format). */
export const formatFieldDate = (c: CalendarDate) => `${c.d} ${MONTHS[c.m - 1]} ${c.y}`;
/** "2026-10-23" (what the date picker submits). */
export const isoOf = (c: CalendarDate) => `${c.y}-${pad(c.m)}-${pad(c.d)}`;
/** Any accepted date text → ISO, else "" (the picker's value). */
export const toIsoDate = (raw: string) => {
  const c = parseDate(raw);
  return c ? isoOf(c) : "";
};

/** "UTC+02:00" for the zone on that day (noon, so a DST switch night never matters); "UTC" for zero. */
export function utcOffsetLabel(id: string, date: CalendarDate | null, now = new Date()): string {
  const at = date ? new Date(Date.UTC(date.y, date.m - 1, date.d, 12)) : now;
  try {
    const v = new Intl.DateTimeFormat("en-US", { timeZone: id, timeZoneName: "longOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    return v === "GMT" || v === "GMT+00:00" ? "UTC" : v.replace("GMT", "UTC");
  } catch {
    return "";
  }
}

/** Timezone search: "madrid", "new york", "CEST", "tokyo" all match. */
export function searchTimezones(query: string): typeof TIMEZONES {
  const q = query.trim().toLowerCase().replace(/[\s_]+/g, " ");
  if (!q) return TIMEZONES;
  return TIMEZONES.filter((z) => {
    const id = z.id.toLowerCase().replace(/_/g, " ");
    const city = id.split("/").at(-1)!;
    return city.startsWith(q) || id.includes(q) || z.std.toLowerCase() === q || z.dst.toLowerCase() === q;
  });
}
/** "New York" from "America/New_York". */
export const timezoneCity = (id: string) => id.split("/").at(-1)!.replace(/_/g, " ");

/** Option label "Europe/Madrid (CEST)": the abbreviation follows the event date (summer time or not). */
export function timezoneLabel(id: string, date: CalendarDate | null): string {
  const tz = TIMEZONES.find((z) => z.id === id);
  if (!tz) return id;
  // No date yet: the summer name, as drawn in A-03a ("Europe/Madrid (CEST)").
  if (tz.std === tz.dst || !date) return `${id} (${tz.dst})`;
  const offset = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: id, timeZoneName: "longOffset" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "";
  // Every listed zone with DST is northern, so "offset differs from January" means summer time.
  const summer = offset(new Date(Date.UTC(date.y, date.m - 1, date.d, 12))) !== offset(new Date(Date.UTC(date.y, 0, 1, 12)));
  return `${id} (${summer ? tz.dst : tz.std})`;
}

/** The question row's type line: "Short text · required". */
export const questionMeta = (q: EventQuestion) => `${q.kind === "long" ? "Long text" : "Short text"}${q.required ? " · required" : ""}`;

/** The error banner: "Fix 3 fields before saving." */
export const fixFieldsMessage = (n: number) => `Fix ${n} ${n === 1 ? "field" : "fields"} before saving.`;

export interface CoverFile {
  size: number;
  type: string;
}

const POSTAL = /^[A-Za-z0-9][A-Za-z0-9 -]{1,10}$/;
const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;

/** The address parts a form carries (manual entry or a picked place). */
export interface AddressParts {
  street: string;
  city: string;
  postalCode: string;
  country: string;
}
/** "Carrer de Pallars 99, 08018 Barcelona, Spain". */
export function composeAddress(p: AddressParts): string {
  return [p.street.trim(), [p.postalCode.trim(), p.city.trim()].filter(Boolean).join(" "), p.country.trim()].filter(Boolean).join(", ");
}
/**
 * Best-effort split of a legacy one-line address into parts (so an older event opens in the structured fields):
 * "Carrer de Pallars 99, 08018 Barcelona" → street, postal code, city. Anything unclear stays in the street.
 */
export function splitAddress(address: string): AddressParts {
  const parts = address.split(",").map((x) => x.trim()).filter(Boolean);
  const out: AddressParts = { street: "", city: "", postalCode: "", country: "" };
  if (!parts.length) return out;
  const country = parts.length > 1 ? COUNTRIES.find((c) => c.toLowerCase() === parts.at(-1)!.toLowerCase()) : undefined;
  if (country) {
    out.country = country;
    parts.pop();
  }
  if (parts.length > 1) {
    const last = parts.pop()!;
    const m = /^(\d[\d -]{2,9}\d)\s+(.+)$/.exec(last) ?? /^(.+?)\s+(\d[\d -]{2,9}\d)$/.exec(last);
    if (m && /^\d/.test(m[1]!)) [out.postalCode, out.city] = [m[1]!, m[2]!];
    else if (m) [out.city, out.postalCode] = [m[1]!, m[2]!];
    else out.city = last;
  }
  out.street = parts.join(", ");
  return out;
}
const hasParts = (v: EventFormValues) => Boolean(v.street.trim() || v.city.trim() || v.postalCode.trim() || v.country.trim());
/** The one-line address that is saved: Google's for a picked place, composed for manual parts, else as typed. */
export const effectiveAddress = (v: EventFormValues) => (v.placeId ? v.address.trim() : hasParts(v) ? composeAddress(v) : v.address.trim());

/** A picked place is only kept when every Google field is well-formed. */
function placeOf(v: EventFormValues): { placeId: string; lat: number; lng: number; mapsUrl: string } | null {
  if (!v.placeId) return null;
  const lat = Number(v.lat), lng = Number(v.lng);
  let host = "";
  try { host = new URL(v.mapsUrl).hostname; } catch { /* invalid */ }
  const google = v.mapsUrl.startsWith("https://") && (host === "maps.google.com" || host === "google.com" || host.endsWith(".google.com") || host === "goo.gl" || host === "maps.app.goo.gl");
  if (!PLACE_ID.test(v.placeId) || v.lat.trim() === "" || v.lng.trim() === "" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || !google || v.mapsUrl.length > 500) return null;
  return { placeId: v.placeId, lat, lng, mapsUrl: v.mapsUrl };
}

/** End earlier than start: the event would cross midnight (same-day events only). */
export const END_BEFORE_START = "End must be after start. Events can’t run past midnight.";

/** Every rule of the A-03 form. Returns one message per invalid field (empty object = valid). */
export function validateEventForm(v: EventFormValues, cover?: CoverFile | null): EventFormErrors {
  const e: EventFormErrors = {};
  const name = v.name.trim();
  if (!name) e.name = "Give the event a name";
  else if (name.length > NAME_MAX) e.name = `Keep the name under ${NAME_MAX} characters`;

  if (!v.date.trim()) e.date = "Pick a date";
  else if (!parseDate(v.date)) e.date = "Use a date like 23 Oct 2026";

  const start = parseTime(v.start);
  const end = parseTime(v.end);
  if (!v.start.trim()) e.start = "Add a start time";
  else if (start === null) e.start = "Use a time like 19:00";
  if (!v.end.trim()) e.end = "Add an end time";
  else if (end === null) e.end = "Use a time like 23:00";
  else if (start !== null && end === start) e.end = "End must be after start";
  // Same-day events only: an end before the start would cross midnight.
  else if (start !== null && end < start) e.end = END_BEFORE_START;

  if (!TIMEZONES.some((z) => z.id === v.timezone)) e.timezone = "Pick a timezone";

  const venue = v.venue.trim();
  if (!venue) e.venue = "Add a venue";
  else if (venue.length > VENUE_MAX) e.venue = `Keep the venue under ${VENUE_MAX} characters`;
  if (v.placeId) {
    if (!placeOf(v) || !v.address.trim()) e.address = "Pick the location again";
  } else if (hasParts(v)) {
    if (!v.street.trim()) e.street = "Add the street";
    else if (v.street.trim().length > STREET_MAX) e.street = `Keep the street under ${STREET_MAX} characters`;
    if (!v.city.trim()) e.city = "Add the city";
    else if (v.city.trim().length > CITY_MAX) e.city = `Keep the city under ${CITY_MAX} characters`;
    if (v.postalCode.trim() && !POSTAL.test(v.postalCode.trim())) e.postalCode = "Use a postal code like 08018";
    if (v.country.trim() && !(COUNTRIES as readonly string[]).includes(v.country.trim())) e.country = "Pick a country";
  } else if (!v.address.trim()) e.address = "Add the address";
  if (!e.address && effectiveAddress(v).length > ADDRESS_MAX) e.address = `Keep the address under ${ADDRESS_MAX} characters`;

  const cap = v.capacity.trim();
  if (!/^\d+$/.test(cap) || Number(cap) < 1) e.capacity = "At least 1";
  else if (Number(cap) > CAPACITY_MAX) e.capacity = `At most ${CAPACITY_MAX.toLocaleString("en-US")}`;

  if (v.description.trim().length > DESCRIPTION_MAX) e.description = `Keep it under ${DESCRIPTION_MAX} characters`;
  if (!v.v2 && v.questions.some((q) => !q.label.trim())) e.questions = "Every question needs a label";

  if (cover && cover.size > 0) {
    if (!COVER_TYPES.includes(cover.type)) e.cover = "Use a JPG or PNG";
    else if (cover.size > COVER_MAX_BYTES) e.cover = "Up to 5 MB";
  }
  if (v.v2) Object.assign(e, v2FieldErrors(validateV2(v.v2, eventStartLocal(v), v.timezone)));
  return e;
}

/** "2026-10-23T19:00" for the closing-time rule, when date and start are valid. */
export function eventStartLocal(v: EventFormValues): string | undefined {
  const d = parseDate(v.date), t = parseTime(v.start);
  return d && t !== null ? `${isoOf(d)}T${pad(Math.floor(t / 60))}:${pad(t % 60)}` : undefined;
}

/** v2 messages grouped under the section they belong to (the first message of each group). */
export function v2FieldErrors(v2: V2Errors): EventFormErrors {
  const out: EventFormErrors = {};
  for (const [k, msg] of Object.entries(v2)) {
    const field: EventFormField = k === "descriptionMd" ? "descriptionMd" : k === "agenda" || k.startsWith("agenda:") ? "agenda" : k === "coverAlt" ? "cover"
      : k === "age" ? "verification" : k === "threshold" ? "door" : k.startsWith("email:") ? "emails" : "registration";
    out[field] ??= msg;
  }
  return out;
}

/** One field's message for blur validation: the same rules as the full check, so client and server agree. */
export function validateEventField(field: EventFormField, v: EventFormValues): string | undefined {
  return validateEventForm(v)[field];
}

/** Valid values → the service input (call only when `validateEventForm` returned no errors). */
export function toEventInput(v: EventFormValues): EventInput {
  const d = parseDate(v.date)!;
  const day = `${d.y}-${pad(d.m)}-${pad(d.d)}`;
  const hm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
  const place = placeOf(v);
  return {
    name: v.name.trim(),
    startsAtLocal: `${day}T${hm(parseTime(v.start)!)}`,
    endsAtLocal: `${day}T${hm(parseTime(v.end)!)}`,
    timezone: v.timezone,
    venue: v.venue.trim(),
    address: effectiveAddress(v),
    placeId: place?.placeId ?? null,
    lat: place?.lat ?? null,
    lng: place?.lng ?? null,
    mapsUrl: place?.mapsUrl ?? null,
    capacity: Number(v.capacity.trim()),
    description: v.description.trim(),
    requestForm: v.requestForm,
    questions: v.questions.filter((q) => q.label.trim()),
    welcomeEmail: v.welcomeEmail,
    matchThreshold: v.threshold,
    ...(v.v2 ? { v2: v.v2 } : {}),
  };
}

const asStrictness = (raw: unknown): Strictness => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 60 && n <= 99 ? n : 80;
};

/** Custom request-form questions per event; the form stops adding at this count and the server keeps at most this. */
export const MAX_QUESTIONS = 20;

function readQuestions(raw: unknown): EventQuestion[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.slice(0, MAX_QUESTIONS).flatMap((q, i): EventQuestion[] => {
      if (!q || typeof q !== "object") return [];
      const o = q as Record<string, unknown>;
      const label = typeof o.label === "string" ? o.label.trim().slice(0, QUESTION_MAX) : "";
      if (!label) return [];
      return [{ id: typeof o.id === "string" && o.id ? o.id.slice(0, 40) : `q${i + 1}`, label, kind: o.kind === "long" ? "long" : "short", required: o.required === true }];
    });
  } catch {
    return [];
  }
}

/** The optional cover upload (an empty file input posts a 0-byte File). */
export function readCover(form: FormData): CoverFile | null {
  const f = form.get("cover");
  return typeof f === "object" && f !== null && "size" in f && f.size > 0 ? { size: f.size, type: f.type } : null;
}

/** FormData (the A-03 form's field names) → values. Unknown/missing fields read as empty. */
export function readEventForm(form: FormData): EventFormValues {
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };
  const values: EventFormValues = {
    name: str("name"),
    date: str("date"),
    start: str("start"),
    end: str("end"),
    timezone: str("timezone"),
    venue: str("venue"),
    address: str("address"),
    street: str("street"),
    city: str("city"),
    postalCode: str("postalCode"),
    country: str("country"),
    placeId: str("placeId"),
    lat: str("lat"),
    lng: str("lng"),
    mapsUrl: str("mapsUrl"),
    capacity: str("capacity").replace(/[,\s]/g, ""),
    description: str("description"),
    requestForm: form.get("requestForm") === "on",
    questions: readQuestions(form.get("questions")),
    welcomeEmail: form.get("welcomeEmail") === "on",
    threshold: asStrictness(form.get("threshold")),
  };
  const v2 = readV2(form.get("v2"));
  return v2 ? { ...values, v2 } : values;
}

/** The guest-page preview card (right column): "Fri 23 Oct 2026 · 19:00–23:00" + "Didit HQ, Carrer de Pallars 99". */
export function previewOf(v: EventFormValues): { name: string | null; when: string | null; where: string | null } {
  const d = parseDate(v.date);
  const s = parseTime(v.start);
  const en = parseTime(v.end);
  const hm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
  const time = s !== null ? (en !== null && en > s ? `${hm(s)}–${hm(en)}` : hm(s)) : null;
  const when = [d ? formatDate(d) : null, time].filter(Boolean).join(" · ") || null;
  const street = effectiveAddress(v).split(",")[0]?.trim();
  const where = [v.venue.trim(), street].filter(Boolean).join(", ") || null;
  return { name: v.name.trim() || null, when, where };
}

/** "✓ Saved · just now" / "✓ Saved · 3 min ago". */
export function savedLabel(savedAt: string, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(savedAt).getTime()) / 1000));
  return s < 60 ? "Saved · just now" : `Saved · ${Math.floor(s / 60)} min ago`;
}

/** New-form dirty check: "Create event" stays disabled until something was typed (A-03a). */
export function isPristine(v: EventFormValues, initial: EventFormValues): boolean {
  return JSON.stringify(v) === JSON.stringify(initial);
}
