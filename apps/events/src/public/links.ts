import { CONTACT_EMAIL } from "../config";
/**
 * Every URL the public pages link to, in one place. Routes owned by other lanes (U5 sign-in / register / guest
 * area) are named here so wiring them is a one-line change.
 */
export const links = {
  calendar: () => "/events",
  past: () => "/events?when=past",
  event: (slug: string) => `/e/${slug}`,
  /** Flow v3: "Request to join" opens the join modal over the event page (the old /register route redirects here). */
  register: (slug: string) => `/e/${slug}?join=1`,
  /** Flow v3: the join modal over the event page (sign in, missing details, face, request). */
  join: (slug: string) => `/e/${slug}?join=1`,
  /** Full event → the same modal (the request context offers the waitlist). */
  waitlist: (slug: string) => `/e/${slug}?join=1`,
  /** U5 (U-28): withdraw a pending request. */
  withdraw: (slug: string) => `/me/events/${slug}/withdraw`,
  /** U5 (U-24…U-31): cancel attendance or leave the waitlist. */
  cancel: (slug: string) => `/me/events/${slug}/cancel`,
  /** U5: sign in (DA-01 / U-01). */
  signIn: (next?: string) => (next ? `/login?next=${encodeURIComponent(next)}` : "/login"),
  myEvents: () => "/me",
  /** U5: the guest's own page for an event (status, face ticket). */
  myEvent: (slug: string) => `/me/events/${slug}`,
  ics: (slug: string) => `/e/${slug}/event.ics`,
  photos: (slug: string) => `/e/${slug}/photos`,
  contact: () => `mailto:${CONTACT_EMAIL}`,
  report: (slug: string) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Report event ${slug}`)}`,
  privacy: () => "https://didit.me/privacy",
  terms: () => "https://didit.me/terms",
} as const;
