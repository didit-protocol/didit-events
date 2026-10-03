"use server";

import { savePendingAccountAction } from "../../../../src/auth/fresh-action";
import { IdentityError } from "@didit-events/core/identity";
import { guestPage } from "../../../../src/auth/access";

import { guardAction } from "../../../../src/auth/actions";

import { redirect } from "next/navigation";
import type { SheetState } from "../../../../src/accounts/components/AccountSheets";
import type { EditProfileState } from "../../../../src/accounts/components/EditProfileForm";
import { accountLinks } from "../../../../src/accounts/links";
import { text } from "../../../../src/accounts/validate";
import { changeVerifiedName, saveProfile } from "./data";

const url = (v: string) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v);
const okUrl = (v: string) => {
  if (!v) return true;
  try {
    const u = new URL(url(v));
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

/** U-34 "Save changes". */
export async function saveProfileAction(_prev: EditProfileState, form: FormData): Promise<EditProfileState> {
  const principal = await guestPage("/me/profile/edit");
  await guardAction(form);
  const patch = { headline: text(form, "headline", 80), bio: text(form, "bio", 160), linkedin: text(form, "linkedin", 200), website: text(form, "website", 200), fullName: text(form, "fullName", 120) || undefined };
  if (!okUrl(patch.linkedin) || !okUrl(patch.website)) return { error: "Check the links: use a full web address." };
  const fields = { ...patch, linkedin: url(patch.linkedin), website: url(patch.website) };
  let result: Awaited<ReturnType<typeof saveProfile>>;
  try { result = await saveProfile(fields); }
  catch (error) {
    if (!(error instanceof IdentityError) || error.code !== "FreshAuthenticationRequired") throw error;
    // Non-name edits do not need re-proof and can exceed a cookie when UTF-8 encoded.
    await saveProfile({ ...fields, fullName: undefined });
    await savePendingAccountAction(principal, "/me/profile/edit", "save-profile", { fullName: patch.fullName! });
    redirect("/me/reauth");
  }
  if (result === "sign_in") redirect(accountLinks.login(accountLinks.editProfile()));
  // Stay on the form with a success state; the client refreshes so the header name/avatar update too.
  return { saved: true, savedAt: Date.now() };
}

/** U-37 "Change and re-verify later". */
export async function changeNameAction(_prev: SheetState, form: FormData): Promise<SheetState> {
  const principal = await guestPage("/me/profile/edit");
  await guardAction(form);
  const name = text(form, "fullName", 120);
  if (name.length < 2) return { error: "Enter your full name" };
  let result: Awaited<ReturnType<typeof changeVerifiedName>>;
  try { result = await changeVerifiedName(name); }
  catch (error) {
    if (!(error instanceof IdentityError) || error.code !== "FreshAuthenticationRequired") throw error;
    await savePendingAccountAction(principal, "/me/profile/edit", "change-name", { fullName: name });
    redirect("/me/reauth");
  }
  redirect(result === "sign_in" ? accountLinks.login(accountLinks.editProfile()) : accountLinks.editProfile());
}
