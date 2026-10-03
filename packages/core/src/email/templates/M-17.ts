import { assetsOf, defineTemplate, privacyLink, siteHost, type EmailBase } from "../common.ts";
import { fmtCode, fmtDayTimeZone } from "../format.ts";

export interface M17Data extends EmailBase {
  email: string;
  code: string;
  expiresInMinutes: number;
  requestedAt: Date;
  timeZone: string;
  /** "Safari on iPhone · Barcelona, ES" (from the request's user agent + IP country). */
  device: string;
}

/**
 * Account sign-in code (U-06 / DA-01). design-prompt v2 §2 redraws the design's magic-link M-17 as a code email:
 * guest sign-in is Didit's email OTP, so there is no link. Layout of design/05 M-17 with the design/04 code block.
 */
export const M17 = defineTemplate<M17Data>({ code: "M-17", name: "Sign-in code", trigger: "U-06 / DA-01" }, (d) => ({
  variant: "account",
  assetsUrl: assetsOf(d),
  subject: "Your Didit Events sign-in code",
  preheader: `Valid for ${d.expiresInMinutes} minutes.`,
  eyebrow: "SIGN IN",
  headline: "Sign in to Didit Events",
  body: `Enter this code to sign in as ${d.email}. It is valid for ${d.expiresInMinutes} minutes.`,
  blocks: [
    { kind: "code", code: fmtCode(d.code), note: `Valid for ${d.expiresInMinutes} minutes. Never share it with anyone.` },
    {
      kind: "rows",
      labelWidth: 100,
      size: "sm",
      rows: [
        { k: "Requested", v: fmtDayTimeZone(d.requestedAt, d.timeZone) },
        { k: "Device", v: d.device },
      ],
    },
    { kind: "note", text: "If you didn’t ask for this, ignore this email." },
  ],
  footer: { legal: `Sent because someone entered this email on ${siteHost(d)}.`, link: privacyLink(d) },
}));
