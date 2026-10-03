import type { ReactNode } from "react";
import { AdminChrome } from "../../../src/admin/system/AdminChrome";
import { adminLinks } from "../../../src/admin/links";
import { requireStaffAccess } from "../../../src/auth/access";
import { getSystemStatus, requireStaff } from "../data";

export default async function PeopleLayout({ children }: { children: ReactNode }) {
  await requireStaffAccess("people.view", adminLinks.people());
  const [user, status] = await Promise.all([requireStaff(adminLinks.people()), getSystemStatus()]);
  return (
    <AdminChrome active="people" user={user} status={status}>
      {children}
    </AdminChrome>
  );
}
