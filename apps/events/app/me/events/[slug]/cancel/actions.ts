"use server";

import { guestPage } from "../../../../../src/auth/access";

import { guardAction } from "../../../../../src/auth/actions";

import { redirect } from "next/navigation";
import { accountLinks } from "../../../../../src/accounts/links";
import type { CancelFormState } from "../../../../../src/accounts/types";
import { slugOf, text } from "../../../../../src/accounts/validate";
import { cancelRegistration } from "./data";

/**
 * U-26…U-28 cancel (reason required), U-30 withdraw, leave the waitlist, R-26 confirm. The mode is derived from the
 * stored registration in `cancelRegistration`; the form's hidden `mode` is display-only and never trusted.
 */
export async function cancelAction(_prev: CancelFormState, form: FormData): Promise<CancelFormState> {
  const slug = slugOf(form);
  await guestPage(`/me/events/${encodeURIComponent(slug)}/cancel`);
  await guardAction(form);
  const reason = text(form, "reason", 60);
  const note = text(form, "note", 280);
  const result = await cancelRegistration(slug, reason, note);
  switch (result) {
    case "sign_in":
      redirect(accountLinks.login(accountLinks.cancel(slug)));
    case "reason_required":
      return { error: "Choose a reason so the hosts can plan.", note };
    case "bad_reason":
      return { error: "Choose one of the reasons.", note };
    case "not_found":
      return { error: "We can’t find this registration any more.", reason, note };
    case "started":
      return { error: "The event has started, so this can’t be cancelled here any more.", reason, note };
    case "withdrawn":
      redirect(`${accountLinks.myEvent(slug)}?withdrawn=1`);
    case "left_waitlist":
      redirect(accountLinks.myEvents());
    case "cancelled":
      redirect(`${accountLinks.myEvent(slug)}?cancelled=${encodeURIComponent(reason === "Other" && note ? "Other" : reason)}`);
  }
}
