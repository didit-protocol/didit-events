import { guestRegistrationView } from "@didit-events/core/admission/requests";
import { read } from "@didit-events/core/admission/shared";
import { getVerificationRuntime } from "@didit-events/core";
import type { GuestAccount,GuestEventStatus } from "../../../../src/accounts/types";
import { guestPage } from "../../../../src/auth/access";
import type { PublicEvent } from "../../../../src/public/types";
import { guestAccount,guestStatus,publicEvent,publicModel } from "../../../../src/server/b4-views";
import { verificationBrowserMutation } from "../../../../src/verification/server";

export type MyEventPage = { kind: "ok"; event: PublicEvent; account: GuestAccount; status: GuestEventStatus } | { kind: "sign_in" } | { kind: "not_found" } | { kind: "not_registered" };
export async function getMyEvent(slug: string, opts: { preview?: string; requested?: boolean; cancelled?: string; withdrawn?: boolean } = {}): Promise<MyEventPage> {
  const principal = await guestPage(`/me/events/${encodeURIComponent(slug)}`);
  const model = await publicModel(slug); if (!model) return { kind: "not_found" };
  const view = model.views.find(v => v.account.id === principal.accountId); if (!view) return { kind: "not_registered" };
  const status = guestStatus(view, model.event, await guestRegistrationView(read(),view.registration,model.event,new Date()));
  if (status.kind === "pending" && opts.requested) status.justRequested = true;
  if (status.kind === "cancelled" && opts.cancelled !== undefined) status.justCancelled = true;
  return { kind: "ok", event: publicEvent(model.event, model.approvedCount, model.checkins.filter(c => !c.undoneAt).length), account: guestAccount(view), status };
}

/** U-42: the Didit renewal flow URL (LIVENESS only, same vendor_data), returned to this browser only (C16). */
export async function renewSelfie(slug: string, form?: FormData): Promise<{ url: string } | { signIn: true }> {
  await guestPage(`/me/events/${encodeURIComponent(slug)}`);
  const auth = await verificationBrowserMutation(form);
  if (!auth) return { signIn: true };
  const result=await getVerificationRuntime().startForRegistration(auth.principal,slug);
  if("url" in result)return result;
  return {url:`/me/events/${encodeURIComponent(slug)}?renewal=creating`};
}

/** R-25: a fresh verification link, emailed (M-03) and opened here. */
export async function newVerificationLink(slug: string, form?: FormData): Promise<{ url: string }> {
  await guestPage(`/me/events/${encodeURIComponent(slug)}`);
  const auth = await verificationBrowserMutation(form);
  if (!auth) return { url: `/login?next=${encodeURIComponent(`/me/events/${slug}`)}` };
  return getVerificationRuntime().requestLink(auth.principal, slug);
}
