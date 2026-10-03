import { place,coverHero,assetsOf, defineTemplate, privacyLink, whenWhereRows, type EmailBase, type EmailEvent } from "../common.ts";
import { fmtDay } from "../format.ts";

export interface M19Data extends EmailBase {
  event: EmailEvent;
  /** Trailing words of the event name shown in brand-deep in the hero band ("AI Era"). */
  titleAccent?: string;
  /** Mid-sentence pitch: "an evening on building and raising in the AI era". */
  pitch: string;
  inviter: { firstName: string };
  /** Optional personal message from the inviter. */
  message?: string;
  /** Admission facts supplied by the invitation outbox entry. */
  skipApproval?: boolean;
  waitlisted?: boolean;
  acceptUrl: string;
}

export const M19 = defineTemplate<M19Data>({ code: "M-19", name: "Direct invite from staff", trigger: "AP-16 invite" }, (d) => {
  const who = d.inviter.firstName;
  const review = d.skipApproval === false;
  return {
    variant: "account",
    assetsUrl: assetsOf(d),
    subject: `${who} invited you to ${d.event.name}`,
    preheader: `${review ? "Request a place." : "Complete your request to confirm a place."} ${place(fmtDay(d.event.startsAt, d.event.timeZone), d.event.venueName)}.`,
    hero: coverHero(d.event),
    eyebrow: "YOU ARE INVITED",
    headline: `${who} invited you`,
    body: `You are invited to ${d.pitch}. ${review ? "Complete the required checks and submit your request. The host will email you with a decision." : "Complete the required checks and submit your request. Your place will be confirmed if space is available, or you can join the waitlist."}`,
    blocks: [
      ...(d.message ? [{ kind: "quote" as const, text: `“${d.message}” — ${who}, Didit` }] : []),
      { kind: "buttons", primary: { label: "Accept invite", href: d.acceptUrl } },
      { kind: "rows", rows: whenWhereRows(d.event), labelWidth: 100, size: "sm" },
    ],
    footer: { legal: "A Didit team member invited this email address.", link: privacyLink(d) },
  };
});
