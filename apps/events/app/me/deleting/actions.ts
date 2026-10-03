"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAMES } from "@didit-events/core/http/policy";
import { IdentityError } from "@didit-events/core/identity";
import { guardAction } from "../../../src/auth/actions";
import { identity } from "../../../src/auth/runtime";
import { accountLinks, safeNext } from "../../../src/accounts/links";
import type { KeepState } from "../../../src/accounts/components/KeepAccount";

/**
 * "Keep my account" (v5): undoes a deletion still in its grace period, from the browser that asked for it. With
 * `next` it returns there (the banner, /me/deleting); without it (the join modal) the caller refreshes in place.
 */
export async function keepAccountAction(_prev: KeepState, form: FormData): Promise<KeepState> {
  await guardAction(form);
  const cookie = (await cookies()).get(COOKIE_NAMES.session)?.value ?? "";
  try {
    await identity.profile.keepAccount(cookie);
  } catch (error) {
    if (error instanceof IdentityError && error.code === "DeletionNotCancellable") return { error: "This deletion can no longer be undone. Sign in with your email to start a new account." };
    throw error;
  }
  const next = form.get("next");
  if (typeof next === "string" && next) redirect(safeNext(next, accountLinks.myEvents()));
  return { kept: true };
}
