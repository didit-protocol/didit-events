import { assetsOf, coverHero, defineTemplate, preferencesLink, siteHost, whenWhereRows, type EmailBase, type EmailEvent, type Recipient } from "../common.ts";
import { fmtDay } from "../format.ts";

export interface M02Data extends EmailBase {
  recipient: Recipient;
  event: EmailEvent;
  /** When the hosts promise an answer. */
  replyBy: Date;
}

export const M02 = defineTemplate<M02Data>({ code: "M-02", name: "Request received", trigger: "R-08 request submitted" }, (d) => {
  const by = fmtDay(d.replyBy, d.event.timeZone);
  return {
    variant: "event",
    assetsUrl: assetsOf(d),
    subject: `We got your request for ${d.event.name}`,
    preheader: `You will hear back by ${by}.`,
    hero: coverHero(d.event),
    eyebrow: "REQUEST RECEIVED",
    headline: `Thanks, ${d.recipient.firstName}`,
    body: `The hosts review every request and will reply by ${by}. We will email you when your place is confirmed.`,
    blocks: [
      { kind: "rows", rows: whenWhereRows(d.event), labelWidth: 80, size: "md" },
      { kind: "buttons", primary: { label: "View event", href: d.event.url } },
    ],
    footer: { legal: `You requested a place on ${siteHost(d)}.`, link: preferencesLink(d) },
  };
});
