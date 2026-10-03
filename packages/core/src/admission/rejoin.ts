/**
 * Re-join (v5): what a guest who already has a registration for an event may do next, as one pure decision. The
 * request context, the guest's registration view and the event card all read it, so the modal, /me/events and the
 * server transition agree on every case: withdrew → request again, cancelled → request the place again (approval
 * again unless the event's rules restore it), invited → rejoin while the invitation stands, rejected → once unless the
 * hosts blocked it, waitlisted / pending / approved / checked in → status only, cancelled by the hosts → no self-rejoin.
 * A guest gets one re-request per event (registrations.reapplication_count ≤ 1); after that the hosts decide.
 */
import type { Admission } from "../domain/transitions.ts";

/** Why a new request cannot go out right now (null when it can, or when there is nothing to request). */
export type Availability = "open" | "closed" | "started" | "ended" | "cancelled";

export type RejoinKind =
  | "withdrew" | "cancelled" | "invited" | "rejected"
  | "pending" | "waitlisted" | "approved" | "checked_in"
  | "cancelled_by_host" | "revoked";

export type RejoinBlock = Availability | "full" | "once" | "blocked" | "invite_required" | null;

export interface Rejoin {
  kind: RejoinKind;
  /** A new request may go out from this account now (the modal shows one primary action). */
  canRequest: boolean;
  /** What the request leads to: the place straight back, the hosts' approval again, or the waitlist. */
  outcome: "approved" | "pending" | "waitlisted" | null;
  /** The event's rule in one line, shown under the action (or the reason there is none). */
  rule: string | null;
  blockedBy: Exclude<RejoinBlock, "open">;
}

export interface RejoinFacts {
  admission: Admission;
  /** For cancelled_by_guest: the admission the guest left (admission_history), null when unknown. */
  cancelledFrom: Admission | null;
  reapplicationCount: number;
  blocked: boolean;
  checkedIn: boolean;
  /** The invitation this guest accepted for the registration: still usable, gone (expired / revoked), or none. */
  invite: { valid: boolean; skipApproval: boolean } | null;
  event: {
    mode: "request" | "open" | "invite_only";
    waitlist: boolean;
    full: boolean;
    /** Public requests (form close time, start). */
    requests: Availability;
    /** Invitations stay usable until the event ends. */
    invited: Availability;
  };
}

const REAPPLY: ReadonlySet<Admission> = new Set(["cancelled_by_guest", "rejected"]);

/** The registration states a guest may re-request from (the server still checks the count, block and the event). */
export const reapplicable = (admission: Admission) => REAPPLY.has(admission);

export function rejoinKind(f: Pick<RejoinFacts, "admission" | "cancelledFrom" | "checkedIn" | "invite">): RejoinKind {
  switch (f.admission) {
    case "approved":
      return f.checkedIn ? "checked_in" : "approved";
    case "pending":
    case "waitlisted":
    case "rejected":
    case "cancelled_by_host":
    case "revoked":
      return f.admission;
    case "cancelled_by_guest":
      if (f.invite?.valid) return "invited";
      return f.cancelledFrom === "approved" ? "cancelled" : "withdrew";
  }
}

const BLOCK_COPY: Record<NonNullable<RejoinBlock>, string> = {
  open: "",
  closed: "Requests for this event are closed.",
  started: "The event has started, so requests are closed.",
  ended: "This event has ended.",
  cancelled: "This event was cancelled.",
  full: "The event is full and has no waitlist.",
  once: "You already requested again once. To change it, email the hosts.",
  blocked: "The hosts are not taking another request from you for this event.",
  invite_required: "This event is invite only, and your invitation is no longer valid.",
};

export function rejoin(f: RejoinFacts): Rejoin {
  const kind = rejoinKind(f);
  const status = (rule: string | null = null): Rejoin => ({ kind, canRequest: false, outcome: null, rule, blockedBy: null });
  switch (kind) {
    case "approved":
    case "checked_in":
    case "pending":
    case "waitlisted":
      return status();
    case "cancelled_by_host":
      return status("The hosts cancelled your place. If you think this is a mistake, email them.");
    case "revoked":
      return status("The hosts withdrew your place. If you think this is a mistake, email them.");
    default:
      break;
  }
  const invited = kind === "invited";
  const window = invited ? f.event.invited : f.event.requests;
  const block = (b: NonNullable<RejoinBlock>): Rejoin => ({ kind, canRequest: false, outcome: null, rule: BLOCK_COPY[b], blockedBy: b as Rejoin["blockedBy"] });
  if (f.blocked) return block("blocked");
  if (f.reapplicationCount >= 1) return block("once");
  if (window !== "open") return block(window);
  if (!invited && f.event.mode === "invite_only") return block("invite_required");
  if (f.event.full && !f.event.waitlist) return block("full");
  const outcome: Rejoin["outcome"] = f.event.full ? "waitlisted" : invited && f.invite!.skipApproval ? "approved" : f.event.mode === "open" ? "approved" : "pending";
  return { kind, canRequest: true, outcome, rule: ruleLine(kind, outcome), blockedBy: null };
}

function ruleLine(kind: RejoinKind, outcome: NonNullable<Rejoin["outcome"]>): string {
  if (outcome === "waitlisted") return "The event is full: you join the waitlist and we email you if a place opens.";
  if (kind === "invited") return outcome === "approved" ? "Your invitation still stands, so your place comes straight back." : "Your invitation still stands; the hosts confirm your place again.";
  if (outcome === "approved") return "Places are first come, first served: yours comes straight back.";
  switch (kind) {
    case "cancelled":
      return "The hosts approve every place, so your request goes back to them.";
    case "rejected":
      return "The hosts look at a second request once.";
    default:
      return "Your request goes back to the hosts.";
  }
}

/** Public requests: open until the form's close time and the start; invitations until the end. */
export function availabilityOf(event: { status: string; startsAt: Date; endsAt: Date; form: { closes_at: string | null } }, now: Date, invited: boolean): Availability {
  if (event.status === "cancelled") return "cancelled";
  if (event.status === "ended" || now >= event.endsAt) return "ended";
  if (event.status !== "published") return "closed";
  if (invited) return "open";
  if (now >= event.startsAt) return "started";
  if (event.form.closes_at && now >= new Date(event.form.closes_at)) return "closed";
  return "open";
}
