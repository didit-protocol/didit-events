import { place, checkInInstruction, assetsOf, defineTemplate, guestActions, preferencesLink, whenWhereRows, type EmailBase, type EmailEvent, type Recipient } from "../common.ts";
import { fmtDay } from "../format.ts";

export interface M23Data extends EmailBase {
  recipient: Recipient;
  event: EmailEvent;
  /** The email Didit verified, which staff accepted (A-16). */
  verifiedEmail: string;
  googleCalendarUrl: string;
  icsUrl: string;
  /** The guest's event status page (bound at send time); the cancel link defaults to its `/cancel`. */
  statusUrl?: string;
  cancelUrl?: string;
}

/** design-prompt v2: "Your place was confirmed after review" (A-16 accept path). No design frame yet: M-06 layout. */
export const M23 = defineTemplate<M23Data>({ code: "M-23", name: "Place confirmed after review", trigger: "A-16 accept this email" }, (d) => ({
  variant: "event",
  assetsUrl: assetsOf(d),
  subject: `Your place is confirmed: ${place(fmtDay(d.event.startsAt, d.event.timeZone), d.event.venueName)}`,
  preheader: "The team reviewed your verification.",
  eyebrow: "CONFIRMED AFTER REVIEW",
  headline: `You are in, ${d.recipient.firstName}`,
  body: `The team reviewed your verification and accepted ${d.verifiedEmail}. ${checkInInstruction(d)}`,
  blocks: [
    { kind: "rows", rows: [...whenWhereRows(d.event), { k: "Entry", v: d.door?.kiosk ? "Face check-in" : "Host check-in", tone: "success" }], labelWidth: 80, size: "md" },
    ...guestActions({
      primary: { label: "View your ticket", href: d.statusUrl ?? d.event.url, icon: "ticket" },
      googleCalendarUrl: d.googleCalendarUrl,
      icsUrl: d.icsUrl,
      cancelUrl: d.cancelUrl ?? `${d.statusUrl ?? d.event.url}/cancel`,
    }),
  ],
  footer: { legal: "You are going to a Didit event. Cancelling gives your place to someone else.", link: preferencesLink(d) },
}));
