import { contactEmail } from "../contact-email.ts";
// Shared data shapes and helpers for the email templates. Templates receive plain typed data (the outbox payload
// plus the event row, bound by the B5 dispatcher) and return subject / html / text.
import { fmtWhen, hostOf } from "./format.ts";
import { renderHtml, renderText, type EmailBlock, type EmailDoc, type EmailLink, type EmailRow } from "./layout.ts";

export type EmailCode =
  | "M-01" | "M-02" | "M-03" | "M-04" | "M-05" | "M-06" | "M-07" | "M-08" | "M-09" | "M-10" | "M-11" | "M-12"
  | "M-13" | "M-14" | "M-15" | "M-16" | "M-17" | "M-18" | "M-19" | "M-20" | "M-21" | "M-22" | "M-23" | "M-24"
  | "M-25" | "M-26" | "M-27" | "M-28" | "M-29"
  | "E-01" | "E-02" | "E-03"
  | "T-01";

export interface Sender {
  name: string;
  address: string;
}

export const EVENTS_SENDER: Sender = { name: "Didit Events", get address() { return contactEmail(); } };
/** Mail Didit itself sends (the hosted-flow and sign-in OTP codes). */
export const DIDIT_SENDER: Sender = { name: "Didit", address: "no-reply@didit.me" };

/** Every template's data carries where the app lives. */
export interface EmailBase {
  /** Public origin of Didit Events, e.g. "https://events.didit.me". Links and the legal line use it. */
  baseUrl: string;
  door?: {kiosk:boolean};
  /** Email assets (logo, font, photos). Defaults to `${baseUrl}/email`; previews pass "/email". */
  assetsUrl?: string;
  /** Where the web font is read from when it is not `assetsUrl` (core/email/media.ts `emailFontAssetsUrl`). */
  fontAssetsUrl?: string;
}

/** The event fields emails show. Dates are real instants; they are formatted in `timeZone`. */
export interface EmailEvent {
  name: string;
  /** How copy refers to it mid-sentence: "the AI Era evening". */
  shortName: string;
  /** Public event page. */
  url: string;
  /** The banner, else the cover, else the V-01 OG cover (1200×630 PNG), else the theme art: the hero. */
  coverImageUrl: string;
  /** Source size of the hero when known (OG cover, theme art: 1200×630); uploaded banners vary. */
  coverSize?: { width: number; height: number };
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  venueName: string;
  street: string;
  city: string;
}

export interface Recipient {
  firstName: string;
  email: string;
}

export interface EmailTemplate<D extends EmailBase> {
  code: EmailCode;
  /** The design frame name ("Request received"); with the code it is the frame's data-screen-label. */
  name: string;
  /** What sends it (design annotation). */
  trigger: string;
  from: Sender;
  doc: (data: D) => EmailDoc;
  subject: (data: D) => string;
  html: (data: D) => string;
  text: (data: D) => string;
}

export function defineTemplate<D extends EmailBase>(
  meta: { code: EmailCode; name: string; trigger: string; from?: Sender },
  doc: (data: D) => EmailDoc,
): EmailTemplate<D> {
  // The font folder rides on the data, not on each template: every document carries it when the binder set one.
  const build = doc;
  doc = (d) => ({ ...build(d), ...(d.fontAssetsUrl ? { fontAssetsUrl: d.fontAssetsUrl } : {}) });
  return {
    ...meta,
    from: meta.from ?? EVENTS_SENDER,
    doc,
    subject: (d) => doc(d).subject,
    html: (d) => renderHtml(doc(d)),
    text: (d) => renderText(doc(d)),
  };
}

// ── helpers used by several templates ───────────────────────────────────────────────────────────────────────────

const trim = (u: string) => u.replace(/\/$/, "");

export const assetsOf = (d: EmailBase) => trim(d.assetsUrl ?? `${trim(d.baseUrl)}/email`);
export const siteHost = (d: EmailBase) => hostOf(d.baseUrl);
export const preferencesLink = (d: EmailBase): EmailLink => ({ label: "Email preferences", href: `${trim(d.baseUrl)}/me/settings` });
export const privacyLink = (d: EmailBase): EmailLink => ({ label: "Privacy", href: `${trim(d.baseUrl)}/privacy` });
export const unsubscribeLink = (d: EmailBase): EmailLink => ({ label: "Unsubscribe", href: `${trim(d.baseUrl)}/me/settings` });

/** Joins the non-empty parts: an event without a venue or address never shows ", , ". */
export const place = (...parts: (string | null | undefined)[]) => parts.map((p) => p?.trim()).filter(Boolean).join(", ");

/** "Didit HQ, Carrer de Pallars 99, Barcelona" */
export const whereLong = (e: EmailEvent) => place(e.venueName, e.street, e.city);
/** "Didit HQ, Barcelona" */
export const whereShort = (e: EmailEvent) => place(e.venueName, e.city);

/** When / Where rows (design/04 and /05). */
export const whenWhereRows = (e: EmailEvent, opts: { zone?: boolean } = {}): EmailRow[] => [
  { k: "When", v: fmtWhen(e.startsAt, e.endsAt, e.timeZone, opts) },
  { k: "Where", v: whereLong(e) },
];

export const coverHero = (e: EmailEvent) => ({ kind: "cover" as const, src: e.coverImageUrl, alt: e.name, ...(e.coverSize ? { size: e.coverSize } : {}) });

/** The three verification steps (design/04 wording; design/02 drops "from Didit"). */
export const verifySteps = (fromDidit: boolean) => [
  "Confirm your name",
  fromDidit ? "Verify your email with a code from Didit" : "Verify your email with a code",
  "Take a quick selfie",
];

export const checkInInstruction = (d: EmailBase) => d.door?.kiosk ? "Look at the screen at the door to check in." : "Check in with the host when you arrive.";

/** The guest action set (approval, confirmed after review): one primary, an "Add to calendar" pair, a quiet cancel link. */
export const guestActions = (a: { primary: EmailLink; googleCalendarUrl: string; icsUrl: string; cancelUrl: string }): EmailBlock[] => [
  { kind: "buttons", primary: a.primary },
  {
    kind: "buttonPair",
    title: "ADD TO CALENDAR",
    links: [
      { label: "Google Calendar", href: a.googleCalendarUrl, icon: "google-calendar" },
      { label: "Apple / Outlook (.ics)", href: a.icsUrl, icon: "apple" },
    ],
  },
  { kind: "textLink", lead: "Can’t make it?", link: { label: "Cancel your place", href: a.cancelUrl } },
];
