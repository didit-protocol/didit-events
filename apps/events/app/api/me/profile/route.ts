import { ModelError } from "@didit-events/core/domain/model-error";
import { IdentityError } from "@didit-events/core/identity";
import { profilePatchSchema } from "@didit-events/core/domain/event-model";
import { savePendingAccountAction } from "../../../../src/auth/fresh-action";
import { failure, mutation, readOnboarding, success } from "../../../../src/server/event-model-api";

export async function PATCH(request: Request) {
  try {
    const { actor, body } = await mutation(request);
    if (actor.principal !== "guest") throw new ModelError("forbidden");
    const patch = profilePatchSchema.parse(body);
    try { return success(await readOnboarding().saveOnboardingProfile(actor, patch)); }
    catch (error) {
      if (!(error instanceof IdentityError) || error.code !== "FreshAuthenticationRequired") throw error;
      // Save unrestricted edits now; only the changed name needs re-proof. Eight
      // legal 2048-character links cannot fit in the pending cookie.
      const { fullName, expectedProfileVersion, ...fields } = patch;
      const saved = Object.keys(fields).length ? await readOnboarding().saveOnboardingProfile(actor, { expectedProfileVersion, ...fields }) : undefined;
      await savePendingAccountAction(actor, "/me/profile/edit", "onboarding-profile", {
        fullName: fullName!, expectedProfileVersion: String(saved?.profileVersion ?? expectedProfileVersion),
      });
      return Response.json({ ok: false, error: { code: "unauthenticated", message: "Confirm your email to finish this change." } }, { status: 401, headers: { "cache-control": "no-store", "x-account-reproof": "/me/reauth" } });
    }
  } catch (error) { return failure(error); }
}
