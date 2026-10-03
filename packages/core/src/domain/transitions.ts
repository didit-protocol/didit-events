export type Admission = "pending" | "approved" | "waitlisted" | "rejected" | "cancelled_by_guest" | "cancelled_by_host" | "revoked";
export type TransitionActor = "guest" | "staff" | "admin" | "owner" | "system";
const staff: TransitionActor[] = ["staff", "admin", "owner"];
export const ADMISSION_TRANSITIONS: Readonly<Partial<Record<Admission, Partial<Record<Admission, readonly TransitionActor[]>>>>> = {
  pending: { approved: [...staff, "system"], waitlisted: [...staff, "system"], rejected: staff, cancelled_by_guest: ["guest", "system"], cancelled_by_host: [...staff, "system"] },
  approved: { cancelled_by_guest: ["guest", "system"], cancelled_by_host: [...staff, "system"], revoked: staff },
  waitlisted: { approved: [...staff, "system"], rejected: staff, cancelled_by_guest: ["guest", "system"], cancelled_by_host: [...staff, "system"] },
  rejected: { approved: staff, pending: ["guest"], cancelled_by_guest: ["system"] },
  cancelled_by_guest: { pending: ["guest"], approved: staff },
  cancelled_by_host: { approved: staff, cancelled_by_guest: ["system"] },
  revoked: { approved: staff, cancelled_by_guest: ["system"] },
};
/** Actor/state gate only. B4 enforces reason, one reapplication, cutoff, capacity and account deletion in its transaction. */
export function canTransition(from: Admission, to: Admission, actor: TransitionActor): boolean { return ADMISSION_TRANSITIONS[from]?.[to]?.includes(actor) ?? false; }
export type GuestState = "signed_out" | "signed_in" | "profile_incomplete" | "profile_verified" | "deleted";
export const GUEST_TRANSITIONS: Readonly<Partial<Record<GuestState, Partial<Record<GuestState, readonly TransitionActor[]>>>>> = {
  signed_out: { signed_in: ["guest"] }, signed_in: { signed_out: ["guest", "system"], profile_incomplete: ["system"], profile_verified: ["system"], deleted: ["guest"] },
  profile_incomplete: { signed_in: ["guest"], signed_out: ["guest", "system"], deleted: ["guest"] }, profile_verified: { signed_in: ["system"], signed_out: ["guest", "system"], deleted: ["guest"] },
};
export const canTransitionGuest = (from: GuestState, to: GuestState, actor: TransitionActor): boolean => GUEST_TRANSITIONS[from]?.[to]?.includes(actor) ?? false;
