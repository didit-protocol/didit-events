import { checkInInstruction, assetsOf, coverHero, defineTemplate, preferencesLink, type EmailBase, type EmailEvent } from "../common.ts";
import { fmtTime } from "../format.ts";

export interface AgendaItem {
  /** "18:30", or a short key such as "Wi-Fi". */
  t: string;
  l: string;
}

export interface M11Data extends EmailBase {
  event: EmailEvent;
  /** One sentence about the programme: "Two panels, one room." */
  teaser: string;
  agenda: AgendaItem[];
  directionsUrl: string;
}

export const M11 = defineTemplate<M11Data>({ code: "M-11", name: "Reminder · tomorrow", trigger: "T-24h, verified guests" }, (d) => {
  const doors = fmtTime(d.event.startsAt, d.event.timeZone);
  return {
    variant: "event",
    assetsUrl: assetsOf(d),
    subject: `Tomorrow: ${d.event.name}`,
    preheader: `Doors ${doors}. No ticket needed.`,
    hero: coverHero(d.event),
    eyebrow: `TOMORROW · ${doors}`,
    headline: "See you tomorrow",
    body: `${d.teaser} Doors open at ${doors}. ${checkInInstruction(d)}`,
    blocks: [
      { kind: "agenda", title: "AGENDA", items: d.agenda, sep: "·" },
      { kind: "buttons", primary: { label: "Get directions", href: d.directionsUrl } },
    ],
    footer: { legal: "You are going to a Didit event.", link: preferencesLink(d) },
  };
});
