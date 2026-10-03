import { ROLE_CAN, ROLE_LABEL, ROLE_SUMMARY, type StaffRoleName } from "../../identity/staff-roles.ts";
import { assetsOf, defineTemplate, privacyLink, siteHost, type EmailBase } from "../common.ts";

export interface T01Data extends EmailBase {
  /** The invited staff address (the outbox row's explicit `to`). */
  inviteeEmail: string;
  /** Who sent the invite: their name when their account has one, always their email. */
  inviter: { name?: string; email: string };
  role: StaffRoleName;
  /** {APP_URL}/admin; Google sign-in with the invited address opens it. */
  adminUrl: string;
}

/** Team invite: an owner or admin added a staff address on /admin/team (or MCP `team_invite`), or resent it. */
export const T01 = defineTemplate<T01Data>({ code: "T-01", name: "Team invite", trigger: "A-19 Send invite / Resend invite, MCP team_invite" }, (d) => {
  const who = d.inviter.name?.trim() || d.inviter.email;
  const role = ROLE_LABEL[d.role];
  return {
    variant: "account",
    assetsUrl: assetsOf(d),
    subject: `${who} invited you to Didit Events`,
    preheader: `You can open the Didit Events admin as ${role}. Sign in with Google using ${d.inviteeEmail}.`,
    eyebrow: "TEAM INVITE",
    headline: "You are on the Didit Events team",
    body: `${who} invited you to the Didit Events admin as ${role}. ${ROLE_SUMMARY[d.role]} Sign in with Google using your @${d.inviteeEmail.split("@")[1]} account (${d.inviteeEmail}).`,
    blocks: [
      { kind: "buttons", primary: { label: "Open Didit Events admin", href: d.adminUrl } },
      { kind: "rows", rows: [
        { k: "Invited by", v: d.inviter.name?.trim() ? `${d.inviter.name.trim()} (${d.inviter.email})` : d.inviter.email },
        { k: "Role", v: role, tone: "strong" },
        { k: "Sign in", v: `Google, as ${d.inviteeEmail}` },
      ], labelWidth: 100, size: "sm" },
      { kind: "agenda", title: `WHAT ${role.toUpperCase()} CAN DO`, items: ROLE_CAN[d.role].map(line => ({ t: "·", l: line })) },
      { kind: "note", text: "Not expecting this? Ignore this email. Nothing happens until you sign in." },
    ],
    footer: { legal: `A Didit Events owner or admin invited this address on ${siteHost(d)}.`, link: privacyLink(d) },
  };
});
