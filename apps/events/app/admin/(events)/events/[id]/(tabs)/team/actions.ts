"use server";

import { revalidatePath } from "next/cache";
import { eventTeam } from "@didit-events/core/access/team";
import { AdmissionError } from "@didit-events/core/admission/shared";
import { requireEventAccess } from "../../../../../../../src/auth/access";
import { guardAction } from "../../../../../../../src/auth/actions";
import { adminLinks } from "../../../../../../../src/admin/links";
import type { TeamActionState } from "../../../../../../../src/admin/event-team/types";

const COPY: Record<string, string> = {
  InvalidEmail: "Enter a valid email, like name@company.com",
  InvalidRole: "Pick Host or Door operator.",
  AlreadyStaff: "This address is on the Didit team: it already reaches every event.",
  MemberNotFound: "This person is no longer on the team.",
  CannotRemoveSelf: "You can’t remove yourself. Ask another host or staff member.",
  ResendLimited: "Invitation sent 3 times in the last hour. Try again later.",
  Forbidden: "Your role on this event can’t manage its team.",
  EventNotFound: "This event no longer exists.",
};
const fail = (error: unknown, email?: string, role?: string): TeamActionState => {
  if (error instanceof AdmissionError && error.code in COPY) return { status: "error", message: COPY[error.code]!, email, role };
  throw error;
};

/** Event Team tab: add someone (or change their role) by email; the invitation email goes out. Capability team.manage. */
export async function addMemberAction(eventId: string, _prev: TeamActionState, form: FormData): Promise<TeamActionState> {
  const actor = await requireEventAccess(eventId, "team.manage");
  await guardAction(form);
  const email = String(form.get("email") ?? "").trim(), role = String(form.get("role") ?? "");
  if (!email) return { status: "error", message: "Add an email.", email, role };
  try {
    const result = await eventTeam.add(actor, eventId, email, role);
    revalidatePath(adminLinks.tab(eventId, "team"));
    return { status: "saved", message: result.created ? `Invitation sent to ${result.member.email}.` : result.roleChanged ? `${result.member.email} is now ${result.member.role === "host" ? "a host" : "a door operator"}. We emailed them.` : `${result.member.email} is already on the team.` };
  } catch (error) { return fail(error, email, role); }
}

/** Removes a member: their access and any door they started end now. Capability team.manage. */
export async function removeMemberAction(eventId: string, memberId: string, _prev: TeamActionState, form: FormData): Promise<TeamActionState> {
  const actor = await requireEventAccess(eventId, "team.manage");
  await guardAction(form);
  try { await eventTeam.remove(actor, eventId, memberId); }
  catch (error) { return fail(error); }
  revalidatePath(adminLinks.tab(eventId, "team"));
  return { status: "saved", message: "Removed from the team." };
}

/** Sends the invitation email again. Capability team.manage. */
export async function resendMemberAction(eventId: string, memberId: string, _prev: TeamActionState, form: FormData): Promise<TeamActionState> {
  const actor = await requireEventAccess(eventId, "team.manage");
  await guardAction(form);
  try { await eventTeam.resend(actor, eventId, memberId); }
  catch (error) { return fail(error); }
  return { status: "saved", message: "Invitation sent again." };
}
