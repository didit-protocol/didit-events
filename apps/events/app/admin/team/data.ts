import { requireStaffAccess } from "../../../src/auth/access";
import { identity } from "../../../src/auth/runtime";
import type { TeamMember } from "../../../src/admin/team/types";

export async function getTeam(): Promise<TeamMember[]> {
  const staff = await requireStaffAccess("staff.view", "/admin/team");
  const rows = await identity.team.listStaff(staff);
  return rows.map(row => ({ email: row.email, name: row.email.split("@")[0]!, initials: row.email.slice(0, 2).toUpperCase(),
    role: row.role, disabledAt: row.disabledAt?.toISOString() ?? null, lastActiveAt: row.lastActiveAt?.toISOString() ?? null }));
}
export async function findMember(email: string): Promise<TeamMember | undefined> {
  await requireStaffAccess("staff.view", "/admin/team");
  return (await getTeam()).find(member => member.email === email);
}
