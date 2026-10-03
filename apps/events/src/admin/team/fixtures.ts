/** A-12 / A-19 fixtures: the five people of design/01b Admin (`TM`), in design order. */
import { INVITE_ERRORS } from "./policy";
import type { InviteState, TeamMember } from "./types";

/** The Team frames' clock: the design's "19 Oct" and "Yesterday" need a day after 20 Oct. */
export const TEAM_NOW = new Date("2026-10-21T15:00:00+02:00");

export const TEAM: TeamMember[] = [
  { email: "events.team@didit.me", name: "Alberto", initials: "AL", role: "owner", lastActiveAt: "2026-10-21T15:00:00+02:00" },
  { email: "joan.colome@didit.me", name: "Joan Colomé", initials: "JC", role: "admin", lastActiveAt: "2026-10-21T14:48:00+02:00" },
  { email: "hector.carrillo@didit.me", name: "Héctor Carrillo", initials: "HC", role: "staff", lastActiveAt: "2026-10-21T11:20:00+02:00" },
  { email: "laura.marti@didit.me", name: "Laura Martí", initials: "LM", role: "staff", lastActiveAt: "2026-10-20T18:05:00+02:00" },
  { email: "pau.soler@didit.me", name: "Pau Soler", initials: "PS", role: "staff", lastActiveAt: "2026-10-19T10:30:00+02:00" },
];

/** A-19a: the invite that was just sent shows up as a row nobody has signed in with yet. */
export const INVITED: TeamMember = { email: "marta.vidal@didit.me", name: "marta.vidal", initials: "MV", role: "staff", lastActiveAt: null };
export const INVITE_SENT: InviteState = { status: "sent", email: INVITED.email };
/** A-19b: a Gmail address is not staff. */
export const INVITE_ERROR: InviteState = { status: "invalid", email: "maria.garcia@gmail.com", role: "staff", errors: { email: INVITE_ERRORS.domain } };
/** A-19d: Pau's access was disabled. */
export const PAU_DISABLED: TeamMember = { ...TEAM[4]!, disabledAt: "2026-10-21T14:58:00+02:00" };
