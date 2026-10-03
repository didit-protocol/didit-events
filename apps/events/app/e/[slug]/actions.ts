"use server";

import { guestPage } from "../../../src/auth/access";
import { guardAction } from "../../../src/auth/actions";

import { redirect } from "next/navigation";
import { links } from "../../../src/public/links";
import { readRequest, validateRequest } from "../../../src/public/request";
import type { RequestFormState } from "../../../src/public/types";
import { createRequest, getViewer, startVerification, subscribe } from "./data";
import { signOut } from "../../me/settings/data";


const slugOf = (form: FormData) => String(form.get("slug") ?? "").replace(/[^a-z0-9-]/g, "");

/** "Verify my identity" / "Continue verification" / "Try again": open the Didit hosted flow. */
export async function verifyAction(form: FormData): Promise<void> {
  await guardAction(form, { anonymous: true });
  const slug = slugOf(form);
  const result = await startVerification(slug, form);
  if ("state" in result) redirect(`${links.event(slug)}?preparing=${Date.now()}`);
  redirect("url" in result ? result.url : links.signIn(links.event(slug)));
}

/** "Subscribe" (calendar and event page). */
export async function subscribeAction(form: FormData): Promise<void> {
  await guardAction(form, { anonymous: true });
  const slug = slugOf(form);
  const back = slug ? links.event(slug) : links.calendar();
  if ((await subscribe()) === "sign_in") redirect(links.signIn(back));
  redirect(`${back}${back.includes("?") ? "&" : "?"}subscribed=1`);
}

/**
 * G-01 "Request to attend". A signed-in guest requests as their session's account: the email always comes from the
 * session, so a posted `email` field is ignored (it cannot be spoofed).
 */
export async function requestAction(_prev: RequestFormState, form: FormData): Promise<RequestFormState> {
  await guardAction(form, { anonymous: true });
  const viewer = await getViewer();
  const posted = readRequest(form);
  const input = viewer ? { ...posted, email: viewer.email } : posted;
  const errors = validateRequest(input);
  if (Object.keys(errors).length) return { status: "invalid", values: input, errors };
  if (!viewer) redirect(links.signIn(`/e/${slugOf(form)}/register`));
  // A legacy contact form cannot stand in for the versioned answers and disclosure.
  if (!form.has("request")) redirect(`/e/${slugOf(form)}/register`);
  const result = await createRequest(slugOf(form), input,JSON.parse(String(form.get("request"))));
  if (result === "already") return { status: "already", values: input, email: input.email };
  if (result === "not_found") return { status: "error", values: input, message: "We can’t find this event. Check the link you received." };
  return { status: "submitted", firstName: input.firstName };
}

/** G-01 "Not you? Sign out": end the guest session and come back to the event page signed out. */
export async function signOutAction(form: FormData): Promise<void> {
  const slug = slugOf(form);
  // Same guards as the settings sign-out: a signed-in guest, then session-bound CSRF.
  await guestPage(slug ? links.event(slug) : links.calendar());
  await guardAction(form);
  await signOut();
  redirect(slug ? links.event(slug) : links.calendar());
}
