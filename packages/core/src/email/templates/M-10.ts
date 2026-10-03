import { assetsOf, defineTemplate, preferencesLink, siteHost, type EmailBase, type EmailEvent, type Recipient } from "../common.ts";

export interface M10Data extends EmailBase {
  recipient: Recipient;
  event: EmailEvent;
  subscribeUrl: string;
}

export const M10 = defineTemplate<M10Data>({ code: "M-10", name: "Not approved", trigger: "host rejects" }, (d) => ({
  variant: "event",
  assetsUrl: assetsOf(d),
  subject: `About your request for ${d.event.shortName}`,
  preheader: "We could not offer you a place this time.",
  eyebrow: "REQUEST UPDATE",
  headline: "Not approved this time",
  body: `Thanks for your interest, ${d.recipient.firstName}. We could not offer you a place this time. You will be first to hear about the next Didit event.`,
  blocks: [{ kind: "buttons", primary: { label: "Subscribe to Didit Events", href: d.subscribeUrl } }],
  footer: { legal: `You requested a place on ${siteHost(d)}.`, link: preferencesLink(d) },
}));
