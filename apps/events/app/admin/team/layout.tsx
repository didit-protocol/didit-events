import type { ReactNode } from "react";
import { AdminChrome } from "../../../src/admin/system/AdminChrome";
import { requireStaffAccess } from "../../../src/auth/access";
import { getSystemStatus, requireStaff } from "../data";

export default async function TeamLayout({ children }: { children: ReactNode }) {
  await requireStaffAccess("staff.view", "/admin/team");
  const [staff, status] = await Promise.all([requireStaff("/admin/team"), getSystemStatus()]);
  return (
    <AdminChrome active="team" user={staff} status={status}>
      {children}
    </AdminChrome>
  );
}
