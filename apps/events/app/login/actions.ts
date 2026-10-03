"use server";

import { consentSchema } from "@didit-events/core/domain/event-model";
import { guardAction } from "../../src/auth/actions";

import { redirect } from "next/navigation";
import { accountLinks,afterSignIn,safeNext } from "../../src/accounts/links";
import type { SignInStep } from "../../src/accounts/types";
import { EMAIL_ERROR,isEmail,normalizeEmail,text } from "../../src/accounts/validate";
import { checkCode,LOCK_MINUTES,sendCode,startSession } from "./data";


/**
 * One action for the whole email-code sign-in (U-06…U-13, DA-01…DA-05, R-33): `intent` = send | resend | verify.
 * Returns the next step; a passed code redirects to `next`.
 */
export async function signInAction(prev: SignInStep, form: FormData): Promise<SignInStep> {
  await guardAction(form, { anonymous: true });
  const intent = text(form, "intent", 10);
  const email = normalizeEmail(text(form, "email", 254) || ("email" in prev && prev.email ? prev.email : ""));
  const next = safeNext(text(form, "next", 500));

  if (intent === "send" || intent === "resend") {
    if (!isEmail(email)) return { step: prev.step === "choose" ? "choose" : "email", email: text(form, "email", 254), error: EMAIL_ERROR };
    const sent = await sendCode(email, intent === "resend");
    if (!sent.ok) return { step: "locked", email, retryAt: sent.retryAt, minutes: LOCK_MINUTES, scope: "ip" };
    return { step: "code", email, status: intent === "resend" ? "resent" : "sent", attemptsLeft: 3, resendInSeconds: sent.resendInSeconds, sentAt: sent.sentAt };
  }

  if (intent === "verify") {
    const code = text(form, "code", 6).replace(/\D/g, "");
    const result = await checkCode(email, code,consentSchema.parse(JSON.parse(String(form.get("onboardingConsent")??"null"))));
    if (result.ok) {
      await startSession(email);
      // Flow v3: back to the event's join modal when the guest came from one (it asks for whatever is missing).
      const target = afterSignIn(next, result.onboarding?.step);
      if (target !== next) redirect(target);
      redirect(result.linkedGoogle ? accountLinks.login(next, { step: "linked" }) : next);
    }
    if (result.reason === "locked") return { step: "locked", email, retryAt: new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString(), minutes: LOCK_MINUTES, scope: "email" };
    if (result.reason === "expired") return { step: "code", email, status: "expired", resendInSeconds: 0 };
    if (result.reason === "wrong") return { step: "code", email, status: "wrong", attemptsLeft: result.attemptsLeft, resendInSeconds: 0 };
  }

  return prev;
}

