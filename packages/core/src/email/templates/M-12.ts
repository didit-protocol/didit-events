import { place, checkInInstruction, assetsOf, defineTemplate, preferencesLink, type EmailBase, type EmailEvent } from "../common.ts";
import { fmtTime } from "../format.ts";

export interface M12Data extends EmailBase {
  event: EmailEvent;
  /** How to get there: "Metro L4 Llacuna, 4 minutes walk." */
  directions: string;
  mapsUrl: string;
}

export const M12 = defineTemplate<M12Data>({ code: "M-12", name: "Reminder · doors in 1 hour", trigger: "T-1h, verified guests" }, (d) => ({
  variant: "event",
  assetsUrl: assetsOf(d),
  subject: "Doors open in 1 hour",
  preheader: d.event.street ? `${d.event.street}. ${checkInInstruction(d)}` : checkInInstruction(d),
  eyebrow: `TODAY · ${fmtTime(d.event.startsAt, d.event.timeZone)}`,
  headline: "Doors in 1 hour",
  body: `${place(d.event.venueName, d.event.street) ? `Head to ${place(d.event.venueName, d.event.street)}. ` : ""}${d.directions} ${checkInInstruction(d)}`,
  blocks: [{ kind: "buttons", primary: { label: "Open in Maps", href: d.mapsUrl } }],
  footer: { legal: "You are going to a Didit event.", link: preferencesLink(d) },
}));
