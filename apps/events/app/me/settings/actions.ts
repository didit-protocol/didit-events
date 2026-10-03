"use server";

import { freshAccountAction } from "../../../src/auth/fresh-action";
import { guestPage } from "../../../src/auth/access";

import { cookies } from "next/headers";
import { COOKIE_NAMES } from "@didit-events/core/http/policy";
import { identity } from "../../../src/auth/runtime";
import { clearSession, guardAction } from "../../../src/auth/actions";

import { redirect } from "next/navigation";
import { accountLinks } from "../../../src/accounts/links";
import { disconnectGoogle, setMarketing } from "./data";

export async function signOutAction(_form: FormData): Promise<void> {
  await guardAction(_form);
  const session = await identity.sessions.resolve((await cookies()).get(COOKIE_NAMES.session)?.value ?? "");
  if (session) await identity.sessions.revoke(session.id);
  await clearSession();
  redirect(accountLinks.calendar());
}

export async function toggleMarketingAction(form: FormData): Promise<void> {
  await guestPage("/me/settings");
  await guardAction(form);
  await setMarketing(form.get("on") === "1");
  redirect(accountLinks.settings());
}

export async function disconnectGoogleAction(_form: FormData): Promise<void> {
  await guestPage("/me/settings");
  await guardAction(_form);
  await freshAccountAction("/me/settings", "disconnect-google");
  await disconnectGoogle();
  redirect(accountLinks.settings());
}

export async function signOutAllAction(form: FormData): Promise<void> {
  const principal = await guestPage("/me/settings");
  await guardAction(form);
  await freshAccountAction("/me/settings", "sign-out-all");
  await identity.sessions.revokeAll(principal);
  await clearSession();
  redirect(accountLinks.calendar());
}

/** 403 "Use a different account": a signed-in non-staff account signs out, then signs in again and returns to the admin. */
export async function switchAccountAction(form: FormData): Promise<void> {
  await guestPage("/admin/forbidden");
  await guardAction(form);
  const session = await identity.sessions.resolve((await cookies()).get(COOKIE_NAMES.session)?.value ?? "");
  if (session) await identity.sessions.revoke(session.id);
  await clearSession();
  redirect(accountLinks.login("/admin"));
}
