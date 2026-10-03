import { admissionService,eventService,inviteService,type StaffPrincipal } from "@didit-events/core";
import { applicantDrawer } from "@didit-events/core/admission/applicants";
import { can } from "@didit-events/core/access/capabilities";
import { ModelError } from "@didit-events/core/domain/model-error";
import { countApplicants,filterApplicants } from "../../../../../../../src/admin/applicants/query";
import type { ApplicantDetail,ApplicantList,ApplicantQuery,Decision,InviteSummary,RejectInput,RequirementSettings,ShareLinks } from "../../../../../../../src/admin/applicants/types";
import { requireEventAccess } from "../../../../../../../src/auth/access";
import { personView } from "../../../../../../../src/server/b4-person";
import { adminModel,applicantRow,applicantsEvent,requestsClosed } from "../../../../../../../src/server/b4-views";

export const UNDO_MS = 30_000;
/** Photos and the selfie need guests.photo (door operators see the profile without them; the routes refuse them too). */
const access = (actor: StaffPrincipal) => ({ photos: can(actor.scope?.role ?? actor.role, "guests.photo") });
export async function listApplicants(eventId: string, query: ApplicantQuery): Promise<ApplicantList | null> {
  const actor = await requireEventAccess(eventId, "guests.view");
  const model = await adminModel(eventId); if (!model) return null;
  const now = new Date(), rows = model.views.map(v => applicantRow(v, model.event, now, access(actor)));
  return { rows: filterApplicants(rows, query), counts: countApplicants(rows), event: applicantsEvent(model.event, model.approvedCount) };
}
export async function applicantsSummary(eventId: string) {
  await requireEventAccess(eventId, "event.view");
  const model = await adminModel(eventId); if (!model) return null;
  return { pending: model.views.filter(v => v.registration.admission === "pending").length, registration: applicantsEvent(model.event, model.approvedCount).registration };
}
export async function getApplicantDetail(eventId: string, id: string, query: ApplicantQuery) {
  const actor = await requireEventAccess(eventId, "guests.view");
  const model = await adminModel(eventId), view = model?.views.find(v => v.registration.id === id); if (!view) return null;
  const now = new Date(), row = applicantRow(view, model!.event, now, access(actor)), r = view.registration;
  const drawer = await applicantDrawer(actor, model!.event.id, id);
  const v2 = access(actor).photos ? drawer : { ...drawer, profile: { ...drawer.profile, photoUrl: null } };
  const detail: ApplicantDetail = { v2, person: personView(model!, view, v2, access(actor), now), timeZone:model!.event.timezone, id, name: row.name, email: row.email, initials: row.name.split(/\s+/).map(n => n[0]).join("").slice(0, 2), tab: row.tab,
    flag: v2.accountDeleted ? undefined : view.possibleDuplicate ? { text: "Possible duplicate", tone: "warn" } : view.eligible ? { text: "Meets all requirements", tone: "ok" } : undefined,
    sections: [
      { title: "Private note", rows: [], note: { value: r.staffNote ?? "", placeholder: "Add a private note" } }] };
  const list = filterApplicants(model!.views.map(v => applicantRow(v, model!.event, now, access(actor))), { ...query, tab: row.tab }), index = list.findIndex(r => r.id === id);
  return { detail, row, index: index + 1, total: list.length, prevId: list[index - 1]?.id, nextId: list[index + 1]?.id };
}
export async function existingEmails(eventId: string) {
  await requireEventAccess(eventId, "guests.invite"); return (await adminModel(eventId))?.views.map(v => v.account.email) ?? []; }
export type ResendSkip = { id: string; reason: "not_approved" | "verified" };
export type DecideOutcome = { done: string[]; failed: string[]; skipped?: ResendSkip[] } | { error: "capacity"; approved: number; capacity: number; done: string[]; remaining: string[]; failed: string[] } | { error: "forbidden" | "not_found" };
const target = { approve: "approved", promote: "approved", reconsider: "approved", reapprove: "approved", waitlist: "waitlisted", reject: "rejected", remove: "cancelled_by_host", revoke: "revoked" } as const;
export async function decide(eventId: string, ids: string[], decision: Decision, _actor: StaffPrincipal, opts: { overCapacity?: boolean; reject?: RejectInput; notify?: boolean; now?: number } = {}): Promise<DecideOutcome> {
  const actor = await requireEventAccess(eventId, "requests.decide"), model = await adminModel(eventId); if (!model) return { error: "not_found" };
  if (opts.overCapacity && actor.role === "staff") return { error: "forbidden" };
  const done: string[] = [], failed: string[] = [], skipped: ResendSkip[] = [];
  const unique = [...new Set(ids)];
  for (const [index, id] of unique.entries()) {
    const view = model.views.find(v => v.registration.id === id); if (!view) { failed.push(id); continue; }
    try {
      if (decision === "resend") {
        if (await admissionService.resend(actor, id)) done.push(id);
        else skipped.push({ id, reason: view.eligible ? "verified" : "not_approved" });
      } else {
        await admissionService.decide(actor, id, target[decision], { waitlistAtCapacity: false, overCapacity: opts.overCapacity, notify: opts.notify, rejectEmail: opts.reject?.email, block: opts.reject?.block, reason: opts.reject ? [opts.reject.reason, opts.reject.note].filter(Boolean).join(": ").slice(0, 500) : decision === "revoke" ? "Revoked by staff" : decision === "remove" ? "Removed by staff" : undefined });
        done.push(id);
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Capacity") {
        const current = (await adminModel(eventId))!;
        return { error: "capacity", done, remaining: unique.slice(index), failed, approved: current.approvedCount, capacity: current.event.capacity };
      }
      failed.push(id);
    }
  }
  return { done, failed, ...(skipped.length ? { skipped } : {}) };
}
export async function undoReject(eventId: string, id: string, _now?: number) {
  const actor = await requireEventAccess(eventId, "requests.decide");
  const model = await adminModel(eventId); if (!model?.views.some(v => v.registration.id === id)) return false;
  return admissionService.undoReject(actor, id);
}
export async function saveNote(eventId: string, id: string, note: string) {
  const actor = await requireEventAccess(eventId, "requests.decide");
  const model = await adminModel(eventId); if (!model?.views.some(v => v.registration.id === id)) return false;
  await admissionService.saveNote(actor, id, note); return true;
}
export async function invite(eventId: string, emails: string[], skipApproval: boolean, _actor: StaffPrincipal, opts: { overCapacity?: boolean; sendLink?: boolean; message?: string } = {}): Promise<InviteSummary | null> {
  const actor = await requireEventAccess(eventId, "guests.invite");
  const event = await eventService.get(eventId); if (!event) return null;
  return inviteService.batch(actor, event.id, emails, { ...opts, skipApproval });
}
export async function getShareLinks(eventId: string): Promise<ShareLinks | null> {
  await requireEventAccess(eventId, "guests.invite");
  const model = await adminModel(eventId); if (!model) return null;
  return { publicLink: applicantsEvent(model.event, model.approvedCount).requestLink, privateLink: "", privateHint: "Create a private link to share an invitation." };
}
export async function getRequirements(eventId: string): Promise<RequirementSettings | null> {
  await requireEventAccess(eventId, "event.view");
  const model = await adminModel(eventId); if (!model) return null;
  // AP-27 projection of the event's checks (the full editor consumes EventEditorView).
  const e = model.event;
  return { name: true, email: true, liveness: true, document: e.checks.required.includes("id_document"), age18: e.checks.age_min === 18, reuseMonths: reuseMonths(e.checks), editVersion: e.editVersion };
}
const MONTH_S = 30 * 86400;
type Checks = NonNullable<Awaited<ReturnType<typeof eventService.get>>>["checks"];
/** Freshness kept per extra check (`max_age`): 3 months when every stored freshness is at most that, else 6. */
function reuseMonths(checks: Checks): 3 | 6 { const ages = Object.values(checks.max_age).filter((n): n is number => typeof n === "number"); return ages.length && ages.every(n => n <= 3 * MONTH_S) ? 3 : 6; }
/**
 * AP-27 save through the versioned event update (checks only; door and budget stay event.limits). Age 18+ sets
 * `age_min`; the ID document stays off (the action refuses it). A changed reuse window becomes the freshness of every
 * extra check the event asks for; freshness for checks no longer asked is dropped (the schema requires it).
 */
export async function saveRequirements(eventId: string, next: RequirementSettings): Promise<{ ok: true } | { error: "not_found" | "conflict" | "closed" | "invalid" }> {
  const actor = await requireEventAccess(eventId, "event.edit");
  const e = await eventService.get(eventId); if (!e) return { error: "not_found" };
  const required = e.checks.required.filter(c => next.document || c !== "id_document");
  const age_min = next.age18 ? 18 : e.checks.age_min === 18 ? undefined : e.checks.age_min;
  const asked = { phone: required.includes("phone"), document: required.includes("id_document") || required.includes("name_from_id"), name_from_id: required.includes("name_from_id"), age: age_min !== undefined };
  const window = next.reuseMonths !== reuseMonths(e.checks) ? next.reuseMonths * MONTH_S : null;
  const max_age = Object.fromEntries((Object.keys(asked) as (keyof typeof asked)[]).filter(k => asked[k]).flatMap(k => { const v = window ?? e.checks.max_age[k]; return v === undefined ? [] : [[k, v]]; }));
  const checks = { version: 1 as const, required, ...(age_min !== undefined ? { age_min } : {}), max_age };
  try { await eventService.update(actor, e.id, { expectedVersion: next.editVersion, checks }); return { ok: true }; }
  catch (error) { if (error instanceof ModelError) return { error: error.code === "context_changed" ? "conflict" : error.code === "closed" ? "closed" : "invalid" }; throw error; }
}
export async function reopenRequests(eventId: string,expectedVersion?:number) {
  const actor = await requireEventAccess(eventId, "event.edit");
  const event = await eventService.get(eventId); if (!event) return false;
  // Clearing the closing date opens nothing once the event has started, ended or been cancelled: refuse instead of "reopened".
  if (requestsClosed(event) !== "date") return "closed" as const;
  try { await eventService.update(actor, event.id, { expectedVersion, form: { ...event.form, closes_at: null } }); return true; }
  catch (error) { if (error instanceof ModelError && error.code === "context_changed") return "conflict" as const; throw error; }
}
/** Kept as a type seam for callers; authorization always comes from B2. */
export type ApplicantActor = StaffPrincipal;

export async function getApplicantDrawer(eventId:string,registrationId:string){return applicantDrawer(await requireEventAccess(eventId,"guests.view"),eventId,registrationId);}
