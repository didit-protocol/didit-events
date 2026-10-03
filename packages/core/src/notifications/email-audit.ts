// Email QA: renders every template the way the outbox sends it (asset base and event images bound like bindEmail),
// with rich and minimal data, and lists what would break in an inbox. Used by email-audit.test.ts and by
// `pnpm email:audit` (scripts/email-audit.ts), which also writes the HTML and HEAD-checks every image URL.
import { aiEraEvent,emailFixtures,FIXTURE_NOW,officeOpeningEvent } from "../email/fixtures.ts";
import { EMAIL_CODES,renderEmail,type EmailCode,type EmailDataByCode,type EmailEvent,type RenderedEmail } from "../email/index.ts";
import { emailAssetsUrl,isPublicHttpsOrigin } from "../email/media.ts";
import { isCid } from "../email/layout.ts";
import { EMAIL_RADII } from "../email/tokens.ts";
import { buildCalendarInvite,CALENDAR_METHOD_BY_CODE,calendarAttachment,calendarUid,type CalendarMethod } from "./calendar-invite.ts";
import { toEmailEvent,type EventEmailRow } from "./email.ts";

export type AuditFixture = "rich" | "minimal";

export interface AuditOptions {
  /** APP_URL of the sending instance; defaults to a local one (the case that used to send broken images). */
  appUrl?: string;
  /** EMAIL_ASSETS_URL. */
  assetsOrigin?: string;
}

export interface AuditRow {
  code: EmailCode;
  fixture: AuditFixture;
  subject: string;
  rendered: RenderedEmail;
  /** Every image the mail client fetches (img src, background, VML fill, web font). */
  images: string[];
  /** The calendar attachment the send carries, when the code has one. */
  attachment?: { filename: string; content_type: string; method: CalendarMethod; ics: string };
  problems: string[];
}

const ZERO_ID = "00000000-0000-4000-8000-000000000001";
const VERSION = "00000000-0000-4000-8000-0000000000aa";

/** A fixture event as the binder builds it from an event row: hero and links on `appUrl`, assets on the asset base. */
function boundEvent(e: EmailEvent, slug: string, appUrl: string, assetsUrl: string, cover: unknown, address = true): EmailEvent {
  const row: EventEmailRow = {
    id: ZERO_ID, slug, name: e.name, starts_at: e.startsAt, ends_at: e.endsAt, timezone: e.timeZone,
    venue: address ? e.venueName : null, address: address ? `${e.street}, ${e.city}` : null, status: "published", cover,
  };
  return { ...toEmailEvent(row, appUrl, assetsUrl), ...(address ? { shortName: e.shortName } : {}) };
}

const trim = (u: string) => u.replace(/\/+$/, "");

/** The design fixtures, bound for a real send: uploaded banner, every optional field filled. */
export function richFixtures(opts: AuditOptions = {}): EmailDataByCode {
  const appUrl = trim(opts.appUrl ?? "http://localhost:3332"), assetsUrl = emailAssetsUrl(appUrl, opts.assetsOrigin);
  const banner = { kind: "asset", version: VERSION, alt: "Banner", wide: { version: VERSION } };
  const events = new Map<EmailEvent, EmailEvent>([
    [aiEraEvent, boundEvent(aiEraEvent, "ai-era", appUrl, assetsUrl, banner)],
    [officeOpeningEvent, boundEvent(officeOpeningEvent, "barcelona-office-opening", appUrl, assetsUrl, { kind: "theme", theme: "sky" })],
  ]);
  return Object.fromEntries(EMAIL_CODES.map((code) => {
    const f = emailFixtures[code] as unknown as Record<string, unknown> & { event?: EmailEvent };
    const event = f.event ? (events.get(f.event) ?? boundEvent(f.event, "ai-era", appUrl, assetsUrl, banner)) : undefined;
    return [code, { ...f, baseUrl: "https://events.didit.me", assetsUrl, ...(event ? { event: { ...event, startsAt: f.event!.startsAt } } : {}) }];
  })) as unknown as EmailDataByCode;
}

/** Only what every producer always sends: no agenda, no answers, no optional copy, an event without venue or cover. */
export function minimalFixtures(opts: AuditOptions = {}): EmailDataByCode {
  const appUrl = trim(opts.appUrl ?? "http://localhost:3332"), assetsUrl = emailAssetsUrl(appUrl, opts.assetsOrigin);
  const b = { baseUrl: appUrl, assetsUrl };
  const event = boundEvent({ ...aiEraEvent, name: "Door lab (local)" }, "door-lab", appUrl, assetsUrl, { kind: "theme", theme: "aqua" }, false);
  const recipient = { firstName: "there", email: "guest@example.com" };
  const url = (p: string) => `${appUrl}${p}`;
  const at = FIXTURE_NOW, tz = "Europe/Madrid";
  const counts = { pending: 1, waitlisted: 0, capacity: 10, capacityLeft: 9 };
  const data: EmailDataByCode = {
    "M-01": { ...b, code: "481903", expiresInMinutes: 10 },
    "M-02": { ...b, recipient, event, replyBy: event.startsAt },
    "M-03": { ...b, recipient, event, verifyUrl: url("/me/events/door-lab"), linkExpiresAt: event.startsAt },
    "M-04": { ...b, code: "730215", email: recipient.email, expiresInMinutes: 10 },
    "M-05": { ...b, recipient, verifyUrl: url("/me/events/door-lab"), deadline: event.startsAt, timeZone: tz },
    "M-06": { ...b, recipient, event, googleCalendarUrl: "https://calendar.google.com/calendar/render?action=TEMPLATE", icsUrl: url("/e/door-lab/event.ics") },
    "M-07": { ...b },
    "M-08": { ...b, retryUrl: url("/me/events/door-lab"), attemptsLeft: 0 },
    "M-09": { ...b, event, position: 1 },
    "M-10": { ...b, recipient, event, subscribeUrl: url("/events") },
    "M-11": { ...b, event, teaser: "", agenda: [], directionsUrl: "https://maps.google.com/?q=" },
    "M-12": { ...b, event, directions: "", mapsUrl: "https://maps.google.com/?q=" },
    "M-13": { ...b, recipient, event, checkedInAt: at, arrivalNote: "", tonight: [] },
    "M-14": { ...b, event, attendeeCount: 0, recap: { preheader: "", line: "" }, recordingsUrl: url("/e/door-lab"), photosUrl: url("/e/door-lab") },
    "M-15": { ...b, event, requestAgainUrl: url("/e/door-lab") },
    "M-16": { ...b, event, change: { kind: "venue", before: "" }, calendarUrl: url("/e/door-lab/event.ics") },
    "M-17": { ...b, email: recipient.email, code: "481903", expiresInMinutes: 5, requestedAt: at, timeZone: tz, device: "" },
    "M-18": { ...b, recipient, myEventsUrl: url("/me") },
    "M-19": { ...b, event, pitch: event.name, inviter: { firstName: "A host" }, acceptUrl: url("/e/door-lab/invite/x") },
    "M-20": { ...b, event, kind: "withdrawn", cancelledAt: at, requestAgainUrl: url("/e/door-lab/register") },
    "M-21": { ...b, recipient, event, otherEventsUrl: url("/events") },
    "M-22": { ...b, cancelledPlaces: 0, cancelledRequests: 0 },
    "M-23": { ...b, recipient, event, verifiedEmail: recipient.email, googleCalendarUrl: "https://calendar.google.com/calendar/render?action=TEMPLATE", icsUrl: url("/e/door-lab/event.ics") },
    "M-24": { ...b, event, guest: { name: "Guest", email: recipient.email }, checkedInAt: at, checkedInBy: "", undoneAt: at, undoneBy: { name: "Host", role: "Host" }, checkInLogUrl: url("/admin/events/door-lab") },
    "M-25": {
      ...b, event, kind: "request",
      applicant: { name: "Guest", email: recipient.email, photoUrl: null, headline: "", company: "", jobRole: "", links: [] },
      verifiedChecks: [], answers: [], requestedAt: at, counts, reviewUrl: url("/admin/events/door-lab"), allRequestsUrl: url("/admin/events/door-lab"),
    },
    "M-26": { ...b, event, windowStart: at, requests: [{ name: "Guest", headline: "", company: "", kind: "request", requestedAt: at }], counts, allRequestsUrl: url("/admin/events/door-lab") },
    "M-27": { ...b, event, role: "host", inviter: { name: "host@example.com" }, adminUrl: url("/admin/events/door-lab") },
    "M-28": { ...b, recipient, firstName: null, exploreUrl: url("/events") },
    "M-29": { ...b, recipient, firstName: null, missing: ["link"], profileUrl: url("/me/profile/edit") },
    "E-01": { ...b, recipient, event, verifyUrl: url("/me/events/door-lab"), linkValidDays: 7 },
    "E-02": { ...b, recipient, event, checkedInAt: at, arrivalNote: "", tonight: [] },
    "E-03": { ...b, recipient, event },
    "T-01": { ...b, inviteeEmail: "new@didit.me", inviter: { email: "owner@didit.me" }, role: "staff", adminUrl: url("/admin") },
  };
  return data;
}

// ── checks ──────────────────────────────────────────────────────────────────────────────────────────────────────

const decode = (s: string) => s.replace(/&amp;/g, "&");
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/**
 * Every URL the client fetches to draw the email. `cid:` sources are inline attachments carried by the message
 * (applicant photos): nothing to fetch, so they are not listed here and never HTTP-checked.
 */
export function imageUrls(html: string): string[] {
  const urls = [
    ...[...html.matchAll(/<img\b[^>]*>/g)].map((m) => attr(m[0], "src") ?? ""),
    ...[...html.matchAll(/\sbackground="([^"]*)"/g)].map((m) => m[1]!),
    ...[...html.matchAll(/<v:fill\b[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]!),
    ...[...html.matchAll(/url\('([^']*)'\)/g)].map((m) => m[1]!),
  ];
  return [...new Set(urls.map(decode))].filter((u) => !isCid(u));
}

/** Visible text of the HTML body (preheader excluded). */
const visibleText = (html: string) =>
  html.replace(/<head>[\s\S]*?<\/head>/, "").replace(/<div style="display:none[\s\S]*?<\/div>/, "").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&zwnj;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const PLACEHOLDER = /\bundefined\b|\bnull\b|\[object |\bNaN\b|Invalid Date/;

export function auditRendered(r: RenderedEmail): string[] {
  const p: string[] = [];
  const { html, text, subject, preheader } = r;
  // Subject, preheader, text part.
  if (!subject.trim()) p.push("subject: empty");
  if (subject.length > 70) p.push(`subject: ${subject.length} chars > 70`);
  if (!preheader.trim()) p.push("preheader: empty");
  else if (!html.includes('<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">')) p.push("preheader: missing from html");
  if (text.trim().length < 40) p.push("text: plain-text part missing");
  // Placeholders anywhere a reader could see them.
  for (const [where, s] of [["subject", subject], ["preheader", preheader], ["html", visibleText(html)], ["text", text]] as const) {
    const m = PLACEHOLDER.exec(s);
    if (m) p.push(`${where}: placeholder "${m[0]}"`);
  }
  // An empty field joined into copy: "Where , ,", "Thu 8 Oct, .", "()".
  for (const [where, s] of [["subject", subject], ["preheader", preheader], ["html", visibleText(html)], ["text", text]] as const) {
    if (/(^|\s)[,.](\s|$)|,\s*[,.]|\(\s*\)|·\s*·|:\s*$/m.test(s)) p.push(`${where}: dangling separator (empty field joined)`);
  }
  // Images.
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0], src = decode(attr(tag, "src") ?? "");
    if (isCid(src)) { if (!attr(tag, "width") || !attr(tag, "height") || attr(tag, "alt") === undefined) p.push(`img: inline image without size or alt: ${src}`); continue; }
    if (!/^https:\/\//.test(src)) p.push(`img: not absolute https: ${src || "(no src)"}`);
    else if (!isPublicHttpsOrigin(src)) p.push(`img: not publicly reachable: ${src}`);
    if (!attr(tag, "width")) p.push(`img: no width: ${src}`);
    if (attr(tag, "alt") === undefined) p.push(`img: no alt: ${src}`);
    // A hero banner of unknown aspect keeps height:auto (a guessed height would distort it in Outlook).
    if (!attr(tag, "height") && !/height:auto/.test(attr(tag, "style") ?? "")) p.push(`img: no height: ${src}`);
  }
  for (const url of imageUrls(html)) {
    if (/localhost|127\.0\.0\.1/.test(url) || !/^https:\/\//.test(url)) p.push(`asset: unreachable from a mail server: ${url}`);
  }
  // Hero rounded like the public event page cover.
  for (const m of html.matchAll(/<td class="em-hero-inset"[^>]*><img\b[^>]*style="([^"]*)"/g)) {
    if (!m[1]!.includes(`border-radius:${EMAIL_RADII.cover}px`)) p.push("hero: radius differs from the event page cover");
  }
  // Bulletproof buttons: the cell carries bgcolor; the link fills it.
  for (const m of html.matchAll(/<td\b[^>]*border-radius:999px[^>]*>(<a\b[^>]*>)/g)) {
    const cell = m[0];
    if (!/\sbgcolor="#[0-9A-F]{6}"/i.test(cell)) p.push("button: cell without bgcolor");
    if (!/display:block/.test(m[1]!)) p.push("button: link does not fill the cell");
  }
  // Links.
  for (const m of html.matchAll(/\shref="([^"]*)"/g)) {
    const href = decode(m[1]!);
    if (!/^(https?:\/\/[^/]|mailto:)/.test(href)) p.push(`link: not absolute: ${href || "(empty)"}`);
  }
  // Empty sections: a titled box with nothing under it, an empty rows table, an empty paragraph.
  if (/letter-spacing:\.08em;color:#[0-9A-F]{6}">[^<]*<\/div><\/td><\/tr><\/table>/.test(html)) p.push("section: titled box with no items");
  if (/table-layout:fixed"><\/table>/.test(html)) p.push("section: empty rows table");
  if (/<p [^>]*><\/p>/.test(html)) p.push("section: empty paragraph");
  for (const title of ["AGENDA", "TONIGHT", "ANSWERS"]) {
    if (new RegExp(`(^|\\n)${title}(\\n|$)`).test(text) && !html.includes(`>${title}</div>`)) p.push(`text: ${title} section the html drops`);
  }
  return p;
}

/** The invite a code's send attaches, built like bindEmail does. */
function attachmentFor(code: EmailCode, event: EmailEvent | undefined): AuditRow["attachment"] {
  const method = (CALENDAR_METHOD_BY_CODE as Partial<Record<EmailCode, CalendarMethod>>)[code];
  if (!method || !event) return undefined;
  const ics = buildCalendarInvite({
    method, uid: calendarUid(ZERO_ID), sequence: method === "CANCEL" ? 1 : 0, now: FIXTURE_NOW, startsAt: event.startsAt, endsAt: event.endsAt,
    summary: event.name, venue: event.venueName || null, address: [event.street, event.city].filter(Boolean).join(", ") || null, geo: null,
    url: event.url, attendee: { email: "guest@example.com" },
  });
  const a = calendarAttachment(ics, method);
  return { filename: a.filename, content_type: a.content_type, method, ics: Buffer.from(a.content, "base64").toString("utf8") };
}

function auditAttachment(code: EmailCode, a: AuditRow["attachment"]): string[] {
  if (code === "M-06" && !a) return ["calendar: approval email without an invite"];
  if (!a) return [];
  const p: string[] = [];
  const name = a.method === "CANCEL" ? "cancel.ics" : "invite.ics";
  if (a.filename !== name) p.push(`calendar: attachment named ${a.filename}, expected ${name}`);
  if (a.content_type !== `text/calendar; charset=UTF-8; method=${a.method}`) p.push(`calendar: content type ${a.content_type}`);
  if (!a.ics.startsWith("BEGIN:VCALENDAR\r\n") || !a.ics.includes(`\r\nMETHOD:${a.method}\r\n`) || !a.ics.includes("\r\nUID:")) p.push("calendar: malformed iCalendar body");
  return p;
}

/** Renders every code with rich and minimal data and lists the problems of each. */
export function auditEmails(opts: AuditOptions = {}): AuditRow[] {
  const sets: [AuditFixture, EmailDataByCode][] = [["rich", richFixtures(opts)], ["minimal", minimalFixtures(opts)]];
  return sets.flatMap(([fixture, data]) => EMAIL_CODES.map((code): AuditRow => {
    const d = data[code] as unknown as { event?: EmailEvent };
    let rendered: RenderedEmail;
    try {
      rendered = renderEmail(code, data[code] as never);
    } catch (error) {
      const empty = { from: { name: "", address: "" }, subject: "", preheader: "", html: "", text: "" };
      return { code, fixture, subject: "", rendered: empty, images: [], problems: [`render: threw ${(error as Error).message}`] };
    }
    const attachment = attachmentFor(code, d.event);
    return { code, fixture, subject: rendered.subject, rendered, images: imageUrls(rendered.html), ...(attachment ? { attachment } : {}),
      problems: [...auditRendered(rendered), ...auditAttachment(code, attachment)] };
  }));
}
