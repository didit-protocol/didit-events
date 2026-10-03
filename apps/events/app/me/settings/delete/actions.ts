"use server";

import { freshAccountAction } from "../../../../src/auth/fresh-action";
import { guestPage } from "../../../../src/auth/access";

import { guardAction } from "../../../../src/auth/actions";

import { redirect } from "next/navigation";
import type { SheetState } from "../../../../src/accounts/components/AccountSheets";
import { accountLinks } from "../../../../src/accounts/links";
import { text } from "../../../../src/accounts/validate";
import { deleteAccount } from "./data";

/** U-22 "Delete account": only with DELETE typed. */
export async function deleteAccountAction(_prev: SheetState, form: FormData): Promise<SheetState> {
  await guestPage("/me/settings/delete");
  await guardAction(form);
  if (text(form, "confirm", 10) !== "DELETE") return { error: "Type DELETE to confirm." };
  await freshAccountAction("/me/settings/delete", "delete-account");
  const result = await deleteAccount();
  redirect(result === "sign_in" ? accountLinks.login(accountLinks.deleteAccount()) : `${accountLinks.calendar()}?deleted=1`);
}
