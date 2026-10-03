/**
 * Deterministic fixtures for the public pages: the real AI Era event (Thu 8 Oct 2026, 18:30–21:30 CEST, Didit HQ
 * Barcelona) and the Didit Events calendar, with copy from design/04 AI Era Event and design/02 Guest and Emails.
 * The route `data.ts` files serve these until the F1 services land; the /_frames gallery always uses them.
 */
import type { Calendar, CardState, Person, PublicEvent, Viewer } from "./types";

/** The frame clock: event day, one hour before doors. */
export const FIXED_NOW = new Date("2026-10-08T17:30:00+02:00");

const DIDIT_HQ = {
  name: "Didit HQ",
  address: "Carrer de Pallars 99, 08018 Barcelona",
  shortAddress: "Carrer de Pallars 99, Barcelona",
  city: "Barcelona",
  transit: "Metro L4 Llacuna, 4 min walk",
  mapsUrl: "https://maps.google.com/?q=Carrer+de+Pallars+99,+08018+Barcelona",
  lat: 41.39857,
  lng: 2.19399,
};

const tba = (): Person => ({ name: "Panelist", role: "Announcing soon" });

/** The AI Era hosts (seeded): a host with an account email shows that account's profile photo on the public page. */
export const AI_ERA_HOSTS: { name: string; role: string; email?: string }[] = [
  { name: "Alberto Rosas", role: "Didit · CEO", email: "events.owner@didit.me" },
  { name: "Uma Bramwell", role: "Didit" },
];

export const AI_ERA: PublicEvent = {
  slug: "ai-era",
  template: "feature",
  title: "Building, Raising & Scaling in the",
  accent: "AI Era",
  startsAt: "2026-10-08T18:30:00+02:00",
  endsAt: "2026-10-08T21:30:00+02:00",
  timeZone: "Europe/Madrid",
  venue: DIDIT_HQ,
  lifecycle: "published",
  registration: "request",
  registrationClosesAt: "2026-10-06T23:59:00+02:00",
  capacity: 120,
  going: 84,
  attended: 104,
  audience: "founders and operators",
  featuredLabel: "FEATURED IN BARCELONA",
  summary: "An evening for founders and operators building with AI. Two panels, one room, no slides.",
  about: [
    "An evening for founders and operators building with AI. Two panels, one room, no slides: what it actually takes to build AI-native companies, and how raising differs between San Francisco and Europe.",
    "Hosted at the new Didit office in Poblenou. Doors at 18:30, drinks after. Every guest is verified before the event, so there is no ticket and no queue: the door recognises you.",
  ],
  agenda: [
    { at: "2026-10-08T18:30:00+02:00", label: "Doors open · face check-in" },
    { at: "2026-10-08T19:00:00+02:00", label: "Welcome from Alberto, Didit" },
    { at: "2026-10-08T19:10:00+02:00", label: "Panel 01 · How to build AI-native companies", emphasis: true },
    { at: "2026-10-08T19:55:00+02:00", label: "Panel 02 · Raising in SF vs EU", emphasis: true },
    { at: "2026-10-08T20:40:00+02:00", label: "Drinks and conversations" },
    { at: "2026-10-08T21:30:00+02:00", label: "Close" },
  ],
  panels: [
    {
      kicker: "PANEL 01",
      title: "How to build AI-native companies",
      description:
        "Teams where agents write code, answer tickets and run ops from day one. What the org chart, the margins and the hiring plan look like when AI is the default, not a feature.",
      startsAt: "2026-10-08T19:10:00+02:00",
      endsAt: "2026-10-08T19:50:00+02:00",
      people: [{ name: "Alberto", role: "Moderator · Didit" }, tba(), tba(), tba()],
    },
    {
      kicker: "PANEL 02",
      title: "Raising in SF vs EU",
      description:
        "Rounds, valuations and investor expectations on both sides of the Atlantic. When to fly to San Francisco, when to raise at home, and what changes when your product is AI.",
      startsAt: "2026-10-08T19:55:00+02:00",
      endsAt: "2026-10-08T20:35:00+02:00",
      people: [{ name: "Alejandro", role: "Moderator · Didit" }, tba(), tba(), tba()],
    },
  ],
  hosts: AI_ERA_HOSTS.map(({ name, role }) => ({ name, role })),
  guestList: "names",
  goingPreview: { initials: ["IN", "DH", "NK", "TA", "LM", "SO", "IC", "RM"], names: ["Ingrid Nilsen", "Diego Herrera"] },
  wifi: "Didit-Guest · EXAMPLE-WIFI-PASSWORD",
  cover: { theme: "sky", eyebrow: "AN EVENING FOR FOUNDERS", tag: "DIDIT EVENTS · BARCELONA" },
  related: ["sf-launch-night", "amsterdam-partner-evening", "lisbon-founders-dinner"],
};

const base = (o: Partial<PublicEvent> & Pick<PublicEvent, "slug" | "title" | "startsAt" | "endsAt" | "timeZone" | "venue">): PublicEvent => ({
  template: "simple",
  lifecycle: "published",
  registration: "request",
  capacity: 150,
  going: 0,
  summary: "",
  about: [],
  agenda: [],
  panels: [],
  hosts: [],
  goingPreview: { initials: [], names: [] },
  guestList: "hidden",
  cover: { theme: "sky" },
  related: [],
  ...o,
});

export const BCN_OPENING: PublicEvent = base({
  slug: "barcelona-office-opening",
  title: "Barcelona Office Opening",
  startsAt: "2026-10-23T19:00:00+02:00",
  endsAt: "2026-10-23T23:00:00+02:00",
  timeZone: "Europe/Madrid",
  venue: DIDIT_HQ,
  listingNote: "Invite only",
  summary: "Drinks, demos and the team, in our new Poblenou office. Face check-in at the door, no tickets.",
  cover: { theme: "aqua" },
});

const MADRID = base({
  slug: "madrid-fintech-breakfast",
  title: "Madrid Fintech Breakfast",
  startsAt: "2026-11-12T08:30:00+01:00",
  endsAt: "2026-11-12T10:30:00+01:00",
  timeZone: "Europe/Madrid",
  venue: { name: "Espacio Castellana", address: "Paseo de la Castellana, Madrid", shortAddress: "Paseo de la Castellana, Madrid", city: "Madrid", mapsUrl: "https://maps.google.com/?q=Espacio+Castellana+Madrid" },
  registration: "open",
  going: 31,
  cover: { theme: "sky" },
});

const LISBON_ROUNDTABLE = base({
  slug: "customer-roundtable-lisbon",
  title: "Customer Roundtable Lisbon",
  startsAt: "2026-12-04T18:00:00+00:00",
  endsAt: "2026-12-04T20:30:00+00:00",
  timeZone: "Europe/Lisbon",
  venue: { name: "LX Factory", address: "R. Rodrigues de Faria 103, Lisbon", shortAddress: "LX Factory, Lisbon", city: "Lisbon", mapsUrl: "https://maps.google.com/?q=LX+Factory+Lisbon" },
  registration: "open",
  going: 12,
  cover: { theme: "sky" },
});

const AMSTERDAM = base({
  slug: "amsterdam-partner-evening",
  title: "Amsterdam Partner Evening",
  startsAt: "2026-06-03T19:00:00+02:00",
  endsAt: "2026-06-03T22:00:00+02:00",
  timeZone: "Europe/Amsterdam",
  venue: { name: "Pllek", address: "T. S. Mosselweg 59, Amsterdam", shortAddress: "Pllek, Amsterdam", city: "Amsterdam", mapsUrl: "https://maps.google.com/?q=Pllek+Amsterdam" },
  lifecycle: "ended",
  attended: 71,
  cover: { theme: "sky" },
});

const SF = base({
  slug: "sf-launch-night",
  title: "San Francisco Launch Night",
  startsAt: "2026-04-14T18:30:00-07:00",
  endsAt: "2026-04-14T21:30:00-07:00",
  timeZone: "America/Los_Angeles",
  venue: { name: "Pier 27", address: "Pier 27, The Embarcadero, San Francisco", shortAddress: "Pier 27, San Francisco", city: "San Francisco", mapsUrl: "https://maps.google.com/?q=Pier+27+San+Francisco" },
  lifecycle: "ended",
  attended: 118,
  cover: { theme: "aqua" },
});

const LISBON_DINNER = base({
  slug: "lisbon-founders-dinner",
  title: "Lisbon Founders Dinner",
  startsAt: "2026-02-12T20:00:00+00:00",
  endsAt: "2026-02-12T23:00:00+00:00",
  timeZone: "Europe/Lisbon",
  venue: { name: "Lisbon", address: "Lisbon", shortAddress: "Lisbon", city: "Lisbon", mapsUrl: "https://maps.google.com/?q=Lisbon" },
  lifecycle: "ended",
  attended: 38,
  cover: { theme: "sky" },
});

export const CALENDAR: Calendar = {
  name: "Didit Events",
  tagline: "Identity, fraud and founders",
  description: "Evenings for founders, operators and fraud teams in Barcelona, San Francisco and beyond. Every door runs on Didit face check-in.",
  subscribers: 1240,
  events: [AI_ERA, BCN_OPENING, MADRID, LISBON_ROUNDTABLE, AMSTERDAM, SF, LISBON_DINNER],
};

export const MARIA: Viewer = { firstName: "María", lastName: "García", email: "maria.garcia@gmail.com" };

/** One fixture per P-02 state, in design order (P-02a…n). */
export const CARD_STATES: { code: string; name: string; state: CardState }[] = [
  { code: "P-02a", name: "Signed out", state: { kind: "signed_out" } },
  { code: "P-02b", name: "Pending approval", state: { kind: "pending", viewer: MARIA, requestedAt: "2026-09-29T10:00:00+02:00", replyBy: "2026-10-02T18:00:00+02:00" } },
  { code: "P-02c", name: "Approved · verify identity", state: { kind: "approved", linkExpiresAt: "2026-10-05T23:59:00+02:00" } },
  { code: "P-02d", name: "Verification started", state: { kind: "verifying", stepsDone: 2 } },
  { code: "P-02e", name: "In review", state: { kind: "in_review" } },
  { code: "P-02f", name: "You are in", state: { kind: "going", viewer: MARIA } },
  { code: "P-02g", name: "Declined · retry", state: { kind: "declined", attemptsLeft: 1 } },
  { code: "P-02h", name: "Waitlist", state: { kind: "waitlist", position: 12 } },
  { code: "P-02i", name: "Not approved", state: { kind: "not_approved" } },
  { code: "P-02j", name: "Event full", state: { kind: "full" } },
  { code: "P-02k", name: "Registration closed", state: { kind: "closed" } },
  { code: "P-02l", name: "Checked in (event day)", state: { kind: "checked_in", viewer: MARIA, checkedInAt: "2026-10-08T18:42:00+02:00", door: "Main door" } },
  { code: "P-02m", name: "Event ended", state: { kind: "ended" } },
  { code: "P-02n", name: "Registration cancelled", state: { kind: "cancelled" } },
];

export const findEvent = (slug: string) => CALENDAR.events.find((e) => e.slug === slug);
