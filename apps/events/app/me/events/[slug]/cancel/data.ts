import { Requests } from "@didit-events/core/admission/requests";
import { CANCEL_REASONS,WITHDRAW_REASONS,type CancelMode,type GuestAccount } from "../../../../../src/accounts/types";
import { guestPage } from "../../../../../src/auth/access";
import type { PublicEvent } from "../../../../../src/public/types";
import { guestAccount,publicEvent,publicModel } from "../../../../../src/server/b4-views";
export type CancelPage = { kind: "ok"; event: PublicEvent; account: GuestAccount; mode: CancelMode | { mode: "confirm" } } | { kind: "sign_in" } | { kind: "not_found" } | { kind: "nothing" };
export async function getCancelPage(slug: string, now: Date, intent: "cancel" | "withdraw", _preview?: string): Promise<CancelPage> {
  const principal = await guestPage(`/me/events/${encodeURIComponent(slug)}/${intent}`);
  const model = await publicModel(slug); if (!model) return { kind: "not_found" };
  const view = model.views.find(v => v.account.id === principal.accountId); if (!view) return { kind: "nothing" };
  const event = publicEvent(model.event, model.approvedCount), account = guestAccount(view), admission = view.registration.admission;
  if (now >= model.event.startsAt) return { kind: "ok", event, account, mode: { mode: "started" } };
  if (admission === "pending") return { kind: "ok", event, account, mode: { mode: "withdraw" } };
  if (intent === "withdraw") return { kind: "nothing" };
  if (admission === "waitlisted") return { kind: "ok", event, account, mode: { mode: "leave_waitlist" } };
  if (admission !== "approved") return { kind: "nothing" };
  // Whole hours for the copy ("starts in 9 hours"); `late` keeps the exact comparison.
  const hours = (model.event.startsAt.getTime() - now.getTime()) / 3600000;
  return { kind: "ok", event, account, mode: { mode: "cancel", hoursToStart: Math.max(0, Math.round(hours)), late: hours < 24 } };
}
export type CancelResult = "cancelled" | "withdrawn" | "left_waitlist" | "started" | "not_found" | "sign_in" | "reason_required" | "bad_reason";
export async function cancelRegistration(slug: string, reason: string, note: string, now = new Date()): Promise<CancelResult> {
 const page = await getCancelPage(slug, now, "cancel");
 if (page.kind === "sign_in") return "sign_in"; if (page.kind !== "ok") return "not_found";
 const mode = page.mode.mode; if (mode === "started") return "started";
 if (reason && !(mode === "withdraw" ? WITHDRAW_REASONS : [...CANCEL_REASONS, "Not given"] as readonly string[]).includes(reason as never)) return "bad_reason";
 const principal = (await guestPage(`/me/events/${encodeURIComponent(slug)}/cancel`)), model = (await publicModel(slug))!, view = model.views.find(v => v.account.id === principal.accountId)!;
 try { await new Requests().withdrawOrCancel(principal,view.registration.id,{expectedAdmission:view.registration.admission,reason:[reason,note].filter(Boolean).join(": ").slice(0,500)||undefined}); }
 catch (e) { if (e instanceof Error && e.message === "CancellationClosed") return "started"; throw e; }
 return mode === "withdraw" ? "withdrawn" : mode === "leave_waitlist" ? "left_waitlist" : "cancelled";
}
