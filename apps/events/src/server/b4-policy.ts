import { cookies } from "next/headers";
import { authService } from "@didit-events/core";
import { COOKIE_NAMES, PolicyError } from "@didit-events/core/http/policy";
import type { StaffUser } from "../admin/types";
import { IdentityError } from "@didit-events/core/identity";
import { staffPage } from "../auth/access";
export const appOrigin = () => new URL(process.env.APP_URL ?? "http://localhost:3000").origin;
export async function staffPrincipal() {
  return staffPage();
}
export async function guestPrincipal() {
  const value = (await cookies()).get(COOKIE_NAMES.session)?.value;
  try { return value ? await authService.requireGuest(value) : null; }
  catch (error) { if (error instanceof IdentityError && [401, 403].includes(error.status)) return null; throw error; }
}
/** The signed-in staff member, or null (never redirects): lets public pages show "Signed in to admin". */
export async function staffViewer(): Promise<{ email: string } | null> {
  const value = (await cookies()).get(COOKIE_NAMES.session)?.value;
  if (!value) return null;
  try { const p = await authService.requireStaff(value); return { email: p.email }; }
  catch { return null; }
}
export async function actionStaff(): Promise<(StaffUser & Awaited<ReturnType<typeof staffPrincipal>>) | null> {
  const actor = await staffPrincipal(); return { ...actor, name: actor.email, initials: actor.email.slice(0, 2).toUpperCase() };
}
/** Read endpoints reject device/webhook credentials; signed staff session is still checked by B2. */
export async function staffRead(req: Request) {
  if (["authorization", "x-signature", "x-signature-v2"].some(h => req.headers.has(h))) throw new PolicyError(403, "BrowserCallerRequired");
  const origin = req.headers.get("origin"); if (origin && origin !== appOrigin()) throw new PolicyError(403, "BrowserOriginRequired");
  return authService.requireStaff((await cookies()).get(COOKIE_NAMES.session)?.value ?? "");
}
