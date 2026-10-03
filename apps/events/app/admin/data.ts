import { identity } from "../../src/auth/runtime";
import { photoSrc } from "../../src/accounts/photo";
import { displayName } from "../../src/public/viewer-name";
import type { AdminViewer } from "@didit-events/core/access/principal";
import { adminViewer } from "@didit-events/core/access/principal";
import { operationalStatus } from "@didit-events/core/status";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { COOKIE_NAMES } from "@didit-events/core/http/policy";
import { IdentityError } from "@didit-events/core/identity";
import { adminLinks } from "../../src/admin/links";
import type { StaffUser } from "../../src/admin/types";
import { adminPage } from "../../src/auth/access";

/** The signed-in admin user for the chrome. Event members show their role on their (first) event. */
export async function adminUser(viewer: AdminViewer): Promise<StaffUser> {
  const accountId = viewer.kind === "staff" ? viewer.staff.accountId : viewer.guest.accountId;
  const account = accountId ? await identity.accounts.get(accountId) : null;
  const role = viewer.kind === "staff" ? viewer.staff.role : "staff";
  const member = viewer.kind === "member" ? (viewer.memberships.some(m => m.role === "host") ? "host" : "operator") : undefined;
  return { email: viewer.email, name: account ? displayName(account) : viewer.email.split("@")[0]!, initials: viewer.email.slice(0, 2).toUpperCase(), role, member, photoUrl: account ? photoSrc(account.photoUrl, account.updatedAt) : undefined };
}

/** The signed-in admin user, or null (never redirects). */
export async function getStaff(): Promise<StaffUser | null> {
  await connection();
  try { return adminUser(await adminViewer((await cookies()).get(COOKIE_NAMES.session)?.value ?? "", { identity })); }
  catch (error) {
    if (error instanceof IdentityError && (error.status === 401 || error.status === 403)) return null;
    throw error;
  }
}

/** The signed-in admin user (staff or event team member), or a redirect to sign-in / forbidden. */
export async function requireStaff(next = adminLinks.home()): Promise<StaffUser> {
  return adminUser(await adminPage(next));
}

export interface SystemStatus {
  /** A-13e: Didit is not responding (new links and verification updates are delayed). */
  diditApi: "ok" | "degraded";
}

export async function getSystemStatus(): Promise<SystemStatus> {
  await adminPage();
  return operationalStatus();
}
