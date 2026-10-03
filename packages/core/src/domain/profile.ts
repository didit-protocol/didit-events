import { profileSchema,type ProfileDraft } from "./event-model.ts";

export interface ProfileFields { fullName?: string | null; firstName?: string | null; lastName?: string | null;
  headline?: string | null; company?: string | null; jobRole?: string | null; bio?: string | null; profileLinks?: ProfileDraft["links"] }
export function profileDraft(account: ProfileFields): ProfileDraft {
  return { fullName: account.fullName ?? [account.firstName, account.lastName].filter(Boolean).join(" "), headline: account.headline ?? "",
    company: account.company ?? "", jobRole: account.jobRole ?? "", bio: account.bio ?? "", links: account.profileLinks ?? [] };
}
export function missingProfileFields(account: ProfileFields): string[] {
  const parsed = profileSchema.safeParse(profileDraft(account));
  return parsed.success ? [] : [...new Set(parsed.error.issues.map(i => String(i.path[0])))];
}
/** Display-name edits preserve case; whitespace alone does not require re-proof. */
export const displayName = (name: string): string => name.trim().replace(/\s+/gu, " ");
export const profileNameChanged = (account: ProfileFields, name: string): boolean => displayName(name) !== displayName(profileDraft(account).fullName);
export const normalizedName = (name: string): string => name.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
export function splitFullName(name: string): { firstName: string; lastName: string } {
  const [firstName = "", ...rest] = name.trim().split(/\s+/u); return { firstName, lastName: rest.join(" ") };
}
