import { assetsOf, defineTemplate, preferencesLink, siteHost, type EmailBase, type Recipient } from "../common.ts";

export interface M28Data extends EmailBase {
  recipient: Recipient;
  /** The first name the account has, or null (heading "Welcome"). */
  firstName: string | null;
  exploreUrl: string;
  /** Profile editor; set only while the profile is incomplete. */
  profileUrl?: string | null;
}

/** Sent once when a guest account is created (email code or Google sign-up). */
export const M28 = defineTemplate<M28Data>({ code: "M-28", name: "Welcome · account created", trigger: "a guest account is created (email code or Google)" }, (d) => ({
  variant: "account",
  assetsUrl: assetsOf(d),
  subject: "Welcome to Didit Events",
  preheader: "Your account is ready. Verify once and you're recognised at every Didit event door.",
  eyebrow: "ACCOUNT CREATED",
  headline: d.firstName?.trim() ? `Welcome, ${d.firstName.trim()}` : "Welcome",
  body: "Your Didit Events account is ready. You verify you're human once, with a quick selfie, and you're recognised at every Didit event door. Hosts see your profile, never your selfie.",
  blocks: [
    { kind: "buttons", primary: { label: "Explore events", href: d.exploreUrl, icon: "ticket" } },
    ...(d.profileUrl ? [{ kind: "textLink" as const, lead: "Hosts decide from your profile.", link: { label: "Complete your profile", href: d.profileUrl } }] : []),
  ],
  footer: { legal: `You created an account on ${siteHost(d)}.`, link: preferencesLink(d) },
}));
