import { assetsOf, defineTemplate, preferencesLink, siteHost, type EmailBase, type EmailEvent } from "../common.ts";

export interface M09Data extends EmailBase {
  event: EmailEvent;
  /** 1-based waitlist position. */
  position: number;
  requiresReview?: boolean;
}

export const M09 = defineTemplate<M09Data>({ code: "M-09", name: "Waitlisted", trigger: "host moves to waitlist / event full" }, (d) => ({
  variant: "event",
  assetsUrl: assetsOf(d),
  subject: `You are on the waitlist for ${d.event.shortName}`,
  preheader: "We will email you if a place opens.",
  eyebrow: `WAITLIST · #${d.position}`,
  headline: "You are on the list",
  body: d.requiresReview ? "You are on the waitlist. The hosts will review your request when a place opens and email you with their decision." : "The event is full right now. If a place opens and your checks are current, we will confirm your place by email.",
  blocks: [{ kind: "buttons", primary: { label: "View event", href: d.event.url } }],
  footer: { legal: `You requested a place on ${siteHost(d)}.`, link: preferencesLink(d) },
}));
