import { redirect } from "next/navigation";
import { IdentityError } from "@didit-events/core/identity";
import { profileDraft, splitFullName } from "@didit-events/core/domain/profile";
import { requireGuest } from "./actions";
import { savePendingAccountAction } from "./fresh-action";
import { identity } from "./runtime";
/** Display names remain editable; identity facts belong to their separate proofs. */
export async function saveRegistrationProfile(input: { fullName: string; company: string; role: string }) {
  const principal = await requireGuest(), account = await identity.accounts.get(principal.accountId);
  if (!account) return;
  const fields = { company: input.company, jobRole: input.role, expectedProfileVersion: account.profileVersion };
  try { await identity.profile.updateProfile(principal, { ...fields, ...splitFullName(input.fullName) }); }
  catch (error) {
    if (!(error instanceof IdentityError) || error.code !== "FreshAuthenticationRequired") throw error;
    // Keep non-name edits now; the version fences concurrent changes while the name awaits re-proof.
    const saved = await identity.profile.updateProfile(principal, { ...fields, ...splitFullName(profileDraft(account).fullName) });
    await savePendingAccountAction(principal, "/me/profile/edit", "onboarding-profile", {
      fullName: input.fullName, expectedProfileVersion: String(saved.profileVersion),
    });
    redirect("/me/reauth");
  }
}
