import { assetsOf, defineTemplate, preferencesLink, siteHost, type EmailBase, type Recipient } from "../common.ts";

/** A profile part hosts look at that the account has not filled in yet (M-29 lists only these). */
export type ProfileGap = "photo" | "roleCompany" | "headline" | "link";
/** Checklist order and labels. */
export const PROFILE_GAPS: readonly ProfileGap[] = ["photo", "roleCompany", "headline", "link"];
const GAP_LABEL: Record<ProfileGap, string> = { photo: "Profile photo", roleCompany: "Role and company", headline: "Headline", link: "A link (LinkedIn or website)" };

export interface M29Data extends EmailBase {
  recipient: Recipient;
  /** The first name the account has, or null (heading without a name). */
  firstName: string | null;
  /** What is still missing, read at send time; never empty (a complete profile gets no email). */
  missing: ProfileGap[];
  profileUrl: string;
}

/** Sent once, two days after sign-up, while the profile still misses a photo, role and company, headline or link. */
export const M29 = defineTemplate<M29Data>({ code: "M-29", name: "Complete your profile · reminder", trigger: "2 days after sign-up, profile still incomplete" }, (d) => ({
  variant: "account",
  assetsUrl: assetsOf(d),
  subject: "Finish your Didit Events profile",
  preheader: "Hosts decide from your profile. It takes a minute.",
  eyebrow: "YOUR PROFILE",
  headline: d.firstName?.trim() ? `Hi ${d.firstName.trim()}, your profile is almost there` : "Your profile is almost there",
  body: "Hosts see your photo, name, role, company and a link when you ask for a place, so a complete profile gets you in faster.",
  blocks: [
    { kind: "checklist", title: "STILL TO ADD", items: PROFILE_GAPS.filter((g) => d.missing.includes(g)).map((g) => ({ label: GAP_LABEL[g], done: false })) },
    { kind: "buttons", primary: { label: "Complete my profile", href: d.profileUrl, icon: "ticket" } },
  ],
  footer: { legal: `You created an account on ${siteHost(d)}. This is a one-time reminder.`, link: preferencesLink(d) },
}));
