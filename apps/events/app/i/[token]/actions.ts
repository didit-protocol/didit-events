"use server";

import { guardAction } from "../../../src/auth/actions";

import { redirect } from "next/navigation";
import { accountLinks } from "../../../src/accounts/links";
import { text } from "../../../src/accounts/validate";
import { acceptInvite } from "./data";

/** "Accept invite": submit the completed request under the invitation policy (R-10). */
export async function acceptInviteAction(form: FormData): Promise<void> {
  await guardAction(form, { anonymous: true });
  const token = text(form, "token", 128);
  const result = await acceptInvite(token,JSON.parse(String(form.get("request")??"null")));
  if ("slug" in result) redirect(accountLinks.myEvent(result.slug));
  redirect(result.error === "sign_in" ? accountLinks.login(accountLinks.invite(token)) : accountLinks.invite(token));
}
