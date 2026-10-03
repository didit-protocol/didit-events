/**
 * Withdraw / cancel from every active status (event model v2, "Withdraw and cancel"): pending and waitlisted
 * requests expose **Withdraw request**; an approved place, including its renewal/review/expired sub-states,
 * exposes **Cancel my place**. Terminal states (cancelled, withdrawn, declined by the host, checked in, ended)
 * show their outcome instead of an impossible action.
 *
 * Until lane A serves `GuestRegistrationView.withdrawal`, the UI derives it from the display status; the route
 * (/me/events/[slug]/withdraw or /cancel) re-checks admission and the start cutoff on the server either way.
 */
import type { GuestRegistrationView } from "@didit-events/core/contracts/event-model";
import { accountLinks } from "./links";
import type { GuestEventStatusKind, MyEventBadge } from "./types";

export type WithdrawalKind = "withdraw" | "cancel";

export interface WithdrawalAction {
  kind: WithdrawalKind;
  label: "Withdraw request" | "Cancel my place";
  href: string;
}

const PENDING: ReadonlySet<GuestEventStatusKind> = new Set(["pending"]);
const WAITLISTED: ReadonlySet<GuestEventStatusKind> = new Set(["waitlisted"]);
/** An approved place: going, or still completing/renewing/being reviewed. */
const APPROVED: ReadonlySet<GuestEventStatusKind> = new Set([
  "approved", "going", "requirements_unmet", "verifying", "in_review", "declined", "link_expired", "selfie_expired", "email_mismatch",
]);

const action = (kind: WithdrawalKind, href: string): WithdrawalAction => ({ kind, label: kind === "withdraw" ? "Withdraw request" : "Cancel my place", href });

/** The action for a status, or null. `started` (doors open) hides it: the server refuses it then anyway. */
export function withdrawalFor(kind: GuestEventStatusKind, slug: string, started = false): WithdrawalAction | null {
  if (started) return null;
  // The withdraw route serves pending requests; waitlisted ones are withdrawn through the cancel route.
  if (PENDING.has(kind)) return action("withdraw", accountLinks.withdraw(slug));
  if (WAITLISTED.has(kind)) return action("withdraw", accountLinks.leaveWaitlist(slug));
  if (APPROVED.has(kind)) return action("cancel", accountLinks.cancel(slug));
  return null;
}

/** The same rule for a My events card, from its badge. */
export function withdrawalForBadge(badge: MyEventBadge, slug: string, started = false): WithdrawalAction | null {
  if (started) return null;
  if (badge === "pending") return action("withdraw", accountLinks.withdraw(slug));
  if (badge === "waitlist") return action("withdraw", accountLinks.leaveWaitlist(slug));
  if (badge === "going" || badge === "approved" || badge === "in-review" || badge === "declined") return action("cancel", accountLinks.cancel(slug));
  return null;
}

/**
 * The server's decision (lane A `GuestRegistrationView.withdrawal`), once wired: `allowed` and the cutoff come from
 * the server; the label is shown as "Cancel my place" for an approved seat. Pending → /withdraw; waitlisted and
 * approved → /cancel (the route that serves both).
 */
export function withdrawalFromView(view: Pick<GuestRegistrationView, "slug" | "admission" | "withdrawal">): WithdrawalAction | null {
  if (!view.withdrawal.allowed) return null;
  if (view.withdrawal.label === "Withdraw request") return action("withdraw", view.admission === "pending" ? accountLinks.withdraw(view.slug) : accountLinks.leaveWaitlist(view.slug));
  return action("cancel", accountLinks.cancel(view.slug));
}

/** Doors open: from the event start the server no longer accepts a cancellation (CancelRoute shows U-31). */
export const hasStarted = (startsAt: string, now: Date) => Date.parse(startsAt) <= now.getTime();
