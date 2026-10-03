import type { ReactNode } from "react";
import { AdminChrome } from "../../../src/admin/system/AdminChrome";
import { requireStaffAccess } from "../../../src/auth/access";
import { getSystemStatus, requireStaff } from "../data";

export default async function CalendarLayout({ children }: { children: ReactNode }) {
  await requireStaffAccess("calendar.view", "/admin/calendar");
  const [staff, status] = await Promise.all([requireStaff("/admin/calendar"), getSystemStatus()]);
  return (
    <AdminChrome active="calendar" user={staff} status={status}>
      {children}
    </AdminChrome>
  );
}
