"use server";

import { guestPage } from "../../../../src/auth/access";

import { guardAction } from "../../../../src/auth/actions";

import { redirect } from "next/navigation";
import { accountLinks } from "../../../../src/accounts/links";
import { slugOf } from "../../../../src/accounts/validate";
import { newVerificationLink, renewSelfie } from "./data";


/** U-42 "Take a new selfie". */
export async function renewAction(form: FormData): Promise<void> {
  const slug = slugOf(form);
  await guestPage(`/me/events/${encodeURIComponent(slug)}`);
  await guardAction(form);
  const result = await renewSelfie(slug, form);
  redirect("url" in result ? result.url : accountLinks.login(accountLinks.myEvent(slug)));
}

/** R-25 "Send me a new link". */
export async function newLinkAction(form: FormData): Promise<void> {
  const slug = slugOf(form);
  await guestPage(`/me/events/${encodeURIComponent(slug)}`);
  await guardAction(form);
  const { url } = await newVerificationLink(slug, form);
  redirect(url);
}
