/**
 * Deterministic fixtures for the guest account surfaces: María García (maria.garcia@gmail.com, Globex) and the AI Era
 * evening, with the copy and dates of design/04 and design/05. Route `data.ts` files serve these until F1/B1/B2 land;
 * the /_frames gallery always uses them. Frame clock: 2026-10-08T17:30:00+02:00 (FIXED_NOW).
 */
import { AI_ERA, BCN_OPENING, CALENDAR, FIXED_NOW } from "../public/fixtures";
import type { PublicEvent } from "../public/types";
import type { GuestAccount, GuestEventStatus, MyEvent, RegisterInput } from "./types";

export { AI_ERA, BCN_OPENING, FIXED_NOW };

export const MARIA_EMAIL = "maria.garcia@gmail.com";

/** A verified returning guest whose name an ID document proved (U-20, U-21, U-32, U-38, U-39). */
export const MARIA: GuestAccount = {
  id: "acct_maria",
  firstName: "María",
  lastName: "García",
  email: MARIA_EMAIL,
  company: "Globex",
  role: "Head of Risk",
  headline: "Head of Risk · Globex · Barcelona",
  bio: "Building fraud tooling for mobility. Previously payments risk at Litware. Into AI agents for ops.",
  links: [
    { label: "LinkedIn", href: "https://linkedin.com/in/mariagarcia" },
    { label: "mariagarcia.com", href: "https://mariagarcia.com" },
  ],
  google: { email: MARIA_EMAIL },
  verification: { state: "verified", verifiedAt: "2026-10-01T12:00:00+02:00", selfieValidUntil: "2027-10-01T12:00:00+02:00", nameFromId: true },
  marketingOptIn: true,
  eventsAttended: 3,
};

/** The same person with the face check only: a verified human, the name not proven by an ID. */
export const MARIA_FACE_ONLY: GuestAccount = { ...MARIA, verification: { state: "verified", verifiedAt: "2026-10-01T12:00:00+02:00", selfieValidUntil: "2027-10-01T12:00:00+02:00" } };

/** The same person before any Didit verification (U-33). */
export const MARIA_NEW: GuestAccount = { ...MARIA, bio: undefined, links: [], eventsAttended: 0, verification: { state: "none" } };

/** Selfie older than 12 months (U-42). */
export const MARIA_SELFIE_EXPIRED: GuestAccount = {
  ...MARIA,
  verification: { state: "selfie_expired", verifiedAt: "2025-10-01T12:00:00+02:00", selfieExpiredAt: "2026-10-01T12:00:00+02:00", nameFromId: true },
};

export const REGISTER_FILLED: RegisterInput = { fullName: "María García", email: MARIA_EMAIL, company: "Globex", role: "Head of Risk", consent: true };

const event = (slug: string): PublicEvent => {
  const e = CALENDAR.events.find((x) => x.slug === slug);
  if (!e) throw new Error(`fixture event ${slug} missing`);
  return e;
};

/** U-20, in design order. */
export const MY_EVENTS: MyEvent[] = [
  { event: AI_ERA, badge: "going", detail: "Thu 8 Oct · Didit HQ" },
  { event: BCN_OPENING, badge: "pending", detail: "Fri 23 Oct · Didit HQ" },
  { event: event("madrid-fintech-breakfast"), badge: "waitlist", detail: "Thu 12 Nov · Madrid" },
  { event: event("amsterdam-partner-evening"), badge: "attended", detail: "3 Jun · attended" },
  { event: event("lisbon-founders-dinner"), badge: "cancelled", detail: "12 Feb · cancelled by you" },
];

/** One status per design frame (the /me/events/[slug] page renders these). */
export const STATUS: Record<string, GuestEventStatus> = {
  pendingNew: { kind: "pending", requestedAt: "2026-09-29T13:02:00+02:00", replyBy: "2026-10-02T18:00:00+02:00", justRequested: true, via: "google" },
  pendingReturning: { kind: "pending", requestedAt: "2026-09-29T13:02:00+02:00", replyBy: "2026-10-02T18:00:00+02:00", justRequested: false, via: "google" },
  approved: { kind: "approved", linkExpiresAt: "2026-10-05T23:59:00+02:00" },
  going: { kind: "going", verifiedAt: "2026-10-01T12:00:00+02:00", reused: false },
  goingReused: { kind: "going", verifiedAt: "2026-10-01T12:00:00+02:00", reused: true },
  inReview: { kind: "in_review" },
  declinedRetry: { kind: "declined", attemptsLeft: 1 },
  declinedFinal: { kind: "declined", attemptsLeft: 0 },
  waitlisted: { kind: "waitlisted", position: 12 },
  notApproved: { kind: "not_approved" },
  linkExpired: { kind: "link_expired" },
  cancelled: { kind: "cancelled", justCancelled: false },
  cancelledNow: { kind: "cancelled", reason: "Schedule conflict", justCancelled: true },
  full: { kind: "full", capacity: 120 },
  closed: { kind: "closed", closedAt: "2026-10-06T23:59:00+02:00" },
  checkedIn: { kind: "checked_in", at: "2026-10-08T18:42:00+02:00", door: "Main door", wifi: "Didit-Guest · EXAMPLE-WIFI-PASSWORD", next: "19:10 Panel 01 on the ground floor" },
  ended: { kind: "ended", attended: 104, audience: "founders and operators" },
  emailMismatch: { kind: "email_mismatch", verifiedEmail: "maria.g@gmail.com", invitedEmail: "maria@company.com" },
  linkOtherAccount: { kind: "link_other_account" },
  selfieExpired: { kind: "selfie_expired", expiredAt: "2026-10-01T12:00:00+02:00" },
};
