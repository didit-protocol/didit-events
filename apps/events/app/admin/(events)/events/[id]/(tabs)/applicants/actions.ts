"use server";

import { requireEventAccess } from "../../../../../../../src/auth/access";

import { appOrigin } from "../../../../../../../src/server/b4-policy";

import { guardAction, isBodyTooLarge } from "../../../../../../../src/auth/actions";

import { revalidatePath } from "next/cache";
import { adminLinks } from "../../../../../../../src/admin/links";
import { splitEmails } from "../../../../../../../src/admin/applicants/query";
import { REJECT_REASONS, type ApplicantActionResult, type Decision, type InviteSummary, type RejectInput, type RejectReason, type RequirementSettings } from "../../../../../../../src/admin/applicants/types";
import { decide, invite, type ResendSkip, reopenRequests, saveNote, saveRequirements, undoReject } from "./data";

// Every mutation rechecks staff access and applies C14 before domain writes.
// Every action re-reads the staff session (plan §4), bounds its input and decides from the stored state only: the
// client sends ids and an intent, never a status, a count or a capacity.

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DECISIONS = new Set<Decision>(["approve", "waitlist", "reject", "promote", "remove", "revoke", "reconsider", "reapprove", "resend"]);
const NOTE_MAX = 500;
const MESSAGE_MAX = 500;
const MAX_IDS = 200;
const MAX_INVITES = 100;

// The applicants list, and the event layout so the header counts (Requests, Approved) move with the decision.
const refresh = (eventId: string) => {
  revalidatePath(adminLinks.tab(eventId, "applicants"));
  revalidatePath(adminLinks.event(eventId), "layout");
};

/** Well-formed, de-duplicated ids; a batch over MAX_IDS is refused whole (never half-applied). */
const cleanIds = (ids: unknown): string[] => (Array.isArray(ids) && ids.length <= MAX_IDS ? [...new Set(ids.filter((x): x is string => typeof x === "string" && ID_RE.test(x)))] : []);

function cleanReject(input: unknown): RejectInput | null {
  if (!input || typeof input !== "object") return null;
  const { reason, note, email, block } = input as Record<string, unknown>;
  if (!REJECT_REASONS.includes(reason as RejectReason)) return null;
  return { reason: reason as RejectReason, note: String(note ?? "").trim().slice(0, NOTE_MAX), email: email === true, block: block === true };
}

/**
 * Approve / waitlist / reject / promote / remove / revoke / reconsider / re-approve / resend, for one id or a batch.
 * `capacity` means approving would pass capacity: the client shows AP-06 and may retry with `overCapacity`.
 */
export async function decideAction(
  eventId: string,
  decision: Decision,
  ids: unknown,
  // `notify: false` = approve silently (AP-07): no M-03/M-06 is queued and the row is not marked link-sent.
  options: { overCapacity?: boolean; reject?: unknown; notify?: boolean } = {},csrf?: string
): Promise<ApplicantActionResult<{ done: string[]; failed: string[]; skipped?: ResendSkip[] }> | { error: "capacity"; approved: number; capacity: number; done: string[]; remaining: string[]; failed: string[] }> {
  const actor = await requireEventAccess(eventId, "requests.decide");
  const form = new FormData(); form.set("csrf", csrf ?? ""); form.set("payload", JSON.stringify([eventId, decision, ids, options]));
  await guardAction(form);
  const opts = options && typeof options === "object" ? options : {};
  const list = cleanIds(ids);
  if (!list.length || !DECISIONS.has(decision)) return { error: "invalid" };
  const reject = decision === "reject" ? cleanReject(opts.reject) : undefined;
  if (decision === "reject" && !reject) return { error: "invalid", message: "Pick a reason." };
  const result = await decide(String(eventId), list, decision, actor, { overCapacity: opts.overCapacity === true, reject: reject ?? undefined, notify: opts.notify !== false });
  if ("error" in result) {
    if (result.error === "capacity") { if (result.done.length) refresh(eventId); return result; }
    return { error: result.error, message: result.error === "forbidden" ? "Only owners and admins can approve over capacity." : undefined };
  }
  refresh(eventId);
  return { ok: true, ...result };
}

/** AP-11 Undo (within the stored 30 s window, before M-10 goes out). */
export async function undoRejectAction(eventId: string, id: string, csrf?: string): Promise<ApplicantActionResult> {
  await requireEventAccess(eventId, "requests.decide");
  const form = new FormData(); form.set("csrf", csrf ?? ""); form.set("payload", JSON.stringify([eventId, id]));
  await guardAction(form);
  if (!ID_RE.test(String(id))) return { error: "invalid" };
  if (!(await undoReject(String(eventId), id))) return { error: "conflict", message: "Too late to undo: the email has gone out." };
  refresh(eventId);
  return { ok: true };
}

/** The drawer's private staff note (saved on blur). */
export async function saveNoteAction(eventId: string, id: string, note: string, csrf?: string): Promise<ApplicantActionResult> {
  await requireEventAccess(eventId, "requests.decide");
  const form = new FormData(); form.set("csrf", csrf ?? ""); form.set("payload", JSON.stringify([eventId, id, note]));
  await guardAction(form);
  if (!ID_RE.test(String(id))) return { error: "invalid" };
  if (!(await saveNote(String(eventId), id, String(note ?? "").trim().slice(0, NOTE_MAX)))) return { error: "not_found" };
  return { ok: true };
}

/** AP-16…AP-19: one batch of direct invites; the server re-validates every address. */
export async function inviteAction(eventId: string, emails: unknown, message: unknown, skipApproval: unknown, sendLink?: unknown, csrf?: string): Promise<ApplicantActionResult<{ summary: InviteSummary }>> {
  const actor = await requireEventAccess(eventId, "guests.invite");
  const form = new FormData(); form.set("csrf", csrf ?? ""); form.set("payload", JSON.stringify([eventId, emails, message, skipApproval, sendLink]));
  try { await guardAction(form, { maxBytes: 2 * 1024 * 1024 }); }
  catch (error) { if (isBodyTooLarge(error)) return { error: "invalid", message: "Keep invitations under 2 MB." }; throw error; }
  const list = Array.isArray(emails) ? splitEmails(emails.filter((e): e is string => typeof e === "string").join(",")) : [];
  if (!list.length || list.length > MAX_INVITES) return { error: "invalid" };
  // B4: the message is stored on the invite (M-19). `sendLink: false` = they accept the invite first, then verify.
  const inviteMessage = String(message ?? "");
  if (inviteMessage.length > MESSAGE_MAX) return { error: "invalid" };
  // Skip approval grants seats through the same capacity gate as a decision; a full event waitlists them (AP-25).
  const summary = await invite(String(eventId), list, skipApproval === true, actor, { sendLink: sendLink !== false, message: inviteMessage });
  if (!summary) return { error: "not_found" };
  refresh(eventId);
  return { ok: true, summary };
}

/** AP-27 Save requirements. The selfie stays required (face check-in). */
export async function saveRequirementsAction(eventId: string, input: unknown, csrf?: string): Promise<ApplicantActionResult> {
  await requireEventAccess(eventId, "event.edit");
  const form = new FormData(); form.set("csrf", csrf ?? ""); form.set("payload", JSON.stringify([eventId, input]));
  await guardAction(form);
  if (!input || typeof input !== "object") return { error: "invalid" };
  const r = input as Record<string, unknown>;
  const months = Number(r.reuseMonths);
  if (![3, 6].includes(months)) return { error: "invalid" };
  if (r.document === true) return { error: "invalid", message: "Document verification is not available for this workflow." };
  if (!Number.isInteger(r.editVersion)) return { error: "invalid" };
  const next: RequirementSettings = { name: r.name === true, email: r.email === true, liveness: true, document: r.document === true, age18: r.age18 === true, reuseMonths: months as RequirementSettings["reuseMonths"], editVersion: r.editVersion as number };
  const saved = await saveRequirements(String(eventId), next);
  if ("error" in saved) return saved.error === "conflict" ? { error: "conflict", message: "This event changed since you opened it. Reload to see the latest requirements." } : { error: saved.error === "not_found" ? "not_found" : "invalid" };
  revalidatePath(adminLinks.tab(eventId, "settings"));
  refresh(eventId);
  return { ok: true };
}

/** AP-25 "Reopen requests". */
export async function reopenRequestsAction(eventId: string, csrf?: string,expectedVersion?:number): Promise<ApplicantActionResult> {
  await requireEventAccess(eventId, "event.edit");
  const form = new FormData(); form.set("csrf", csrf ?? ""); form.set("payload", JSON.stringify([eventId]));
  await guardAction(form);
  const reopened = await reopenRequests(String(eventId),expectedVersion);
  if (reopened === "conflict") return { error: "conflict", message: "This event changed since you opened it. Refresh and try again." };
  if (reopened === "closed") return { error: "invalid", message: "Requests can only be reopened before the event starts." };
  if (!reopened) return { error: "not_found" };
  refresh(eventId);
  return { ok: true };
}

export async function shareLinkAction(eventId: string, csrf?: string): Promise<ApplicantActionResult<{ url: string }>> {
  const actor = await requireEventAccess(eventId, "guests.invite");
  const form = new FormData(); form.set("csrf", csrf ?? ""); form.set("eventId", eventId);
  await guardAction(form);
  const { eventService, inviteService } = await import("@didit-events/core");
  const event = await eventService.get(eventId); if (!event) return { error: "not_found" };
  const result = await inviteService.create(actor, { eventId: event.id, maxUses: 20, expiresAt: event.endsAt, skipApproval: true });
  return { ok: true, url: appOrigin() + "/i/" + result.token };
}
