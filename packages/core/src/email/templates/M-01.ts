import { assetsOf, defineTemplate, privacyLink, siteHost, type EmailBase } from "../common.ts";
import { fmtCode } from "../format.ts";

export interface M01Data extends EmailBase {
  code: string;
  expiresInMinutes: number;
  /** The event the guest is requesting, when sign-in started from an event page. */
  eventName?: string;
}

/** Didit Events sign-in code (R-04). Sent by Didit's standalone email OTP, white-labelled as Didit Events. */
export const M01 = defineTemplate<M01Data>({ code: "M-01", name: "Sign-in code · Didit Events", trigger: "R-03 register / sign in" }, (d) => ({
  variant: "event",
  assetsUrl: assetsOf(d),
  subject: `Your Didit Events code: ${fmtCode(d.code)}`,
  preheader: `Enter it to confirm your email. Expires in ${d.expiresInMinutes} minutes.`,
  eyebrow: "CONFIRM YOUR EMAIL",
  headline: "Your code",
  body: d.eventName
    ? `Enter this code to confirm your email before requesting a place at ${d.eventName}.`
    : "Enter this code to confirm your email and sign in to Didit Events.",
  blocks: [
    { kind: "code", code: fmtCode(d.code), note: `Expires in ${d.expiresInMinutes} minutes. Never share it with anyone.` },
    { kind: "note", text: "Did not ask for this? You can ignore this email." },
  ],
  footer: { legal: `Sent because someone entered this email on ${siteHost(d)}.`, link: privacyLink(d) },
}));
