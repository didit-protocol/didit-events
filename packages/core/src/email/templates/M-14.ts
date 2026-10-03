import { assetsOf, coverHero, defineTemplate, preferencesLink, type EmailBase, type EmailEvent } from "../common.ts";

export interface M14Data extends EmailBase {
  event: EmailEvent;
  attendeeCount: number;
  /** Event-specific recap copy: preheader "Both panels, plus photos." and line "Both panels are recorded, and the photos are up." */
  recap: { preheader: string; line: string };
  recordingsUrl: string;
  photosUrl: string;
}

export const M14 = defineTemplate<M14Data>({ code: "M-14", name: "Thanks + recordings", trigger: "T+1 day, attended" }, (d) => ({
  variant: "event",
  assetsUrl: assetsOf(d),
  subject: `Recordings from ${d.event.name}`,
  preheader: d.recap.preheader || "Thanks for coming.",
  hero: coverHero(d.event),
  eyebrow: "THANK YOU",
  headline: "Thanks for coming",
  body: `${d.attendeeCount > 0 ? `${d.attendeeCount} founders and operators joined. ` : ""}${d.recap.line}`,
  blocks: [{ kind: "buttons", primary: { label: "Watch the panels", href: d.recordingsUrl }, secondary: { label: "See photos", href: d.photosUrl } }],
  footer: { legal: "You attended a Didit event.", link: preferencesLink(d) },
}));
