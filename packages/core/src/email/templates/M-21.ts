import { assetsOf, defineTemplate, privacyLink, type EmailBase, type EmailEvent, type Recipient } from "../common.ts";
import { fmtDay } from "../format.ts";

export interface M21Data extends EmailBase {
  recipient: Recipient;
  event: EmailEvent;
  otherEventsUrl: string;
}

export const M21 = defineTemplate<M21Data>({ code: "M-21", name: "Cancelled by the host", trigger: "staff revokes / event cancelled" }, (d) => ({
  variant: "account",
  assetsUrl: assetsOf(d),
  subject: `Update on your place for ${d.event.shortName}`,
  preheader: "We had to cancel your place.",
  eyebrow: "UPDATE",
  headline: "We had to release your place",
  body: `Sorry, ${d.recipient.firstName}. We could not keep your place for ${fmtDay(d.event.startsAt, d.event.timeZone)}. If you think this is a mistake, reply to this email and the team will check.`,
  blocks: [{ kind: "buttons", primary: { label: "See other Didit events", href: d.otherEventsUrl } }],
  footer: { legal: "You had a place at a Didit event.", link: privacyLink(d) },
}));
