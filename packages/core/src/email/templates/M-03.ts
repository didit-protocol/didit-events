import { assetsOf,coverHero,defineTemplate,preferencesLink,whenWhereRows,type EmailBase,type EmailEvent,type Recipient } from "../common.ts";
import { fmtDay } from "../format.ts";

export interface M03Data extends EmailBase {
  recipient: Recipient;
  event: EmailEvent;
  /** The personal Didit verification link (hosted flow). */
  verifyUrl: string;
  linkExpiresAt: Date;
}

export const M03 = defineTemplate<M03Data>({ code: "M-03", name: "Renew an expired check", trigger: "Accepted proof expired before arrival" }, (d) => ({
  variant: "event",
  assetsUrl: assetsOf(d),
  subject: `Renew your checks for ${d.event.shortName}`,
  preheader: "Your place stays confirmed while you renew.",
  hero: coverHero(d.event),
  eyebrow: "RENEWAL NEEDED",
  headline: `Renew your checks, ${d.recipient.firstName}`,
  body: "A previously completed check has expired. Open your event status to renew only what is needed before arrival.",
  blocks: [
    { kind: "rows", rows: whenWhereRows(d.event), labelWidth: 80, size: "md" },
    { kind: "buttons", primary: { label: "View event status", href: d.verifyUrl } },
    {
      kind: "note",
      text: `Renew before ${fmtDay(d.linkExpiresAt, d.event.timeZone)}. Sign in to view your account securely.`,
    },
  ],
  footer: { legal: "You were approved for a Didit event.", link: preferencesLink(d) },
}));
