"use server";

import { consentSchema } from "@didit-events/core/domain/event-model";
import { guardAction,requireGuest } from "../../../../src/auth/actions";
import { saveRegistrationProfile } from "../../../../src/auth/profile";

import { redirect } from "next/navigation";
import { accountLinks } from "../../../../src/accounts/links";
import type { ProfileFormState,RegisterInput,RegisterState } from "../../../../src/accounts/types";
import { checked,isEmail,normalizeEmail,slugOf,text,validateProfile,validateRegister } from "../../../../src/accounts/validate";
import { checkCode,currentGuest,LOCK_MINUTES,sendCode,startSession } from "../../../login/data";
import { joinWaitlist,registerGate,submitRequest } from "./data";


const readRegister = (form: FormData): RegisterInput => ({
  fullName: text(form, "fullName", 120),
  email: normalizeEmail(text(form, "email", 254)),
  company: text(form, "company", 120),
  role: text(form, "role", 120),
  consent: checked(form, "consent"),
});

/**
 * Where a request that can't go ahead lands: an unknown event → the calendar; a full / closed / invite-only / ended
 * event → its public page, whose card says why (P-02j/k/m). Never returns.
 */
function leaveGated(slug: string, result: { kind: "not_found" } | { kind: "gated" }): never {
  redirect(result.kind === "not_found" ? accountLinks.calendar() : accountLinks.event(slug));
}

/** R-01…R-09: details → Didit email code → request. `intent` = details | resend | verify. */
export async function registerAction(prev: RegisterState, form: FormData): Promise<RegisterState> {
  await guardAction(form, { anonymous: true });
  const intent = text(form, "intent", 10);
  const slug = slugOf(form);
  const values = readRegister(form);

  // The event gate holds for signed-out visitors too, and is re-checked on every POST (a code can't open a closed event).
  const gate = await registerGate(slug, new Date());
  if (gate.kind !== "open") leaveGated(slug, gate);

  // The code step posts the details again as hidden fields: re-check them before any code or request work.
  if (intent === "details" || intent === "verify") {
    const errors = validateRegister(values);
    if (Object.keys(errors).length) return { step: "form", values, errors };
  }
  if (intent === "details" || intent === "resend") {
    if (!isEmail(values.email)) return { step: "form", values, errors: { email: "Enter a valid email address" } };
    const sent = await sendCode(values.email, intent === "resend");
    if (!sent.ok) return { step: "locked", values, minutes: LOCK_MINUTES, scope: "ip" };
    return { step: "code", values, status: intent === "resend" ? "resent" : "sent", attemptsLeft: 3, resendInSeconds: sent.resendInSeconds, sentAt: sent.sentAt };
  }
  if (intent === "verify") {
    const result = await checkCode(values.email, text(form, "code", 6).replace(/\D/g, ""),consentSchema.parse(JSON.parse(String(form.get("onboardingConsent")??"null"))));
    if (!result.ok) {
      if (result.reason === "locked") return { step: "locked", values, minutes: LOCK_MINUTES, scope: "email" };
      if (result.reason === "expired") {
        // R-06: the old code timed out, a fresh one goes out straight away.
        const sent = await sendCode(values.email);
        if (!sent.ok) return { step: "locked", values, minutes: LOCK_MINUTES, scope: "ip" };
        return { step: "code", values, status: "expired", attemptsLeft: 3, resendInSeconds: 59, sentAt: sent.sentAt };
      }
      return { step: "code", values, status: "wrong", attemptsLeft: result.reason === "wrong" ? result.attemptsLeft : 0, resendInSeconds: 0 };
    }
    await startSession(values.email);
    await saveRegistrationProfile(values);
    redirect(accountLinks.register(slug));
  }
  return prev;
}

/** U-14…U-16: first-time profile, then the request. */
export async function profileAction(_prev: ProfileFormState, form: FormData): Promise<ProfileFormState> {
  await guardAction(form);
  await requireGuest();
  const slug = slugOf(form);
  const guest = await currentGuest();
  if (!guest) redirect(accountLinks.login(accountLinks.register(slug)));
  const values = { fullName: text(form, "fullName", 120), company: text(form, "company", 120), role: text(form, "role", 120), why: text(form, "why", 280), consent: checked(form, "consent") };
  const errors = validateProfile(values, true);
  if (Object.keys(errors).length) return { values, errors };
  await saveRegistrationProfile(values);
  redirect(accountLinks.register(slug));
}

/** U-39 / U-40: request with the verified profile. */
export async function requestWithProfileAction(form: FormData): Promise<void> {
  await guardAction(form);
  await requireGuest();
  const slug = slugOf(form);
  const result=await submitRequest(slug,JSON.parse(String(form.get("request")??"null")));
  redirect(result.redirectTo);
}

/** R-28: join the waitlist. */
export async function joinWaitlistAction(form: FormData): Promise<void> {
  await guardAction(form);
  await requireGuest();
  const slug = slugOf(form);
  await joinWaitlist(slug,JSON.parse(String(form.get("request")??"null")));
  redirect(accountLinks.myEvent(slug));
}

export async function submitRequestAction(form:FormData){await guardAction(form);await requireGuest();return submitRequest(slugOf(form),JSON.parse(String(form.get("request")??"null")));}
