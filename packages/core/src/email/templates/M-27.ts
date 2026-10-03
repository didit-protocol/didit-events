import { assetsOf, coverHero, defineTemplate, whenWhereRows, type EmailBase, type EmailEvent } from "../common.ts";
import { fmtDay } from "../format.ts";

export interface M27Data extends EmailBase {
  event: EmailEvent;
  role: "host" | "operator";
  /** Who added them: "Alejandro Ruiz" or their email. */
  inviter: { name: string };
  /** The event's admin page. Sign-in uses the account of this email (Google or a Didit email code). */
  adminUrl: string;
}

/** Event team invitation: a host or door operator of one event. The button opens the event's admin. */
export const M27 = defineTemplate<M27Data>({ code: "M-27", name: "Event team invitation", trigger: "staff or a host adds someone to an event team" }, (d) => {
  const host = d.role === "host";
  return {
    variant: "account",
    assetsUrl: assetsOf(d),
    subject: host ? `You're a host of ${d.event.name}` : `You're on the door team for ${d.event.name}`,
    preheader: `${d.inviter.name} added you to the ${d.event.name} team. ${fmtDay(d.event.startsAt, d.event.timeZone)}.`,
    hero: coverHero(d.event),
    eyebrow: host ? "EVENT HOST" : "DOOR TEAM",
    headline: host ? "You're a host" : "You're on the door team",
    body: host
      ? `${d.inviter.name} added you as a host of ${d.event.name}. You can review requests, add guests, edit the event, check guests in and run the door.`
      : `${d.inviter.name} added you as a door operator for ${d.event.name}. You can see the guest list, check guests in by hand and run the door with face check-in. Open the event before doors open to try Test mode.`,
    blocks: [
      { kind: "buttons", primary: { label: "Open the event", href: d.adminUrl } },
      { kind: "rows", rows: whenWhereRows(d.event), labelWidth: 100, size: "sm" },
    ],
    footer: { legal: `Sign in with this email address, using Google or a Didit email code. You only see ${d.event.name}.`, link: { label: "Didit Events", href: d.baseUrl } },
  };
});
