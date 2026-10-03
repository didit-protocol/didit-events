import { assetsOf, defineTemplate, preferencesLink, siteHost, type EmailBase, type EmailEvent } from "../common.ts";

export interface M15Data extends EmailBase {
  event: EmailEvent;
  requestAgainUrl: string;
}

export const M15 = defineTemplate<M15Data>({ code: "M-15", name: "Registration cancelled", trigger: "R-26 guest cancels" }, (d) => ({
  variant: "event",
  assetsUrl: assetsOf(d),
  subject: `You cancelled your place for ${d.event.shortName}`,
  preheader: "Your place went to the waitlist.",
  eyebrow: "CANCELLED",
  headline: "Place cancelled",
  body: "Your place went to the next person on the waitlist. Changed your mind? Request again while places last.",
  blocks: [{ kind: "buttons", primary: { label: "Request again", href: d.requestAgainUrl } }],
  footer: { legal: `You cancelled on ${siteHost(d)}.`, link: preferencesLink(d) },
}));
