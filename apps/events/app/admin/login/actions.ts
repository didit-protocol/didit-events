"use server";

import { guardAction } from "../../../src/auth/actions";
import { redirect } from "next/navigation";
import { safeNext } from "../../../src/admin/login/signin";
import { accountLinks } from "../../../src/accounts/links";

/** Compatibility actions: all old staff sign-in forms enter the account login. */
export async function signInAction(form: FormData): Promise<void> {
  await guardAction(form, { anonymous: true });
  redirect(accountLinks.login(safeNext(form.get("next"))));
}
export async function staffEmailSignInAction(_prev: unknown, form: FormData): Promise<never> {
  await guardAction(form, { anonymous: true });
  redirect(accountLinks.login(safeNext(form.get("next"))));
}
export async function switchAccountAction(form: FormData): Promise<void> {
  await guardAction(form, { anonymous: true });
  redirect(accountLinks.login(safeNext(form.get("next"))));
}
