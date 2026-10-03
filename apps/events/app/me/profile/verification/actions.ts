"use server";

import { freshAccountAction } from "../../../../src/auth/fresh-action";
import { guestPage } from "../../../../src/auth/access";

import { guardAction } from "../../../../src/auth/actions";

import { redirect } from "next/navigation";
import { accountLinks } from "../../../../src/accounts/links";
import { deleteVerificationData } from "./data";

/** U-38 "Delete verification data". */
export async function deleteVerificationAction(_form: FormData): Promise<void> {
  await guestPage("/me/profile/verification");
  await guardAction(_form);
  await freshAccountAction("/me/profile/verification", "delete-verification");
  const result = await deleteVerificationData();
  redirect(result === "sign_in" ? accountLinks.login(accountLinks.verification()) : accountLinks.profile());
}
