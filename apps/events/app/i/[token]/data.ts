import type { Account } from "@didit-events/core";
import { eventService,inviteService } from "@didit-events/core";
import { one,read } from "@didit-events/core/admission/shared";
import type { GuestAccount,InviteView } from "../../../src/accounts/types";
import { guestPrincipal } from "../../../src/server/b4-policy";
import { publicEvent } from "../../../src/server/b4-views";
export async function getInvite(token: string, _preview?: string): Promise<{ view: InviteView; guest: GuestAccount | null }> {
 const invite = await inviteService.get(token), event = invite && await eventService.get(invite.eventId);
 if (!invite || !event || event.status === "draft") return { view: { state: "not_found" }, guest: null };
 const principal = await guestPrincipal();
 // The guest's account and whether they already redeemed this invite are independent reads.
 const [account, redeemed] = principal ? await Promise.all([
  one<Account>(read(), "select * from accounts where id=$1 and deleting_at is null and deleted_at is null", [principal.accountId]),
  read().query("select 1 from invite_redemptions where invite_id=$1 and account_id=$2", [invite.id, principal.accountId]).then(rows => rows.length > 0),
 ]) : [null, false];
 const guest: GuestAccount | null = account ? { id: account.id, email: account.email, firstName: account.firstName ?? "", lastName: account.lastName ?? "", links: [], verification: { state: "none" }, marketingOptIn: false, eventsAttended: 0 } : null;
 const e = publicEvent(event), base = { event: e, invitedBy: invite.createdBy ?? "Didit", message: invite.message, skipApproval: invite.skipApproval };
 if (invite.revokedAt || invite.expiresAt <= new Date() || !redeemed && invite.uses >= invite.maxUses || event.status === "ended" || event.status === "cancelled") return { view: { state: "expired", event: e }, guest };
 if (!guest) return { view: { ...base, state: "signed_out", email: invite.email ?? "" }, guest };
 if (invite.email && invite.email !== guest.email) return { view: { state: "wrong_account", event: e, email: invite.email, signedInAs: guest.email }, guest };
 return { view: { ...base, state: "accepted" }, guest };
}
export async function acceptInvite(token: string,input?:unknown): Promise<{ slug: string } | { error: "sign_in" | "wrong_account" | "not_found" | "expired" }> {
 const principal = await guestPrincipal(); if (!principal) return { error: "sign_in" };
 const view=await getInvite(token);if(view.view.state==='wrong_account')return {error:'wrong_account'};
 try { const registration = await inviteService.redeem(principal, token,input), event = await eventService.get(registration.eventId); return { slug: event!.slug }; }
 catch (e) { const message = e instanceof Error ? e.message : ""; return { error: message === "InviteEmailMismatch" ? "wrong_account" : message === "InviteNotFound" ? "not_found" : "expired" }; }
}
