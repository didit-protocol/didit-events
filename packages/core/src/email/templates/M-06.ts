import { place,assetsOf,coverHero,defineTemplate,guestActions,preferencesLink,whenWhereRows,type EmailBase,type EmailEvent,type Recipient } from "../common.ts";
import { fmtDay } from "../format.ts";

export interface M06Data extends EmailBase {
  recipient: Recipient;
  event: EmailEvent;
  googleCalendarUrl: string;
  icsUrl: string;
  renewalNeeded?:boolean;door?:{kiosk:boolean};
  renewalChecks?:string[];statusUrl?:string;cancelUrl?:string;
}

export const M06 = defineTemplate<M06Data>({ code: "M-06", name: "You’re in", trigger: "Request approved" }, (d) => ({
  variant: "event",
  assetsUrl: assetsOf(d),
  subject: `You're in: ${place(fmtDay(d.event.startsAt, d.event.timeZone), d.event.venueName)}`,
  preheader: d.renewalNeeded ? "Your place is confirmed. Renew your expired checks before arrival." : "Your place is confirmed.",
  hero: coverHero(d.event),
  eyebrow: "YOU ARE GOING",
  headline: `You're in, ${d.recipient.firstName}`,
  body: d.renewalNeeded ? "Your place is confirmed. Open your event status to renew the expired checks before arrival." : d.door?.kiosk ? "Your place is confirmed. Look at the screen at the door to check in." : "Your place is confirmed. Check in with the host when you arrive.",
  blocks: [
    { kind: "rows", rows: [...whenWhereRows(d.event), { k: "Entry", v: d.door?.kiosk ? "Face check-in" : "Host check-in", tone: "success" }], labelWidth: 80, size: "md" },
    ...(d.renewalNeeded ? [{kind:"note" as const,text:`Renew before arrival: ${(d.renewalChecks??["required checks"]).join(", ")}.`}] : []),
    ...guestActions({
      primary: d.renewalNeeded ? { label: "Renew required checks", href: d.statusUrl ?? d.event.url } : { label: "View your ticket", href: d.statusUrl ?? d.event.url, icon: "ticket" },
      googleCalendarUrl: d.googleCalendarUrl,
      icsUrl: d.icsUrl,
      cancelUrl: d.cancelUrl ?? `${d.statusUrl ?? d.event.url}/cancel`,
    }),
  ],
  footer: { legal: "You are going to a Didit event. Cancelling gives your place to someone else.", link: preferencesLink(d) },
}));
