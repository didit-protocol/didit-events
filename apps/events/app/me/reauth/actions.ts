"use server";

import { profilePatchSchema } from "@didit-events/core/domain/event-model";
import { readOnboarding } from "../../../src/server/event-model-api";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAMES, cookieAttributes } from "@didit-events/core/http/policy";
import { IdentityError, otpBinding } from "@didit-events/core/identity";
import { clearSession, guardAction, requireGuest, setSession } from "../../../src/auth/actions";
import { pendingAccountAction, FRESH_AUTH_SECONDS } from "../../../src/auth/fresh-action";
import { identity } from "../../../src/auth/runtime";
import { sendCode } from "../../login/data";
import { deleteAccount } from "../settings/delete/data";
import { deleteVerificationData } from "../profile/verification/data";
import { disconnectGoogle } from "../settings/data";
import { changeVerifiedName } from "../profile/edit/data";

export type ReproofState = { sent?: boolean; error?: string; resendInSeconds?: number; sentAt?: string };
export async function reproveAction(_prev: ReproofState, form: FormData): Promise<ReproofState> {
  await guardAction(form);
  const pending = await pendingAccountAction(), account = await identity.accounts.get(pending.accountId);
  if (!account) throw new IdentityError("AccountUnavailable");
  const intent = form.get("intent");
  if (intent === "send" || intent === "resend") {
    const sent = await sendCode(account.email, intent === "resend");
    return sent.ok ? { sent: true, resendInSeconds: sent.resendInSeconds, sentAt: sent.sentAt } : { error: "Too many codes requested. Please try again later." };
  }
  if (intent !== "verify") return {};
  // Email is taken from the authenticated account, never from the submitted form.
  const jar = await cookies(), otpCookie = jar.get(COOKIE_NAMES.otp)?.value ?? "", binding = otpBinding(otpCookie);
  if (!binding) return { sent: true, error: "This code has expired. Request a new code." };
  try {
    const result = await identity.auth.reproveOtp(await requireGuest(), binding.id, String(form.get("code") ?? "").slice(0, 6), otpCookie);
    await setSession(result.cookie);
    jar.set(COOKIE_NAMES.otp, "", cookieAttributes(COOKIE_NAMES.otp, 0));
  } catch (error) {
    if (error instanceof IdentityError && ["OtpWrong", "OtpLocked", "OtpExpired"].includes(error.code)) return { sent: true, error: error.code === "OtpWrong" ? "That code is not right. Please try again." : "This code has expired or reached its attempt limit. Request a new code." };
    throw error;
  }
  const principal = await requireGuest(FRESH_AUTH_SECONDS);
  if (principal.accountId !== pending.accountId) throw new IdentityError("InvalidPendingAction", 403);
  (await cookies()).set(COOKIE_NAMES.reauth, "", cookieAttributes(COOKIE_NAMES.reauth, 0));
  switch (pending.operation) {
    case "onboarding-profile": await readOnboarding().saveOnboardingProfile(principal, profilePatchSchema.parse({ fullName: pending.fields.fullName, expectedProfileVersion: Number(pending.fields.expectedProfileVersion) })); break;
    case "delete-account": await deleteAccount(); redirect("/events?deleted=1");
    case "delete-verification": await deleteVerificationData(); redirect("/me/profile");
    case "disconnect-google": await disconnectGoogle(); redirect("/me/settings");
    case "sign-out-all": await identity.sessions.revokeAll(principal); await clearSession(); redirect("/events");
    case "change-name":
    case "save-profile": await changeVerifiedName(pending.fields.fullName!); break;
  }
  redirect(pending.next);
}
