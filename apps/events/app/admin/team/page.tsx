import { requireStaffAccess } from "../../../src/auth/access";
import type { Metadata } from "next";
import { canManageTeam } from "../../../src/admin/team/policy";
import { TeamView } from "../../../src/admin/team/TeamView";
import { adminLinks } from "../../../src/admin/links";
import { requireStaff } from "../data";
import { getTeam } from "./data";

export const metadata: Metadata = { title: "Team · Didit Events" };

// A-12 for staff (read-only), A-19 for owners and admins (invite, disable, restore).
export default async function TeamPage() {
  await requireStaffAccess("staff.view", "/admin/team");
  const [viewer, members] = await Promise.all([requireStaff(adminLinks.team()), getTeam()]);
  const manage = canManageTeam(viewer);
  return <TeamView viewer={viewer} members={members} now={new Date()} manage={manage} tokensHref={manage ? "/admin/team/tokens" : undefined} />;
}
