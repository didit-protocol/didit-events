"use server";
import { savePendingAccountAction } from "../../src/auth/fresh-action";
import { IdentityError } from "@didit-events/core/identity";
import { redirect } from "next/navigation";
import { consentSchema,profilePatchSchema } from "@didit-events/core/domain/event-model";
import { modelServices } from "@didit-events/core/verification/model-runtime";
import { z } from "zod";
import { guardAction,requireGuest } from "../../src/auth/actions";
import { readOnboarding } from "../../src/server/event-model-api";
export async function saveOnboardingProfile(form: FormData) {
  await guardAction(form);
  const profile = profilePatchSchema.parse(JSON.parse(String(form.get("profile") ?? "null"))), principal = await requireGuest();
  try { return await readOnboarding().saveOnboardingProfile(principal, profile); }
  catch (error) {
    if (!(error instanceof IdentityError) || error.code !== "FreshAuthenticationRequired") throw error;
    const { fullName, expectedProfileVersion, ...fields } = profile;
    const saved = Object.keys(fields).length ? await readOnboarding().saveOnboardingProfile(principal, { expectedProfileVersion, ...fields }) : undefined;
    await savePendingAccountAction(principal, "/me/profile/edit", "onboarding-profile", {
      fullName: fullName!, expectedProfileVersion: String(saved?.profileVersion ?? expectedProfileVersion),
    });
    redirect("/me/reauth");
  }
}
export async function ensureFaceSession(form:FormData){await guardAction(form);return modelServices().onboarding.ensureFaceSession(await requireGuest(),{purpose:z.enum(["onboarding","face_renewal","re_enrolment"]).parse(form.get("purpose")),consent:consentSchema.parse(JSON.parse(String(form.get("consent")??"null")))});}
