import type { ReactNode } from "react";
import { AdminChrome } from "../../../src/admin/system/AdminChrome";
import { getSystemStatus, requireStaff } from "../data";

// Events section of the admin: /admin, /admin/events/new, /admin/events/[id]/*.
export default async function EventsSectionLayout({ children }: { children: ReactNode }) {
  const [staff, status] = await Promise.all([requireStaff(), getSystemStatus()]);
  return (
    <AdminChrome active="events" user={staff} status={status}>
      {children}
    </AdminChrome>
  );
}
