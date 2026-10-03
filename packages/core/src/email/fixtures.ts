// Deterministic fixtures for every email: the design's copy and names, fixed clock 2026-10-08T17:30:00+02:00.
// Used by the /_frames previews and the render tests. Asset URLs are root-relative so the preview iframe loads them
// from the events app (public/email) and the U4 OG route.
import type { EmailBase, EmailEvent } from "./common.ts";
import type { EmailDataByCode } from "./index.ts";

export const FIXTURE_NOW = new Date("2026-10-08T17:30:00+02:00");

const TZ = "Europe/Madrid";
const BASE_URL = "https://events.didit.me";

export const fixtureBase: EmailBase = { baseUrl: BASE_URL, assetsUrl: "/email" };

/** Page 04 / 05: the real event. */
export const aiEraEvent: EmailEvent = {
  name: "Building, Raising & Scaling in the AI Era",
  shortName: "the AI Era evening",
  url: `${BASE_URL}/e/ai-era`,
  coverImageUrl: "/e/ai-era/opengraph-image",
  startsAt: new Date("2026-10-08T18:30:00+02:00"),
  endsAt: new Date("2026-10-08T21:30:00+02:00"),
  timeZone: TZ,
  venueName: "Didit HQ",
  street: "Carrer de Pallars 99",
  city: "Barcelona",
};

/** Page 02: the generic guest emails. */
export const officeOpeningEvent: EmailEvent = {
  name: "Barcelona Office Opening",
  shortName: "the Barcelona Office Opening",
  url: `${BASE_URL}/e/barcelona-office-opening`,
  coverImageUrl: "/e/barcelona-office-opening/opengraph-image",
  startsAt: new Date("2026-10-23T19:00:00+02:00"),
  endsAt: new Date("2026-10-23T23:00:00+02:00"),
  timeZone: TZ,
  venueName: "Didit HQ",
  street: "Carrer de Pallars 99",
  city: "Barcelona",
};

const maria = { firstName: "María", email: "maria.garcia@gmail.com" };
const mariaPlain = { firstName: "Maria", email: "maria.garcia@gmail.com" };
const b = fixtureBase;
const ev = aiEraEvent;

export const emailFixtures: EmailDataByCode = {
  "M-01": { ...b, code: "481903", expiresInMinutes: 10, eventName: ev.name },
  "M-02": { ...b, recipient: maria, event: ev, replyBy: new Date("2026-10-02T18:00:00+02:00") },
  "M-03": { ...b, recipient: maria, event: ev, verifyUrl: "https://verify.didit.me/session/3f1c9a2e", linkExpiresAt: new Date("2026-10-05T23:59:00+02:00") },
  "M-04": { ...b, code: "730215", email: maria.email, expiresInMinutes: 10 },
  "M-05": { ...b, recipient: maria, verifyUrl: "https://verify.didit.me/session/3f1c9a2e", deadline: new Date("2026-10-05T23:59:00+02:00"), timeZone: TZ },
  "M-06": { ...b, recipient: maria, event: ev, googleCalendarUrl: `${BASE_URL}/e/ai-era/calendar/google`, icsUrl: `${BASE_URL}/e/ai-era/event.ics`, statusUrl: `${BASE_URL}/me/events/ai-era` },
  "M-07": { ...b },
  "M-08": { ...b, retryUrl: "https://verify.didit.me/session/3f1c9a2e", attemptsLeft: 1 },
  "M-09": { ...b, event: ev, position: 12 },
  "M-10": { ...b, recipient: maria, event: ev, subscribeUrl: `${BASE_URL}/?subscribe=1` },
  "M-11": {
    ...b,
    event: ev,
    teaser: "Two panels, one room.",
    agenda: [
      { t: "18:30", l: "Doors open · face check-in" },
      { t: "19:10–19:50", l: "How to build AI-native companies" },
      { t: "19:55", l: "Raising in SF vs EU" },
      { t: "20:40", l: "Drinks" },
    ],
    directionsUrl: "https://maps.google.com/?q=Carrer+de+Pallars+99,+Barcelona",
  },
  "M-12": { ...b, event: ev, directions: "Metro L4 Llacuna, 4 minutes walk.", mapsUrl: "https://maps.google.com/?q=Carrer+de+Pallars+99,+Barcelona" },
  "M-13": {
    ...b,
    recipient: maria,
    event: ev,
    checkedInAt: new Date("2026-10-08T18:42:00+02:00"),
    arrivalNote: "Grab a drink, panels start at 19:10 on the ground floor.",
    tonight: [
      { t: "Wi-Fi", l: "Didit-Guest · EXAMPLE-WIFI-PASSWORD" },
      { t: "19:10", l: "Panel 01 · How to build AI-native companies" },
      { t: "19:55", l: "Panel 02 · Raising in SF vs EU" },
    ],
  },
  "M-14": {
    ...b,
    event: ev,
    attendeeCount: 104,
    recap: { preheader: "Both panels, plus photos.", line: "Both panels are recorded, and the photos are up." },
    recordingsUrl: `${BASE_URL}/e/ai-era/recordings`,
    photosUrl: `${BASE_URL}/e/ai-era/photos`,
  },
  "M-15": { ...b, event: ev, requestAgainUrl: ev.url },
  "M-16": {
    ...b,
    event: { ...ev, startsAt: new Date("2026-10-08T18:45:00+02:00") },
    change: { kind: "time", before: new Date("2026-10-08T18:30:00+02:00") },
    calendarUrl: `${BASE_URL}/e/ai-era/event.ics`,
  },
  "M-17": {
    ...b,
    email: maria.email,
    code: "481903",
    expiresInMinutes: 5,
    requestedAt: new Date("2026-09-29T18:14:00+02:00"),
    timeZone: TZ,
    device: "Safari on iPhone · Barcelona, ES",
  },
  "M-18": { ...b, recipient: maria, myEventsUrl: `${BASE_URL}/me` },
  "M-19": {
    ...b,
    event: ev,
    titleAccent: "AI Era",
    pitch: "an evening on building and raising in the AI era",
    inviter: { firstName: "Alejandro" },
    message: "Would love to have you on the SF vs EU panel crowd.",
    acceptUrl: `${BASE_URL}/e/ai-era/invite/7kQ2xZ`,
  },
  "M-20": {
    ...b,
    event: ev,
    kind: "cancelled",
    reason: "Schedule conflict",
    cancelledAt: new Date("2026-10-02T11:20:00+02:00"),
    requestAgainUrl: ev.url,
  },
  "M-21": { ...b, recipient: maria, event: ev, otherEventsUrl: BASE_URL },
  "M-22": { ...b, cancelledPlaces: 1, cancelledRequests: 2 },
  "M-23": {
    ...b,
    recipient: maria,
    event: ev,
    verifiedEmail: "maria.g@gmail.com",
    googleCalendarUrl: `${BASE_URL}/e/ai-era/calendar/google`,
    icsUrl: `${BASE_URL}/e/ai-era/event.ics`,
    statusUrl: `${BASE_URL}/me/events/ai-era`,
  },
  "M-24": {
    ...b,
    event: ev,
    guest: { name: "María García", email: maria.email },
    checkedInAt: new Date("2026-10-08T18:42:00+02:00"),
    checkedInBy: "Kiosk · Main door",
    undoneAt: FIXTURE_NOW,
    undoneBy: { name: "Alejandro Ruiz", role: "Admin" },
    reason: "Matched the wrong guest",
    checkInLogUrl: `${BASE_URL}/admin/events/ai-era/check-ins`,
  },
  "M-25": {
    ...b,
    event: ev,
    kind: "request",
    applicant: {
      name: "María García",
      email: maria.email,
      photoUrl: "cid:applicant-1",
      headline: "Building trust infrastructure for fintech",
      company: "Acme Pay",
      jobRole: "Founder & CEO",
      links: [{ kind: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/in/mariagarcia" }, { kind: "website", label: "Website", href: "https://acmepay.example" }],
      phone: "+34 600 600 600",
    },
    verifiedChecks: ["Phone"],
    answers: [{ question: "What are you building?", answer: "Fraud scoring for instant payouts in Spain and Portugal." }],
    requestedAt: new Date("2026-10-01T11:20:00+02:00"),
    counts: { pending: 4, waitlisted: 0, capacity: 80, capacityLeft: 32 },
    reviewUrl: `${BASE_URL}/admin/events/9b0c7f52-3c1e-4a8e-9a55-1f0f6c2d8e11/applicants?applicant=0d3f4b2a-6c1e-4f7a-8b9c-2e5d1a7f9c30`,
    allRequestsUrl: `${BASE_URL}/admin/events/9b0c7f52-3c1e-4a8e-9a55-1f0f6c2d8e11/applicants`,
  },
  "M-26": {
    ...b,
    event: ev,
    windowStart: new Date("2026-10-01T11:20:00+02:00"),
    requests: [
      { name: "María García", headline: "Building trust infrastructure for fintech", company: "Acme Pay", kind: "request", requestedAt: new Date("2026-10-01T11:21:00+02:00"), photoUrl: "cid:applicant-1" },
      { name: "Jordi Puig", headline: "Payments engineer", company: "Solaris", kind: "request", requestedAt: new Date("2026-10-01T11:24:00+02:00") },
      { name: "Ana Ruiz", headline: "Investor", company: "Seaside Ventures", kind: "waitlist", requestedAt: new Date("2026-10-01T11:27:00+02:00") },
    ],
    counts: { pending: 14, waitlisted: 1, capacity: 80, capacityLeft: 0 },
    allRequestsUrl: `${BASE_URL}/admin/events/9b0c7f52-3c1e-4a8e-9a55-1f0f6c2d8e11/applicants`,
  },
  "M-27": {
    ...b,
    event: ev,
    role: "operator",
    inviter: { name: "Alejandro Ruiz" },
    adminUrl: `${BASE_URL}/admin/events/ai-era`,
  },
  "M-28": { ...b, recipient: maria, firstName: "María", exploreUrl: `${BASE_URL}/events`, profileUrl: `${BASE_URL}/me/profile/edit` },
  "M-29": { ...b, recipient: maria, firstName: "María", missing: ["photo", "headline"], profileUrl: `${BASE_URL}/me/profile/edit` },
  "E-01": { ...b, recipient: mariaPlain, event: officeOpeningEvent, verifyUrl: "https://verify.didit.me/session/8b20d4c1", linkValidDays: 7 },
  "E-02": {
    ...b,
    recipient: mariaPlain,
    event: officeOpeningEvent,
    checkedInAt: new Date("2026-10-23T19:42:00+02:00"),
    arrivalNote: "Grab a drink, the team is on the ground floor.",
    tonight: [
      { t: "Wi-Fi", l: "Didit-Guest · EXAMPLE-WIFI-PASSWORD" },
      { t: "20:00", l: "Welcome from Alberto" },
      { t: "20:30", l: "Product demos on the 2nd floor" },
    ],
  },
  "E-03": { ...b, recipient: mariaPlain, event: officeOpeningEvent },
  "T-01": { ...b, inviteeEmail: "uma.bramwell@didit.me", inviter: { name: "Alberto Rosas", email: "events.owner@didit.me" }, role: "admin", adminUrl: `${BASE_URL}/admin` },
};
