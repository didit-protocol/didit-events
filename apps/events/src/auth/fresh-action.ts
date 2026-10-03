import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { GuestPrincipal } from "@didit-events/core";
import { IdentityError } from "@didit-events/core/identity";
import { seal, unseal } from "@didit-events/core/identity/shared";
import { COOKIE_NAMES, cookieAttributes } from "@didit-events/core/http/policy";
import { requireGuest } from "./actions";
import { guestPage } from "./access";
import { sessionSecret } from "./browser";

export const FRESH_AUTH_SECONDS = 15 * 60;
const pendingSchema = z.object({
  purpose: z.literal("account-action"), accountId: z.uuid(), expires: z.number(), next: z.enum(["/me/settings", "/me/settings/delete", "/me/profile", "/me/profile/edit", "/me/profile/verification"]),
  operation: z.enum(["delete-account", "delete-verification", "disconnect-google", "sign-out-all", "change-name", "save-profile", "onboarding-profile"]),
  // 240 Unicode code points cost at most 960 UTF-8 bytes. With only a name and
  // version, every valid pending action fits under the 3800-byte sealed cap.
  fields: z.object({
    fullName: z.string().refine(value => Array.from(value).length <= 240).optional(),
    expectedProfileVersion: z.string().regex(/^[1-9]\d{0,15}$/).optional(),
  }).strict(),
});
export type PendingAccountAction = z.infer<typeof pendingSchema>;

/** Called only after the original action's CSRF guard and input validation. */
export async function freshAccountAction(next: string, operation: PendingAccountAction["operation"], fields: Record<string, string> = {}) {
  const principal = await guestPage(next);
  try { return await requireGuest(FRESH_AUTH_SECONDS); }
  catch (error) {
    if (!(error instanceof IdentityError) || error.code !== "FreshAuthenticationRequired") throw error;
  }
  await savePendingAccountAction(principal, next, operation, fields);
  redirect("/me/reauth");
}
export async function savePendingAccountAction(principal: GuestPrincipal, next: string, operation: PendingAccountAction["operation"], fields: Record<string, string>) {
  const pending = pendingSchema.parse({ purpose: "account-action", accountId: principal.accountId, expires: Date.now() + FRESH_AUTH_SECONDS * 1000, next, operation, fields });
  const value = seal(pending, sessionSecret());
  if (value.length > 3800) throw new IdentityError("InvalidPendingAction", 400);
  (await cookies()).set(COOKIE_NAMES.reauth, value, cookieAttributes(COOKIE_NAMES.reauth, FRESH_AUTH_SECONDS));
}
export async function pendingAccountAction(): Promise<PendingAccountAction> {
  const principal = await guestPage("/me/reauth"), value = (await cookies()).get(COOKIE_NAMES.reauth)?.value;
  let pending: PendingAccountAction;
  try { pending = pendingSchema.parse(unseal(value ?? "", sessionSecret())); }
  catch { throw new IdentityError("InvalidPendingAction", 400); }
  if (pending.expires <= Date.now() || pending.accountId !== principal.accountId) throw new IdentityError("InvalidPendingAction", 400);
  return pending;
}
