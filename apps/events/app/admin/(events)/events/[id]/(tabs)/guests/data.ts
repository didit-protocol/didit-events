import { admissionService,doorService,evidenceService,inviteService,type StaffPrincipal } from "@didit-events/core";
import { PolicyError } from "@didit-events/core/http/policy";
import { applicantDrawer } from "@didit-events/core/admission/applicants";
import { countGuests,filterGuests,PAGE_SIZE,paginate,sortGuests } from "../../../../../../../src/admin/guests/query";
import type { GuestDetail,GuestQuery,NewGuest } from "../../../../../../../src/admin/guests/types";
import { requireEventAccess } from "../../../../../../../src/auth/access";
import { ModelError } from "@didit-events/core/domain/model-error";
import { can } from "@didit-events/core/access/capabilities";
import { guestDetail,guestRow } from "../../../../../../../src/server/b4-guests";
import { adminModel } from "../../../../../../../src/server/b4-views";
/** Photos and the selfie need guests.photo (door operators see the profile without them; the routes refuse them too). */
const access = (actor: StaffPrincipal) => ({ photos: can(actor.scope?.role ?? actor.role, "guests.photo") });
export async function allGuests(eventId: string) {
  const actor = await requireEventAccess(eventId, "guests.view"); const m = await adminModel(eventId), now = new Date(); return m?.views.filter(v => ["approved", "revoked", "cancelled_by_host"].includes(v.registration.admission)).map(v => guestRow(v, m, now, access(actor))) ?? []; }
export async function listGuests(eventId: string, query: GuestQuery) {
  const actor = await requireEventAccess(eventId, "guests.view");
 const model = await adminModel(eventId); if (!model) return null;
 const now = new Date(), rows = model.views.filter(v => ["approved", "revoked", "cancelled_by_host"].includes(v.registration.admission)).map(v => guestRow(v, model, now, access(actor))), filtered = filterGuests(rows, query);
 const sorted = query.sort ? sortGuests(filtered, query.sort) : filtered, result = paginate(sorted, query.page, PAGE_SIZE);
 return { page: { rows: result.rows, total: filtered.length, page: result.page, pageSize: PAGE_SIZE }, counts: countGuests(rows) };
}
export async function existingEmails(eventId: string) {
  await requireEventAccess(eventId, "guests.invite"); return (await adminModel(eventId))?.views.map(v => v.account.email) ?? []; }
export async function getGuestDetail(eventId: string, id: string): Promise<GuestDetail | null> {
  const actor = await requireEventAccess(eventId, "guests.view");
 const m = await adminModel(eventId), v = m?.views.find(v => v.registration.id === id); if (!m || !v) return null;
 // The drawer DTO carries the answers with their labels, the accepted checks and the full history; it is gone once the
 // retained request data expires (the account facts still show).
 const full = await applicantDrawer(actor, m.event.id, id).catch((e: unknown) => { if (e instanceof ModelError && e.code === "retained_data_expired") return null; throw e; });
 const drawer = full && !access(actor).photos ? { ...full, profile: { ...full.profile, photoUrl: null } } : full;
 return guestDetail(m, v, drawer, access(actor));
}
export async function addGuests(eventId: string, guests: NewGuest[], sendLink: boolean) {
  const actor = await requireEventAccess(eventId, "guests.invite"), m = await adminModel(eventId); if (!m) return { added: 0, waitlisted: 0, duplicates: guests.map(g => g.email) };
 const known = new Set([...m.views.map(v => v.account.email),...m.activeInvites.map(i=>i.email)]), duplicates: string[] = []; let added = 0, waitlisted = 0;
 for (const g of guests) {
  const email = g.email.trim().toLowerCase(); if (known.has(email)) { duplicates.push(email); continue; } known.add(email);
  try {
   const result = await inviteService.batch(actor, m.event.id, [email], { skipApproval: true, sendLink });
   if (result.invited || result.waitlisted) {
    if (result.waitlisted) waitlisted++; else added++;
   } else duplicates.push(email);
  } catch (error) {
   // The whole batch stops on an event-level refusal (ended, cancelled, …); the action turns it into copy, never a 500.
   const problem = addGuestProblem(error);
   if (problem) return { added, waitlisted, duplicates, problem };
   throw error;
  }
 }
 return { added, waitlisted, duplicates };
}
export type AddGuestProblem = "event_ended" | "event_cancelled" | "not_published" | "forbidden" | "invalid_email" | "unavailable";
/** Every domain refusal while adding guests, as a code the action words for staff. Unknown failures stay errors. */
export function addGuestProblem(error: unknown): AddGuestProblem | null {
  const code = error instanceof Error ? error.message : "";
  if (code === "EventEnded" || code === "RegistrationClosed") return "event_ended";
  if (code === "EventCancelled") return "event_cancelled";
  if (code === "EventNotPublished") return "not_published";
  if (code === "Forbidden") return "forbidden";
  if (code === "InvalidEmail") return "invalid_email";
  if (["InvalidInvite", "EventNotFound", "MessageTooLong", "BatchTooLarge", "InvalidTransition", "AccountUnavailable", "Capacity"].includes(code)) return "unavailable";
  return null;
}
export const ADD_GUEST_COPY: Record<AddGuestProblem, string> = {
  event_ended: "This event has ended, so guests can’t be added any more.",
  event_cancelled: "This event was cancelled, so guests can’t be added.",
  not_published: "Publish the event before adding guests.",
  forbidden: "Your role on this event can’t add guests.",
  invalid_email: "Enter a valid email, like name@company.com",
  unavailable: "Couldn’t add this guest. Check the email and try again.",
};
export type StatusChange = { changed: string[]; skipped: { id: string; reason: string }[] };
export type CapacityChange = StatusChange & { error: "capacity"; remaining: string[]; canOverride: boolean };
export async function changeStatus(eventId: string, ids: string[], op: "approve" | "send" | "revoke", options: { overCapacity?: boolean } = {}): Promise<StatusChange | CapacityChange> {
  const actor = await requireEventAccess(eventId, "requests.decide"), m = await adminModel(eventId), result: StatusChange = { changed: [], skipped: [] };
 const unique = [...new Set(ids)];
 for (const [index, id] of unique.entries()) {
  if (!m?.views.some(v => v.registration.id === id)) { result.skipped.push({ id, reason: "Guest not found" }); continue; }
  try { if (op === "send") { if (!await admissionService.resend(actor, id)) { result.skipped.push({ id, reason: "No verification link needed" }); continue; } }
   else await admissionService.transition(actor, id, op === "approve" ? "approved" : "revoked", op === "revoke" ? "Revoked by staff" : undefined, options);
   result.changed.push(id);
  } catch (error) {
   if (error instanceof Error && error.message === "Capacity") return { ...result, error: "capacity", remaining: unique.slice(index), canOverride: actor.role === "owner" || actor.role === "admin" };
   result.skipped.push({ id, reason: error instanceof Error && error.message === "Forbidden" ? "Only owners and admins can approve over capacity." : "This transition is unavailable" });
  }
 }
 return result;
}
export type CheckInResult = { ok: true; detail: GuestDetail } | { ok: false; error: "not_found" | "not_eligible"; message?: string };
/** Manual check-in refusals, in staff words (the door shows the same rules). */
export const CHECKIN_COPY: Record<string, string> = {
  EventNotLive: "Check-in opens when the event starts. To try the door before that, use Test mode on the Door tab.",
  EventEnded: "This event has ended, so nobody can be checked in.",
  EventCancelled: "This event was cancelled, so nobody can be checked in.",
  NotApproved: "Only approved guests can be checked in.",
  VerificationRequired: "This guest hasn’t finished the checks this event requires.",
  ManualCheckinUnavailable: "This guest can’t be checked in.",
  Forbidden: "Your role on this event can’t check guests in.",
};
export async function manualCheckIn(eventId: string, id: string, _by: string, note: string, _now?: Date): Promise<CheckInResult> {
  const actor = await requireEventAccess(eventId, "checkin.manual");
 const m = await adminModel(eventId); if (!m?.views.some(v => v.registration.id === id)) return { ok: false, error: "not_found" };
 try { await doorService.manualCheckin(actor, id, note || "Manual admission by staff"); }
 catch (error) { if (error instanceof PolicyError && error.message in CHECKIN_COPY) return { ok: false, error: "not_eligible", message: CHECKIN_COPY[error.message] }; throw error; }
 return { ok: true, detail: (await getGuestDetail(eventId, id))! };
}
export async function undoCheckIn(eventId: string, id: string, _by: string, _now?: Date) {
  const actor = await requireEventAccess(eventId, "checkin.manual");
 const v = (await adminModel(eventId))?.views.find(v => v.registration.id === id); if (!v?.checkedIn) return null;
 await doorService.undoCheckin(actor, v.checkedIn.id, "Check-in undone by staff"); return getGuestDetail(eventId, id);
}
export async function acceptVerifiedEmail(eventId: string, id: string, reviewed?: { session: string; email: string }): Promise<boolean> {
  const actor = await requireEventAccess(eventId, "guests.verification");
  const view = (await adminModel(eventId))?.views.find(v => v.registration.id === id);
  if (!view?.verification?.verifiedEmail || view.verification.emailMatches !== false) return false;
  if (!reviewed || view.verification.diditSessionId !== reviewed.session || view.verification.verifiedEmail !== reviewed.email) return false;
  return evidenceService.acceptVerifiedEmail(actor, id, view.verification.id, view.verification.verifiedEmail);
}
export async function requestReverification(eventId: string, id: string) {
  const actor = await requireEventAccess(eventId, "requests.decide");
 const v = (await adminModel(eventId))?.views.find(v => v.registration.id === id); if (!v) return false;
 return admissionService.resend(actor,id);
}

export async function getApplicantDrawer(eventId:string,registrationId:string){return applicantDrawer(await requireEventAccess(eventId,"guests.view"),eventId,registrationId);}
