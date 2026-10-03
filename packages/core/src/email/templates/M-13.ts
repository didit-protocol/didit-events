import { assetsOf, defineTemplate, preferencesLink, type EmailBase, type EmailEvent, type Recipient } from "../common.ts";
import { fmtTime } from "../format.ts";
import type { AgendaItem } from "./M-11.ts";

export interface M13Data extends EmailBase {
  recipient: Recipient;
  event: EmailEvent;
  checkedInAt: Date;
  /** "Grab a drink, panels start at 19:10 on the ground floor." */
  arrivalNote: string;
  tonight: AgendaItem[];
}

export const M13 = defineTemplate<M13Data>({ code: "M-13", name: "Welcome · checked in", trigger: "entry recorded" }, (d) => {
  const at = fmtTime(d.checkedInAt, d.event.timeZone);
  return {
    variant: "event",
    assetsUrl: assetsOf(d),
    subject: `Welcome to ${d.event.shortName}, ${d.recipient.firstName}`,
    preheader: `You checked in at ${at}.`,
    eyebrow: `CHECKED IN · ${at}`,
    headline: `Welcome in, ${d.recipient.firstName}`,
    body: `You checked in at ${at}. ${d.arrivalNote}`,
    blocks: [
      { kind: "agenda", title: "TONIGHT", items: d.tonight, sep: "·" },
      { kind: "note", text: "Enjoy the evening,\nThe Didit team" },
    ],
    footer: { legal: "You checked in at a Didit event.", link: preferencesLink(d) },
  };
});
