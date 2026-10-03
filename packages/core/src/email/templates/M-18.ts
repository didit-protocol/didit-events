import { assetsOf, defineTemplate, privacyLink, siteHost, type EmailBase, type Recipient } from "../common.ts";

export interface M18Data extends EmailBase {
  recipient: Recipient;
  myEventsUrl: string;
}

export const M18 = defineTemplate<M18Data>({ code: "M-18", name: "Welcome · onboarding complete", trigger: "email, profile and face complete" }, (d) => ({
  variant: "account",
  assetsUrl: assetsOf(d),
  subject: "Welcome to Didit Events",
  preheader: "Your account is ready. No password to remember.",
  eyebrow: "ACCOUNT CREATED",
  headline: `Welcome, ${d.recipient.firstName}`,
  // Design says "Google or an email link"; sign-in is an email code (implementation-plan §1), so the copy says code.
  body: "Your Didit Events account is ready. Sign in any time with Google or an email code. All your requests and tickets live in My events.",
  blocks: [{ kind: "buttons", primary: { label: "Go to My events", href: d.myEventsUrl } }],
  footer: { legal: `You created an account on ${siteHost(d)}.`, link: privacyLink(d) },
}));
