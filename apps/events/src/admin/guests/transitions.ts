/**
 * Guest status changes staff can make from the guests tab (A-05 bulk bar + row menu, A-06 drawer, A-14/A-15, A-16).
 *
 * Every change goes through `guestTransition`. Two gates, both must pass:
 * 1. The admission axis uses the domain table (`canTransition` from @didit-events/core, S-00): the admin guest statuses
 *    are all admission `approved` except `revoked`, so only approve-from-revoked and revoke touch it.
 * 2. The verification / attendance axis is not in the domain table (it models admission only), so `FROM` below mirrors
 *    S-00's "can move to" column for the admin guest states: approved → link sent, link sent/verifying → link resent,
 *    in review → verified or a fresh link (A-16), admitted → checked in, checked in → only an undo. Nothing moves a
 *    verified, in-review, declined or checked-in guest back to approved or link sent, and a checked-in guest can't be
 *    revoked (its check-in record stays; staff undo the check-in first).
 */
import { canTransition, type Admission } from "@didit-events/core/domain/transitions";
import { CHECKIN_ELIGIBLE, LINK_SENDABLE } from "./checkin";
import type { GuestStatus } from "./types";

export type GuestOp = "approve" | "send" | "revoke" | "check-in" | "undo-check-in" | "accept-email" | "reverify";

/** Statuses each operation may start from (S-00, admin guest states). */
const FROM: Record<GuestOp, readonly GuestStatus[]> = {
  approve: ["revoked"],
  send: LINK_SENDABLE,
  revoke: ["approved", "link-sent", "verifying", "verified", "in-review", "declined"],
  "check-in": CHECKIN_ELIGIBLE,
  "undo-check-in": ["checked-in"],
  "accept-email": ["verifying", "in-review"],
  reverify: ["verifying", "in-review"],
};

const admissionOf = (s: GuestStatus): Admission => (s === "revoked" ? "revoked" : "approved");

const LABEL: Record<GuestStatus, string> = {
  approved: "approved",
  "link-sent": "link sent",
  verifying: "verifying",
  verified: "verified",
  "in-review": "in review",
  declined: "declined",
  revoked: "revoked",
  "checked-in": "checked in",
};

export type TransitionResult = { ok: true; to: GuestStatus } | { ok: false; reason: string };

/**
 * The one guard for a guest status change. `undoTo` is the state the check-in replaced (from the check-in record).
 * Resending a link keeps a guest who is already verifying at verifying.
 */
export function guestTransition(from: GuestStatus, op: GuestOp, undoTo?: GuestStatus): TransitionResult {
  if (!FROM[op].includes(from)) {
    if (op === "approve" && from !== "revoked") return { ok: false, reason: from === "approved" ? "Already approved" : `Can’t approve a guest who is ${LABEL[from]}` };
    if (op === "revoke" && from === "revoked") return { ok: false, reason: "Already revoked" };
    if (op === "revoke" && from === "checked-in") return { ok: false, reason: "Already checked in: undo the check-in first" };
    if (op === "undo-check-in") return { ok: false, reason: "Not checked in" };
    return { ok: false, reason: `Can’t ${op === "send" ? "send a link to" : op === "check-in" ? "check in" : "change"} a guest who is ${LABEL[from]}` };
  }
  let to: GuestStatus;
  switch (op) {
    case "approve":
      to = "approved";
      break;
    case "send":
      to = from === "verifying" ? "verifying" : "link-sent";
      break;
    case "revoke":
      to = "revoked";
      break;
    case "check-in":
      to = "checked-in";
      break;
    case "undo-check-in":
      if (!undoTo || !CHECKIN_ELIGIBLE.includes(undoTo)) return { ok: false, reason: "No check-in record to undo" };
      to = undoTo;
      break;
    case "accept-email":
      to = "verified";
      break;
    case "reverify":
      to = "link-sent";
      break;
  }
  const a = admissionOf(from);
  const b = admissionOf(to);
  if (a !== b && !canTransition(a, b, "staff")) return { ok: false, reason: `Can’t move a guest from ${LABEL[from]} to ${LABEL[to]}` };
  return { ok: true, to };
}
