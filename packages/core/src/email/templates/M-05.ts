import { assetsOf,defineTemplate,preferencesLink,type EmailBase,type Recipient } from "../common.ts";
import { fmtDay } from "../format.ts";

export interface M05Data extends EmailBase {
  recipient: Recipient;
  verifyUrl: string;
  /** When the personal link expires. */
  deadline: Date;
  timeZone: string;
}

export const M05 = defineTemplate<M05Data>({ code: "M-05", name: "Finish your verification (24h nudge)", trigger: "Previously accepted check needs renewal" }, (d) => ({
  variant: "event",
  assetsUrl: assetsOf(d),
  subject: `Renew your event checks, ${d.recipient.firstName}`,
  preheader: "Your place is confirmed. An expired check needs attention.",
  eyebrow: "ALMOST THERE",
  headline: "Finish your verification",
  body: `Open your event status and renew any expired checks before ${fmtDay(d.deadline, d.timeZone)}. Your place remains confirmed.`,
  blocks: [{ kind: "buttons", primary: { label: "Continue verification", href: d.verifyUrl } }],
  footer: { legal: "You were approved for a Didit event.", link: preferencesLink(d) },
}));
