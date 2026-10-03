"use server";

import { guardAction } from "../../../../../src/auth/actions";

import { redirect } from "next/navigation";
import { verificationUrlForLink } from "./data";

/** G-02 "Start verification": open the Didit hosted flow for this personal link. */
export async function startFromLinkAction(form: FormData): Promise<void> {
  await guardAction(form, { anonymous: true });
  const slug = String(form.get("slug") ?? "").replace(/[^a-z0-9-]/g, "");
  const token = String(form.get("token") ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  const result = await verificationUrlForLink(slug, token, form);
  if (result && "state" in result) redirect(`/e/${slug}/v/${token}?preparing=${Date.now()}`);
  // An expired or revoked link re-renders its G-02 state.
  redirect(result && "url" in result ? result.url : `/e/${slug}/v/${token}`);
}
