import type { ReactNode } from "react";
import { Toaster, type AdminSection } from "@didit-events/ui";
import { AdminShell } from "../shell/AdminShell";
import type { StaffUser } from "../types";
import { DiditApiBanner } from "./DiditApiBanner";
import { OfflineBanner } from "./OfflineBanner";
import { SessionExpiredModal } from "./SessionExpiredModal";

export interface SystemStatusProps {
  diditApi: "ok" | "degraded";
}

/** A-13d/e: the strips above every admin page (Didit API from the server status, offline from the browser). */
export function SystemBanners({ status, offline }: { status: SystemStatusProps; offline?: boolean }) {
  return (
    <>
      {status.diditApi === "degraded" ? <DiditApiBanner /> : null}
      <OfflineBanner offline={offline} />
    </>
  );
}

/**
 * The admin shell as the route layouts use it: sidebar + page, plus the A-13 system surfaces (Didit API banner,
 * offline banner, session-expired modal) and the toast region the mutations report into.
 */
export function AdminChrome({ active, user, status, children }: { active: AdminSection; user: StaffUser; status: SystemStatusProps; children: ReactNode }) {
  return (
    <AdminShell active={active} user={user} banner={<SystemBanners status={status} />}>
      {children}
      <SessionExpiredModal />
      <Toaster />
    </AdminShell>
  );
}
