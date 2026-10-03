import type { OnboardingView,VerificationLaunch } from "@didit-events/core/contracts/event-model";
import type { ConsentInput } from "@didit-events/core/domain/event-model";
import { COOKIE_NAMES,cookieAttributes } from "@didit-events/core/http/policy";
import { IdentityError,otpBinding } from "@didit-events/core/identity";
import { cookies } from "next/headers";
import type { CodeCheck } from "../../src/accounts/types";
import { requireGuest,setSession,sourceIp } from "../../src/auth/actions";
import { identity } from "../../src/auth/runtime";
import { publicEvent,publicModel } from "../../src/server/b4-views";

export const CODE_TTL_MINUTES = 5;
export const RESEND_AFTER_SECONDS = 30;
export const LOCK_MINUTES = 60;
export type SendResult = { ok: true; resendInSeconds: number; sentAt: string } | { ok: false; reason: "locked"; retryAt: string };
export async function sendCode(email: string, resend = false): Promise<SendResult> {
  const jar = await cookies();
  try {
    const result = await identity.auth.sendOtp(email, await sourceIp(), { cookie: jar.get(COOKIE_NAMES.otp)?.value, resend });
    jar.set(COOKIE_NAMES.otp, result.cookie, cookieAttributes(COOKIE_NAMES.otp, Math.max(0, Math.ceil((result.expiresAt.getTime() - Date.now()) / 1000))));
    return { ok: true, resendInSeconds: RESEND_AFTER_SECONDS, sentAt: new Date().toISOString() };
  } catch (error) {
    if (error instanceof IdentityError && error.code === "OtpRateLimited") return { ok: false, reason: "locked", retryAt: new Date(Date.now() + 3600000).toISOString() };
    throw error;
  }
}
export async function checkCode(email: string, code: string, consent?:ConsentInput): Promise<CodeCheck & {onboarding?:OnboardingView;faceLaunch?:VerificationLaunch}> {
  const jar = await cookies(), cookie = jar.get(COOKIE_NAMES.otp)?.value ?? "", binding = otpBinding(cookie);
  if (!binding) return { ok: false, reason: "expired" };
  try {
    const result = await identity.auth.checkOtp(binding.id, code, { otpCookie: cookie, previousCookie: jar.get(COOKIE_NAMES.session)?.value, email, consent });
    await setSession(result.cookie);
    jar.set(COOKIE_NAMES.otp, "", cookieAttributes(COOKIE_NAMES.otp, 0));
    return { ok: true, isNew: result.isNew, linkedGoogle: false,onboarding:result.onboarding,faceLaunch:result.faceLaunch };
  } catch (error) {
    if (error instanceof IdentityError) {
      if (error.code === "OtpWrong") return { ok: false, reason: "wrong", attemptsLeft: error.attemptsLeft ?? 0 };
      if (error.code === "OtpLocked") return { ok: false, reason: "locked" };
      if (["OtpExpired", "AccountUnavailable"].includes(error.code)) return { ok: false, reason: "expired" };
    }
    throw error;
  }
}
/** The check transaction has already created and rotated the session; this only confirms the resulting identity. */
export async function startSession(email: string): Promise<void> {
  const principal = await requireGuest();
  if ((await identity.accounts.get(principal.accountId))?.email !== email.trim().toLowerCase()) throw new IdentityError("OtpEmailMismatch");
}
export async function eventForNext(next: string) { const slug = /^\/(?:e|me\/events)\/([a-z0-9-]+)/.exec(next)?.[1]; const model = slug ? await publicModel(slug) : null; return model ? publicEvent(model.event, model.approvedCount) : undefined; }
export { currentGuest } from "../../src/accounts/session";
