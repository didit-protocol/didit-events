import { currentGuest } from "../../../../src/accounts/session";
import { guestPage } from "../../../../src/auth/access";
import { identity } from "../../../../src/auth/runtime";
import { profileDraft, splitFullName } from "@didit-events/core/domain/profile";
export const getEditableProfile = () => currentGuest("/me/profile/edit");
export interface ProfilePatch { headline: string; bio: string; linkedin: string; website: string; fullName?: string }
export async function saveProfile(patch: ProfilePatch): Promise<"saved" | "sign_in"> {
  // The profile service compares names and enforces freshness under the account lock.
  const principal = await guestPage("/me/profile/edit"), account = await identity.accounts.get(principal.accountId);
  if (!account) return "sign_in";
  const names = splitFullName(patch.fullName ?? profileDraft(account).fullName);
  await identity.profile.updateProfile(principal, { ...names, headline: patch.headline, bio: patch.bio, profileLinks: [{ label: "LinkedIn", href: patch.linkedin }, { label: "Website", href: patch.website }].filter(l => l.href) });
  return "saved";
}
export async function changeVerifiedName(name: string): Promise<"changed" | "sign_in"> {
  const parts = name.trim().split(/\s+/);
  await identity.profile.updateProfile(await guestPage("/me/profile/edit"), { firstName: parts[0]!, lastName: parts.slice(1).join(" ") });
  return "changed";
}
