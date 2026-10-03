import { assetsOf, defineTemplate, DIDIT_SENDER, type EmailBase } from "../common.ts";
import { fmtCode } from "../format.ts";

export interface M04Data extends EmailBase {
  code: string;
  email: string;
  expiresInMinutes: number;
}

/** The code Didit sends inside the hosted verification flow (R-12). Didit sends it; kept here as the reference. */
export const M04 = defineTemplate<M04Data>(
  { code: "M-04", name: "Didit verification code (inside the hosted flow)", trigger: "R-12 Didit email step", from: DIDIT_SENDER },
  (d) => ({
    variant: "event",
    assetsUrl: assetsOf(d),
    subject: `${fmtCode(d.code)} is your Didit verification code`,
    preheader: `Use it to verify your email. Expires in ${d.expiresInMinutes} minutes.`,
    eyebrow: "DIDIT · EMAIL VERIFICATION",
    eyebrowTone: "muted",
    headline: "Verify your email",
    body: `Enter this code in your Didit verification to confirm ${d.email}.`,
    blocks: [{ kind: "code", code: fmtCode(d.code), note: `Expires in ${d.expiresInMinutes} minutes. Didit will never ask for this code by phone.` }],
    footer: { legal: "Didit sends this on behalf of Didit Events as part of identity verification.", link: { label: "Didit privacy", href: "https://didit.me/privacy" } },
  }),
);
