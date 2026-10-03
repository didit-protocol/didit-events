/** A-12 Team (design/01b Admin) and A-19 Team management (undrawn, design-prompt §3): 1440×760, sidebar "team". */
import type { ReactNode } from "react";
import type { FrameDef } from "@didit-events/ui/frames/registry";
import { ALBERTO } from "../fixtures";
import { adminFrame } from "../frame";
import { AdminShell } from "../shell/AdminShell";
import { DisableAccess } from "./DisableAccess";
import { INVITE_ERROR, INVITE_SENT, INVITED, PAU_DISABLED, TEAM, TEAM_NOW } from "./fixtures";
import { TeamView, type TeamViewProps } from "./TeamView";
import s from "./Team.module.css";

const W = 1440;
const H = 760;

const team = (props: Omit<TeamViewProps, "viewer" | "now">, overlay?: ReactNode) =>
  function TeamFrame() {
    return (
      <>
        <AdminShell fill active="team" user={ALBERTO}>
          <TeamView viewer={ALBERTO} now={TEAM_NOW} {...props} />
        </AdminShell>
        {overlay}
      </>
    );
  };

const JOAN = TEAM[1]!;

export const teamFrames: FrameDef[] = [
  // A-12 as drawn: the read-only list (what staff-role members see).
  adminFrame("A-12a", "A-12 Team / populated", W, H, team({ members: TEAM, manage: false })),
  adminFrame("A-12b", "A-12 Team / loading", W, H, team({ members: null, manage: false })),
  adminFrame("A-12c", "A-12 Team / empty", W, H, team({ members: [TEAM[0]!], manage: false })),
  // A-19: the owner/admin view.
  adminFrame("A-19a", "A-19 Team management / invite sent", W, H, team({ members: [...TEAM, INVITED], manage: true, inviteState: INVITE_SENT })),
  adminFrame("A-19b", "A-19 Team management / invite error", W, H, team({ members: TEAM, manage: true, inviteState: INVITE_ERROR })),
  adminFrame(
    "A-19c",
    "A-19 Team management / disabling confirm",
    W,
    H,
    team(
      { members: TEAM, manage: true },
      <div className={s.frameScrim}>
        <DisableAccess email={JOAN.email} name={JOAN.name} open inline />
      </div>,
    ),
  ),
  adminFrame("A-19d", "A-19 Team management / disabled row", W, H, team({ members: [...TEAM.slice(0, 4), PAU_DISABLED], manage: true })),
];
