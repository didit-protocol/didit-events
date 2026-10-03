/**
 * /admin/calendar rules: pure, shared by the client form (live counters, blur checks) and the server actions (the
 * authority). No zod: this module ships in the form's client bundle.
 */
export const CALENDAR_NAME_MAX = 80;
export const CALENDAR_TAGLINE_MAX = 120;
export const CALENDAR_BIO_MAX = 600;
export const CALENDAR_URL_MAX = 300;
export const CALENDAR_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const CALENDAR_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export interface CalendarFormValues {
  name: string;
  tagline: string;
  description: string;
  websiteUrl: string;
  xUrl: string;
  linkedinUrl: string;
}
export type CalendarField = keyof CalendarFormValues;
export type CalendarErrors = Partial<Record<CalendarField, string>>;

export type CalendarSaveState =
  | { status: "idle"; values: CalendarFormValues }
  | { status: "invalid"; values: CalendarFormValues; errors: CalendarErrors }
  | { status: "saved"; values: CalendarFormValues; savedAt: string };

export interface CalendarImageState {
  error?: string;
  saved?: boolean;
  removed?: boolean;
}

const LINK_HOSTS: Partial<Record<CalendarField, { hosts: string[]; label: string }>> = {
  xUrl: { hosts: ["x.com", "twitter.com"], label: "an x.com link" },
  linkedinUrl: { hosts: ["linkedin.com"], label: "a linkedin.com link" },
};

/** "" → null; anything else must be an absolute https URL (optionally on the network's own host). */
export function linkError(field: CalendarField, raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  if (v.length > CALENDAR_URL_MAX) return `Keep links under ${CALENDAR_URL_MAX} characters`;
  let url: URL;
  try { url = new URL(v); } catch { return "Use a full link starting with https://"; }
  if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password) return "Use a full link starting with https://";
  const rule = LINK_HOSTS[field];
  if (rule && !rule.hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) return `Use ${rule.label}`;
  return undefined;
}

/** One field's rule (blur) — the same function the full validation runs. */
export function calendarFieldError(field: CalendarField, v: CalendarFormValues): string | undefined {
  switch (field) {
    case "name": {
      const name = v.name.trim();
      if (!name) return "Give the calendar a name";
      return name.length > CALENDAR_NAME_MAX ? `Keep the name under ${CALENDAR_NAME_MAX} characters` : undefined;
    }
    case "tagline":
      return v.tagline.trim().length > CALENDAR_TAGLINE_MAX ? `Keep the tagline under ${CALENDAR_TAGLINE_MAX} characters` : undefined;
    case "description":
      return v.description.trim().length > CALENDAR_BIO_MAX ? `Keep the bio under ${CALENDAR_BIO_MAX} characters` : undefined;
    default:
      return linkError(field, v[field]);
  }
}

const FIELDS: CalendarField[] = ["name", "tagline", "description", "websiteUrl", "xUrl", "linkedinUrl"];

export function validateCalendarForm(v: CalendarFormValues): CalendarErrors {
  const errors: CalendarErrors = {};
  for (const f of FIELDS) {
    const e = calendarFieldError(f, v);
    if (e) errors[f] = e;
  }
  return errors;
}

export function readCalendarForm(form: FormData): CalendarFormValues {
  const str = (k: string) => { const v = form.get(k); return typeof v === "string" ? v.slice(0, 2000) : ""; };
  return { name: str("name"), tagline: str("tagline"), description: str("description"), websiteUrl: str("websiteUrl"), xUrl: str("xUrl"), linkedinUrl: str("linkedinUrl") };
}

/** Valid values → the store input (plain text; bios keep their line breaks, links are normalised by URL). */
export function toCalendarInput(v: CalendarFormValues) {
  const link = (raw: string) => (raw.trim() ? new URL(raw.trim()).href : null);
  return { name: v.name.trim(), tagline: v.tagline.trim(), description: v.description.trim().replace(/\r\n/g, "\n"), websiteUrl: link(v.websiteUrl), xUrl: link(v.xUrl), linkedinUrl: link(v.linkedinUrl) };
}

/** Client pre-check before an upload (the server re-checks the bytes). */
export function imageProblem(file: { size: number; type: string }): string | null {
  if (!CALENDAR_IMAGE_TYPES.includes(file.type)) return "Use a JPG, PNG or WebP image.";
  if (file.size > CALENDAR_IMAGE_MAX_BYTES) return `The file is ${Math.ceil(file.size / (1024 * 1024))} MB. Use an image under 5 MB.`;
  return null;
}
