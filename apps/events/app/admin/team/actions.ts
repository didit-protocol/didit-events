"use server";

import { requireStaffAccess } from "../../../src/auth/access";
import { revalidatePath } from "next/cache";
import { guardAction, isBodyTooLarge } from "../../../src/auth/actions";
import { identity } from "../../../src/auth/runtime";
import { adminLinks } from "../../../src/admin/links";
import { canDisable, canResendInvite, canRestore, INVITE_ERRORS, parseInvite, parseStaffEmail } from "../../../src/admin/team/policy";
import type { AccessResult, InviteState, ResendResult } from "../../../src/admin/team/types";
import { findMember } from "./data";


export async function inviteStaffAction(_prev: InviteState, form: FormData): Promise<InviteState> {
  const viewer = await requireStaffAccess("staff.manage", "/admin/team");
  try { await guardAction(form, { maxBytes: 2 * 1024 * 1024 }); }
  catch (error) {
    if (!isBodyTooLarge(error)) throw error;
    return { status: "invalid", email: String(form.get("email") ?? "").slice(0, 254), role: String(form.get("role") ?? "staff"), errors: { email: "Keep invitations under 2 MB." } };
  }
  const input = parseInvite(viewer, { email: form.get("email"), role: form.get("role") });
  if (!input.ok) return { status: "invalid", email: input.email, role: input.role, errors: input.errors };
  if (await findMember(input.email)) return { status: "invalid", email: input.email, role: input.role, errors: { email: INVITE_ERRORS.member(input.email) } };
  // The staff row and the T-01 invite email are queued in one transaction: "sent" only once both are committed.
  try { await identity.auth.inviteStaff(viewer, input.email, input.role); }
  catch { return { status: "failed", email: input.email, role: input.role, message: INVITE_ERRORS.failed(input.email) }; }
  revalidatePath(adminLinks.team());
  return { status: "sent", email: input.email };
}

const RESEND_ERRORS: Record<string, Exclude<ResendResult, { ok: true }>["error"]> = {
  InviteCooldown: "cooldown", AlreadySignedIn: "signed_in", StaffNotFound: "not_found", OwnerRequired: "forbidden", StaffForbidden: "forbidden",
};

/** A-19 "Resend invite" on a pending row: emails the invite again (at most once a minute per address). */
export async function resendInviteAction(email: string, csrf?: string): Promise<ResendResult> {
  const viewer = await requireStaffAccess("staff.manage", "/admin/team");
  const form = new FormData(); form.set("csrf", csrf ?? ""); form.set("email", email);
  await guardAction(form);
  const target = parseStaffEmail(email), member = target ? await findMember(target) : undefined;
  if (!member) return { error: "not_found" };
  if (!canResendInvite(viewer, member)) return { error: member.lastActiveAt === null ? "forbidden" : "signed_in" };
  try { await identity.team.resendStaffInvite(viewer, member.email); }
  catch (error) { return { error: RESEND_ERRORS[(error as { code?: string }).code ?? ""] ?? "failed" }; }
  return { ok: true };
}

export async function disableStaffAction(email: string, csrf?: string): Promise<AccessResult> {
  const viewer = await requireStaffAccess("staff.manage", "/admin/team");
  const form = new FormData(); form.set("csrf", csrf ?? ""); form.set("email", email);
  await guardAction(form);
  const target = parseStaffEmail(email), member = target ? await findMember(target) : undefined;
  if (!member) return { error: "not_found" };
  if (!canDisable(viewer, member)) return { error: "forbidden" };
  await identity.auth.disableStaff(viewer, member.email);
  revalidatePath(adminLinks.team());
  return { ok: true };
}

export async function restoreStaffAction(form: FormData): Promise<void> {
  const viewer = await requireStaffAccess("staff.manage", "/admin/team");
  await guardAction(form);
  const target = parseStaffEmail(form.get("email")), member = target ? await findMember(target) : undefined;
  if (!member || !canRestore(viewer, member)) return;
  await identity.team.restoreStaff(viewer, member.email);
  revalidatePath(adminLinks.team());
}
