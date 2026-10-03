/**
 * View models for the public guest surfaces (P-01…P-03, G-01…G-03). They are the typed seam between the pages and
 * the data layer: every route reads them through its own `data.ts`, which today returns fixtures and later maps the
 * F1 domain services (events, registrations, evidence, link tokens) into these shapes.
 */
import type { CoverTheme } from "@didit-events/ui";

export type RegistrationMode = "request" | "invite_only" | "open";
export type EventLifecycle = "published" | "live" | "ended" | "cancelled";

export interface Person {
  name: string;
  role: string;
  photoUrl?: string;
}

export interface Panel {
  /** "PANEL 01" */
  kicker: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  people: Person[];
}

export interface AgendaItem {
  /** ISO instant; rendered as HH:mm in the event's time zone. */
  at: string;
  /** Optional ISO end instant (after `at`): the row reads "19:10–20:00". */
  endAt?: string;
  label: string;
  /** Panels are set in 500. */
  emphasis?: boolean;
}

export interface Venue {
  name: string;
  address: string;
  /** "Carrer de Pallars 99, Barcelona" (mobile) */
  shortAddress: string;
  /** "Barcelona" — the calendar shows "<name>, <city>"; absent when the saved address names no city. */
  city?: string;
  transit?: string;
  mapsUrl: string;
  /** The place picked in the editor (0019 events.place_id / lat / lng): the map pins exactly this point. */
  placeId?: string;
  lat?: number;
  lng?: number;
  /** What the embedded map pins: the picked place's coordinates ("loc:41.40,2.17" always drops a pin), else the street address text. */
  mapQuery?: string;
}

export interface PublicEvent {
  id?: string;
  descriptionHtml?: string;
  slug: string;
  /** feature = the P-01 two-column page (agenda, panels, hosts); simple = the G-01 page with the request form. */
  template: "feature" | "simple";
  /** Title without the accent, e.g. "Building, Raising & Scaling in the". */
  title: string;
  /** Trailing words set in brand blue ("AI Era"). */
  accent?: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  venue: Venue;
  lifecycle: EventLifecycle;
  registration: RegistrationMode;
  registrationClosesAt?: string;
  capacity: number;
  going: number;
  /** Past events: people checked in. */
  attended?: number;
  /** "founders and operators" (P-02m: "104 founders and operators joined."). */
  audience?: string;
  featuredLabel?: string;
  /** Host-set calendar label shown instead of the going count ("Invite only"). */
  listingNote?: string;
  summary: string;
  about: string[];
  agenda: AgendaItem[];
  panels: Panel[];
  hosts: Person[];
  goingPreview: { initials: string[]; names: string[] };
  /** Who is going is private by default: the public page never lists guests (admins still see everyone). */
  guestList: "hidden" | "count" | "names";
  wifi?: string;
  cover: { src?: string | null; /** Banner-format cover (tickets, cards); falls back to `src`. */ wideSrc?: string | null; alt?: string; theme: CoverTheme; eyebrow?: string; tag?: string };
  /** Slugs of past events featured at the bottom of the page. */
  related: string[];
}

export interface CalendarLink {
  kind: "website" | "x" | "linkedin";
  label: string;
  href: string;
}

/** The P-03 header (edited in /admin/calendar; built-in Didit copy and assets when nothing is stored). */
export interface CalendarProfile {
  name: string;
  tagline: string;
  description: string;
  /** Stored profiles show their tagline above the name; the built-in header never did. */
  showTagline?: boolean;
  /** Banner image URL (default: the aqua cover photo). */
  coverUrl?: string;
  /** Square logo image URL; absent = the Didit mark. */
  logoUrl?: string;
  links?: CalendarLink[];
}

export interface Calendar extends CalendarProfile {
  subscribers: number;
  events: PublicEvent[];
}

export interface Viewer {
  staffRole?: "owner" | "admin" | "staff";
  firstName: string;
  lastName: string;
  email: string;
  /** From the guest's profile, when set: prefills the G-01 request form. */
  company?: string;
  role?: string;
  /** The stored profile photo (versioned /api/me/photo URL); absent = the one-letter avatar. */
  photoUrl?: string;
}

/**
 * What the registration card shows (P-02a–n). Derived from the event, the viewer's registration and their
 * verification evidence by the domain's `displayStatus` (F1/B1); the card only renders it.
 */
export type CardState =
  | { kind: "signed_out" }
  | { kind: "request"; viewer: Viewer }
  | { kind: "pending"; viewer: Viewer; requestedAt: string; replyBy: string }
  | { kind: "approved"; linkExpiresAt: string }
  | { kind: "verifying"; stepsDone: number }
  | { kind: "in_review" }
  | { kind: "going"; viewer: Viewer }
  | { kind: "declined"; attemptsLeft: number }
  | { kind: "waitlist"; position: number }
  /** v5 `again`: the request-again decision (absent: legacy previews). */
  | { kind: "not_approved"; again?: CardAgain }
  | { kind: "full" }
  | { kind: "closed" }
  | { kind: "checked_in"; viewer: Viewer; checkedInAt: string; door: string }
  | { kind: "ended"; attendance?: "attended" | "no_show" | "none" }
  | { kind: "cancelled"; by?: "guest" | "withdrew" | "host" | "event"; again?: CardAgain };

/** v5 re-join on the card: the action (null: no request again, the rule says why) and the event's rule in one line. */
export interface CardAgain {
  label: string | null;
  rule: string | null;
}

export type CardKind = CardState["kind"];

/** G-01 request form (simple events). */
export interface RequestInput {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  role: string;
}

export type RequestField = keyof RequestInput;

export type RequestFormState =
  | { status: "idle"; values?: Partial<RequestInput> }
  | { status: "invalid"; values: Partial<RequestInput>; errors: Partial<Record<RequestField, string>> }
  | { status: "submitted"; firstName: string }
  | { status: "already"; values: Partial<RequestInput>; email: string }
  | { status: "error"; values: Partial<RequestInput>; message: string };

/** G-01 states that replace the form. */
export type SimpleEventGate = "open" | "closed" | "full" | "ended";

/** G-02: the personal verification link /e/[slug]/v/[token]. */
export type InviteState = "valid" | "expired" | "revoked" | "verified" | "in_review";

export interface Invite {
  state: InviteState;
  event: PublicEvent;
  firstName: string;
}

/** G-03: the Didit callback page /e/[slug]/done, display only. */
export type OutcomeState = "approved" | "in_review" | "declined" | "not_finished";

export interface Outcome {
  state: OutcomeState;
  event: PublicEvent;
  attemptsLeft: number;
}
