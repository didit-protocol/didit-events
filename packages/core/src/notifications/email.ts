import { contactEmail } from "../contact-email.ts";
import { eventCoverUrl, eventWideCoverUrl } from "../content/event-assets.ts";
import { getDb,type Db } from "../db/index.ts";
import { queryable,type Queryable,type Tx } from "../db/tx.ts";
import { eventEmailCodeSchema,type EventEmails } from "../domain/event-model.ts";
import { DIDIT_SENT_CODES,EMAIL_CODES,renderEmail,type EmailCode,type EmailDataByCode,type EmailEvent,type Recipient } from "../email/index.ts";
import { emailAssetsUrl,emailFontAssetsUrl,eventImageUrl,type CoverTheme } from "../email/media.ts";
import { enqueue,PermanentOutboxError,type OutboxHandler,type OutboxMessage,type OutboxRegistry } from "../outbox.ts";
import { DEFAULT_EMAIL_FROM,sendResendEmail,type ResendConfig } from "./resend.ts";
import { currentEmailState } from "./email-state.ts";
import { hostDigestData,hostRequestData } from "./host-request-data.ts";
import { profileGaps, profileReminderEligible } from "./profile-reminder.ts";
import type { InlineImage } from "./inline-photo.ts";
import { buildCalendarInvite,calendarAttachment,calendarUid,isCalendarRef,type CalendarMethod } from "./calendar-invite.ts";

/**
 * Reminders an account can opt out of (accounts.email_reminders): lifecycle reminders and the M-29 profile reminder.
 * Service notices about a held place are always sent.
 */
export const REMINDER_CODES: readonly EmailCode[] = ["M-05", "M-11", "M-12", "M-14", "M-29"];
export const emailKind = (code: EmailCode): string => `email:${code}`;
export const isDiditSent = (code: string): boolean => (DIDIT_SENT_CODES as readonly string[]).includes(code);
export const canonicalEmailCode = (code:EmailCode):EmailCode => ({"E-01":"M-03","E-02":"M-13","E-03":"M-02"} as Partial<Record<EmailCode,EmailCode>>)[code] ?? code;

/** Payload of an `email:<code>` outbox row: references, never a rendered body or an address when an account exists. */
export interface EmailPayload {
  code: EmailCode;
  /** Recipient account; its current email/first name are read at send time. */
  accountId?: string;
  /** Explicit address for mail to a non-account (staff invite). */
  to?: string;
  /** Extra visible recipients (host notices: the first host in `to`, the other hosts in CC on one message). */
  cc?: string[];
  eventId?: string;
  /** Code-specific template fields. Dates are encoded as {"$date": iso}. */
  data?: Record<string, unknown>;
}

export function encodeData(value: unknown): unknown {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(encodeData);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encodeData(v)]));
  return value;
}
export function decodeData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeData);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length === 1 && typeof record.$date === "string") return new Date(record.$date);
    return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, decodeData(v)]));
  }
  return value;
}

/**
 * Transactional enqueue of an email. The caller's transaction holds its own ordered locks; this only inserts
 * the outbox row (no locks on domain rows). Returns the new outbox id, or null when the dedupe key exists.
 */
export async function enqueueEmail(tx: Tx, input: { code: EmailCode; dedupeKey: string; accountId?: string; to?: string; cc?: string[]; eventId?: string; data?: Record<string, unknown>; runAt?: Date }): Promise<string | null> {
  if (!EMAIL_CODES.includes(input.code)) throw new Error("UnknownEmailCode");
  if (isDiditSent(input.code)) throw new Error("DiditSentEmailCode");
  if (!input.accountId === !input.to) throw new Error("EmailNeedsExactlyOneRecipient");
  if (!input.dedupeKey.startsWith(`${emailKind(input.code)}:`)) throw new Error("EmailDedupeKeyMustBeScoped");
  const canonical=canonicalEmailCode(input.code);
  if(canonical!==input.code) input={...input,code:canonical,dedupeKey:input.dedupeKey.replace(`email:${input.code}:`,`email:${canonical}:`)};
  const payload: EmailPayload = { code: input.code, ...(input.accountId ? { accountId: input.accountId } : { to: input.to! }), ...(input.cc?.length ? { cc: [...new Set(input.cc.map(c => c.trim().toLowerCase()))] } : {}), ...(input.eventId ? { eventId: input.eventId } : {}), ...(input.data ? { data: encodeData(input.data) as Record<string, unknown> } : {}) };
  return enqueue(tx, { kind: emailKind(input.code), dedupeKey: input.dedupeKey, payload: payload as unknown as Record<string, unknown>, runAt: input.runAt });
}

export interface EventEmailRow {
  id: string; slug: string; name: string; starts_at: Date; ends_at: Date; timezone: string; venue: string | null; address: string | null; status: string;
  cover?: unknown; lat?: number | null; lng?: number | null;
}
export const EVENT_COLUMNS = "id,slug,name,starts_at,ends_at,timezone,venue,address,status,cover,emails,door,lat,lng";
const trim = (u: string) => u.replace(/\/$/, "");

/** Splits "Carrer de Pallars 99, Barcelona" into street and city (last comma-separated part). */
export function splitAddress(address: string | null): { street: string; city: string } {
  const parts = (address ?? "").split(",").map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return { street: parts[0] ?? "", city: "" };
  return { street: parts.slice(0, -1).join(", "), city: parts.at(-1)! };
}
const coverTheme = (cover: unknown): CoverTheme => (cover as { kind?: string; theme?: string } | null)?.kind === "theme" && (cover as { theme?: string }).theme === "sky" ? "sky" : "aqua";
/** The event as emails see it. The hero is the banner/cover/OG image on APP_URL when that origin is public, else the event's theme art on the asset base. */
export function toEmailEvent(row: EventEmailRow, baseUrl: string, assetsUrl = emailAssetsUrl(baseUrl)): EmailEvent {
  const base = trim(baseUrl);
  const uploaded = eventWideCoverUrl(row.id, row.cover) ?? eventCoverUrl(row.id, row.cover);
  const coverImageUrl = eventImageUrl(uploaded ?? `/e/${row.slug}/opengraph-image`, base, assetsUrl, coverTheme(row.cover));
  return {
    name: row.name,
    shortName: row.name,
    url: `${base}/e/${row.slug}`,
    coverImageUrl,
    // The OG cover and the theme art are both 1200×630; an uploaded banner's size varies.
    ...(uploaded && coverImageUrl === `${base}${uploaded}` ? {} : { coverSize: { width: 1200, height: 630 } }),
    startsAt: row.starts_at, endsAt: row.ends_at, timeZone: row.timezone,
    venueName: row.venue ?? "", ...splitAddress(row.address),
  };
}
export const mapsUrl = (row: Pick<EventEmailRow, "venue" | "address">): string =>
  `https://maps.google.com/?q=${encodeURIComponent([row.venue, row.address].filter(Boolean).join(", "))}`;

export interface EmailConfig {
  /** Absolute public origin (APP_URL). Every link in an email is built from it. */
  baseUrl: string;
  /** Public https origin of the static email assets (EMAIL_ASSETS_URL); defaults to APP_URL when public, else production. */
  assetsUrl?: string;
  /** RFC 5322 sender on the verified domain (EMAIL_FROM). Its display name is used; a bare address gets the template's. */
  from?: string;
  /** Reply-To for every email; defaults to the team mailbox. */
  replyTo?: string;
  resend: ResendConfig;
  db?: Db;
  now?: () => Date;
}
/**
 * The From header: the configured display name ("Example Events <events@example.test>") when EMAIL_FROM has one; a bare
 * address, or no EMAIL_FROM at all, gets the template's name ("Didit Events", the default).
 */
export function sender(templateName: string, configured: string | undefined): string {
  const from = (configured ?? DEFAULT_EMAIL_FROM).trim();
  const match = /^([\s\S]*?)<([^<>]+)>\s*$/.exec(from);
  const address = (match?.[2] ?? from).replace(/[<>"\s]/g, "");
  const name = (configured !== undefined ? match?.[1] ?? "" : "").trim().replace(/^"(.*)"$/, "$1").trim() || templateName;
  return `${name.replace(/[<>"\r\n]/g, "")} <${address}>`;
}

/** Binds a payload to template data at send time: base URL, recipient and event row, then code-specific fields. */
export async function bindEmail(q: Queryable, payload: EmailPayload, baseUrl: string, now = new Date(), assetsOrigin?: string): Promise<{ to: string; data: Record<string, unknown>; calendar?: { ics: string; method: CalendarMethod }; inline?: InlineImage[] }> {
  if (!/^https?:\/\//.test(baseUrl)) throw new PermanentOutboxError("base_url_not_absolute");
  const assetsUrl = emailAssetsUrl(baseUrl, assetsOrigin);
  let to = payload.to, recipient: Recipient | undefined;
  if (payload.accountId) {
    const [account] = await q.query<{ email: string; first_name: string | null; deleting_at: Date | null; deleted_at: Date | null; email_reminders: boolean }>(
      "select email,first_name,deleting_at,deleted_at,email_reminders from accounts where id=$1", [payload.accountId]);
    if (!account || account.deleting_at || account.deleted_at) throw new PermanentOutboxError("suppressed_account");
    if (REMINDER_CODES.includes(payload.code) && !account.email_reminders) throw new PermanentOutboxError("suppressed_preference");
    to = account.email;
    recipient = { email: account.email, firstName: account.first_name?.trim() || "there" };
  }
  if (!to) throw new PermanentOutboxError("missing_recipient");
  let event: EmailEvent | undefined, eventRow: EventEmailRow | undefined;
  let eventSettings: Record<string,unknown> = {};
  if (payload.eventId) {
    const [row] = await q.query<EventEmailRow & Record<string, unknown>>(`select ${EVENT_COLUMNS} from events where id=$1`, [payload.eventId]);
    if (!row) throw new PermanentOutboxError("missing_event");
    const settings=row.emails as EventEmails;
    const code=eventEmailCodeSchema.safeParse(payload.code);
    if(code.success && settings?.templates[code.data]?.enabled===false)throw new PermanentOutboxError("suppressed_event_template");
    eventSettings={eventEmails:settings,door:row.door};
    event = toEmailEvent(row, baseUrl, assetsUrl); eventRow = row;
  }
  // Stored payloads carry app-relative links ("/e/slug/event.ics"); every *Url becomes absolute on APP_URL here.
  const extra = Object.fromEntries(Object.entries(decodeData(payload.data ?? {}) as Record<string, unknown>)
    .map(([k, v]) => [k, k.endsWith("Url") && typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? `${trim(baseUrl)}${v}` : v]));
  if(event && payload.code==="M-02" && !extra.replyBy)extra.replyBy=event.startsAt;
  // v5 calendar invite: the step (UID/SEQUENCE/METHOD) was fixed at enqueue time; the body reflects the event now.
  let calendar: { ics: string; method: CalendarMethod } | undefined;
  if (isCalendarRef(extra.calendar) && eventRow && event) {
    const ref = extra.calendar;
    calendar = { method: ref.method, ics: buildCalendarInvite({ method: ref.method, uid: calendarUid(ref.registrationId), sequence: ref.sequence, now,
      startsAt: eventRow.starts_at, endsAt: eventRow.ends_at, summary: eventRow.name, venue: eventRow.venue, address: eventRow.address,
      geo: eventRow.lat != null && eventRow.lng != null ? { lat: Number(eventRow.lat), lng: Number(eventRow.lng) } : null,
      url: event.url, attendee: { email: to, ...(recipient && recipient.firstName !== "there" ? { name: recipient.firstName } : {}) } }) };
  }
  delete extra.calendar;
  // Host notices: applicant photos travel as inline attachments (`cid:`), never as a link to a non-public photo.
  let inline: InlineImage[] = [];
  if(payload.code==="M-25"||payload.code==="M-26"){const host=await (payload.code==="M-25"?hostRequestData:hostDigestData)(q,payload,extra,trim(baseUrl));Object.assign(extra,host.data);inline=host.inline;to=payload.to??to;}
  if(payload.code==="M-28"&&payload.accountId) {
    // Read at send time: a profile completed meanwhile drops the "Complete your profile" link.
    const [a]=await q.query<{first_name:string|null;complete:boolean}>("select first_name,profile_completed_at is not null complete from accounts where id=$1",[payload.accountId]);
    extra.firstName=a?.first_name?.trim()||null;extra.exploreUrl=`${trim(baseUrl)}/events`;extra.profileUrl=a?.complete?null:`${trim(baseUrl)}/me/profile/edit`;
  }
  if(payload.code==="M-29"&&payload.accountId) {
    // Re-read at send time: a profile completed since the job queued this drops the email.
    // …and the rest of the job's rule (age window + 1 day of outbox delay, not staff, account live).
    if(!await profileReminderEligible(q,payload.accountId)) throw new PermanentOutboxError("suppressed_ineligible");
    const missing=await profileGaps(q,payload.accountId);
    if(!missing.length) throw new PermanentOutboxError("suppressed_profile_complete");
    const [a]=await q.query<{first_name:string|null}>("select first_name from accounts where id=$1",[payload.accountId]);
    extra.firstName=a?.first_name?.trim()||null;extra.missing=missing;extra.profileUrl=`${trim(baseUrl)}/me/profile/edit`;
  }
  if(event && ["M-03","E-01"].includes(payload.code)) {
    extra.linkExpiresAt=event.startsAt;
    extra.verifyUrl=`${trim(baseUrl)}/me/events/${new URL(event.url).pathname.split("/").at(-1)}`;
  }
  const current=await currentEmailState(q,payload,now);
  const data = { baseUrl: trim(baseUrl), assetsUrl, fontAssetsUrl: emailFontAssetsUrl(baseUrl, assetsOrigin), ...(recipient ? { recipient } : {}), ...(event ? { event } : {}), ...extra, ...eventSettings,...current,
    ...(current.statusUrl?{statusUrl:`${trim(baseUrl)}${current.statusUrl}`}:{}) };
  return { to, data, ...(calendar ? { calendar } : {}), ...(inline.length ? { inline } : {}) };
}

/** The `email:<code>` outbox handler: bind → render → Resend with Idempotency-Key = dedupe key. */
export function emailHandler(config: EmailConfig): OutboxHandler {
  return async (message: OutboxMessage, { signal }) => {
    const payload = message.payload as unknown as EmailPayload | null;
    const code = message.kind.slice("email:".length);
    if (!payload || payload.code !== code || !EMAIL_CODES.includes(payload.code)) throw new PermanentOutboxError("invalid_payload");
    if (isDiditSent(payload.code)) throw new PermanentOutboxError("didit_sent_code");
    const { to, data, calendar, inline } = await bindEmail(queryable(config.db ?? getDb()), payload, config.baseUrl, config.now?.(), config.assetsUrl);
    let rendered;
    try { rendered = renderEmail(payload.code, data as unknown as EmailDataByCode[typeof payload.code], eventEmailCodeSchema.safeParse(payload.code).success ? (data.eventEmails as EventEmails|undefined)?.templates[payload.code as keyof EventEmails["templates"]] : undefined); } catch { throw new PermanentOutboxError("render_failed"); }
    return sendResendEmail(config.resend, {
      from: sender(rendered.from.name, config.from), to: [to], ...(payload.cc?.length ? { cc: payload.cc.filter(c => c !== to) } : {}), reply_to: config.replyTo ?? contactEmail(), subject: rendered.subject, html: rendered.html, text: rendered.text,
      tags: [{ name: "code", value: payload.code.replace("-", "_") }],
      ...(calendar || inline ? { attachments: [...(calendar ? [calendarAttachment(calendar.ics, calendar.method)] : []), ...(inline ?? [])] } : {}),
    }, message.dedupe_key, signal);
  };
}

/**
 * Registers a handler for every code we send. Didit-sent codes get a handler that fails permanently without
 * calling Resend, so a stray row can never be dispatched or retried forever.
 */
export function registerEmailHandlers(registry: OutboxRegistry, config: EmailConfig): void {
  const send = emailHandler(config);
  for (const code of EMAIL_CODES) {
    registry.register(emailKind(code), isDiditSent(code) ? async () => { throw new PermanentOutboxError("didit_sent_code"); } : send);
  }
}
