/**
 * v5 re-join, table-driven: (registration state × account state × event state) → the modal's first screen, its one
 * primary action, and the server transition the tap leads to. The registration decision is the core `rejoin()` the
 * server runs (integration-tested end to end in core admission/rejoin.integration.test.ts); `nextAction` follows the
 * request context's order (status → closed → profile → face → submit).
 */
import { describe, expect, it } from "vitest";
import { rejoin, type RejoinFacts } from "@didit-events/core/admission/rejoin";
import type { OnboardingView, RequestContext } from "@didit-events/core/contracts/event-model";
import { joinScreen, type JoinScreen } from "./join/rejoin-copy";
import type { JoinInitial } from "./join/machine";
import { ONBOARDING_VIEWS } from "./onboarding-fixtures";
import { REQUEST_CONTEXTS, registrationWith, rejoinFacts } from "./request-fixtures";

type Reg =
  | "none" | "pending" | "waitlisted" | "approved" | "checked_in"
  | "withdrew" | "withdrew_twice" | "cancelled" | "cancelled_late" | "invited" | "invite_lapsed" | "rejected" | "rejected_blocked"
  | "host_cancelled" | "revoked";
type Account = "complete" | "face_expired" | "face_in_review" | "face_declined" | "profile_missing" | "deleting" | "signed_out";
type Ev = "open" | "open_mode" | "full_waitlist" | "full" | "closed" | "started" | "ended" | "cancelled" | "invite_only";

const REG: Record<Exclude<Reg, "none">, Partial<RejoinFacts>> = {
  pending: { admission: "pending", cancelledFrom: null },
  waitlisted: { admission: "waitlisted", cancelledFrom: null },
  approved: { admission: "approved", cancelledFrom: null },
  checked_in: { admission: "approved", cancelledFrom: null, checkedIn: true },
  withdrew: { cancelledFrom: "pending" },
  withdrew_twice: { cancelledFrom: "pending", reapplicationCount: 1 },
  cancelled: { cancelledFrom: "approved" },
  cancelled_late: { cancelledFrom: "approved" },
  invited: { cancelledFrom: "approved", invite: { valid: true, skipApproval: true } },
  invite_lapsed: { cancelledFrom: "approved", invite: { valid: false, skipApproval: true } },
  rejected: { admission: "rejected", cancelledFrom: null },
  rejected_blocked: { admission: "rejected", cancelledFrom: null, blocked: true },
  host_cancelled: { admission: "cancelled_by_host", cancelledFrom: null },
  revoked: { admission: "revoked", cancelledFrom: null },
};
const EVENT: Record<Ev, { facts: Partial<RejoinFacts["event"]>; availability: RequestContext["availability"] }> = {
  open: { facts: {}, availability: "open" },
  open_mode: { facts: { mode: "open" }, availability: "open" },
  full_waitlist: { facts: { full: true }, availability: "waitlist" },
  full: { facts: { full: true, waitlist: false }, availability: "full" },
  closed: { facts: { requests: "closed" }, availability: "closed" },
  started: { facts: { requests: "started" }, availability: "started" },
  ended: { facts: { requests: "ended", invited: "ended" }, availability: "ended" },
  cancelled: { facts: { requests: "cancelled", invited: "cancelled" }, availability: "cancelled" },
  invite_only: { facts: { mode: "invite_only" }, availability: "invite_only" },
};
const ONBOARDING: Record<Exclude<Account, "deleting" | "signed_out">, { view: OnboardingView; next: RequestContext["nextAction"] | null }> = {
  complete: { view: ONBOARDING_VIEWS.complete, next: null },
  face_expired: { view: ONBOARDING_VIEWS.faceExpired, next: "face" },
  face_in_review: { view: ONBOARDING_VIEWS.faceInReview, next: "face" },
  face_declined: { view: ONBOARDING_VIEWS.faceDeclined, next: "face" },
  profile_missing: { view: ONBOARDING_VIEWS.profileResume, next: "profile" },
};

/** The server's initial state for a row (what getJoinInitial renders). */
function initialFor(reg: Reg, account: Account, ev: Ev): { initial: JoinInitial; transition: string | null } {
  if (account === "deleting") return { initial: { kind: "deleting", graceUntil: "2026-10-08T17:30:00Z" }, transition: "keep account" };
  const event = EVENT[ev];
  if (account === "signed_out") return { initial: { kind: "signed_out", requestsOpen: event.availability === "open" || event.availability === "waitlist" }, transition: null };
  const facts = reg === "none" ? null : rejoinFacts({ ...REG[reg], event: event.facts });
  const decision = facts ? rejoin(facts) : null;
  const available = event.availability === "open" || event.availability === "waitlist";
  const onboarding = ONBOARDING[account];
  const nextAction: RequestContext["nextAction"] =
    facts && !decision!.canRequest ? "status" : !facts && !available ? "unavailable" : (onboarding.next ?? "submit");
  const ctx: RequestContext = {
    ...REQUEST_CONTEXTS.oneTap,
    onboarding: onboarding.view,
    availability: event.availability,
    submitLabel: event.availability === "waitlist" ? "Join waitlist" : "Request to join",
    nextAction,
    canSubmit: nextAction === "submit",
    registration: facts ? registrationWith(facts) : null,
  };
  const transition = nextAction === "status" || nextAction === "unavailable" ? null : decision ? `${facts!.admission}→${decision.outcome}` : event.availability === "waitlist" ? "∅→waitlisted" : "∅→pending";
  return { initial: { kind: "signed_in", ctx }, transition };
}

// [registration, account, event, screen, primary action, server transition]
const TABLE: [Reg, Account, Ev, JoinScreen, string | null, string | null][] = [
  // First request (no registration).
  ["none", "signed_out", "open", "sign_in", "Continue with Google", null],
  ["none", "signed_out", "closed", "closed", "Back to event", null],
  ["none", "complete", "open", "form", "Request to join", "∅→pending"],
  ["none", "complete", "full_waitlist", "form", "Join waitlist", "∅→waitlisted"],
  ["none", "complete", "full", "closed", "Back to event", null],
  ["none", "complete", "closed", "closed", "Back to event", null],
  ["none", "complete", "started", "closed", "Back to event", null],
  ["none", "complete", "ended", "closed", "Back to event", null],
  ["none", "complete", "cancelled", "closed", "Back to event", null],
  ["none", "complete", "invite_only", "closed", "Back to event", null],
  ["none", "face_expired", "open", "face_intro", "Next", "∅→pending"],
  ["none", "profile_missing", "open", "profile", "Continue", "∅→pending"],
  // Withdrew a pending request.
  ["withdrew", "complete", "open", "rejoin", "Request again", "cancelled_by_guest→pending"],
  ["withdrew", "complete", "open_mode", "rejoin", "Request again", "cancelled_by_guest→approved"],
  ["withdrew", "complete", "full_waitlist", "rejoin", "Join the waitlist", "cancelled_by_guest→waitlisted"],
  ["withdrew", "complete", "full", "status", "Back to event", null],
  ["withdrew", "complete", "closed", "status", "Back to event", null],
  ["withdrew", "complete", "started", "status", "Back to event", null],
  ["withdrew", "complete", "cancelled", "status", "Back to event", null],
  ["withdrew", "complete", "invite_only", "status", "Back to event", null],
  ["withdrew", "face_expired", "open", "face", null, "cancelled_by_guest→pending"],
  ["withdrew", "face_in_review", "open", "face", null, "cancelled_by_guest→pending"],
  ["withdrew", "face_declined", "open", "face", null, "cancelled_by_guest→pending"],
  ["withdrew", "profile_missing", "open", "profile", "Continue", "cancelled_by_guest→pending"],
  ["withdrew", "deleting", "open", "deleting", "Keep my account", "keep account"],
  ["withdrew", "signed_out", "open", "sign_in", "Continue with Google", null],
  ["withdrew_twice", "complete", "open", "status", "Email the hosts", null],
  // Cancelled an approved place (early or late: the same rule).
  ["cancelled", "complete", "open", "rejoin", "Request my place again", "cancelled_by_guest→pending"],
  ["cancelled_late", "complete", "open", "rejoin", "Request my place again", "cancelled_by_guest→pending"],
  ["cancelled", "complete", "open_mode", "rejoin", "Request my place again", "cancelled_by_guest→approved"],
  ["cancelled", "complete", "full_waitlist", "rejoin", "Join the waitlist", "cancelled_by_guest→waitlisted"],
  ["cancelled", "complete", "full", "status", "Back to event", null],
  ["cancelled", "complete", "started", "status", "Back to event", null],
  ["cancelled", "face_expired", "open", "face", null, "cancelled_by_guest→pending"],
  ["cancelled", "deleting", "open", "deleting", "Keep my account", "keep account"],
  // Invited, then cancelled.
  ["invited", "complete", "invite_only", "rejoin", "Rejoin", "cancelled_by_guest→approved"],
  ["invited", "complete", "open", "rejoin", "Rejoin", "cancelled_by_guest→approved"],
  ["invited", "complete", "full_waitlist", "rejoin", "Join the waitlist", "cancelled_by_guest→waitlisted"],
  ["invited", "complete", "started", "rejoin", "Rejoin", "cancelled_by_guest→approved"],
  ["invited", "complete", "ended", "status", "Back to event", null],
  ["invite_lapsed", "complete", "open", "rejoin", "Request my place again", "cancelled_by_guest→pending"],
  ["invite_lapsed", "complete", "invite_only", "status", "Back to event", null],
  // Rejected by the hosts.
  ["rejected", "complete", "open", "rejoin", "Request again", "rejected→pending"],
  ["rejected", "complete", "closed", "status", "Back to event", null],
  ["rejected_blocked", "complete", "open", "status", "Email the hosts", null],
  // Status only.
  ["pending", "complete", "open", "status", "Back to event", null],
  ["waitlisted", "complete", "full_waitlist", "status", "Back to event", null],
  ["approved", "complete", "open", "status", "View my ticket", null],
  ["approved", "face_expired", "open", "status", "View my ticket", null],
  ["checked_in", "complete", "started", "status", "View my registration", null],
  ["host_cancelled", "complete", "open", "status", "Email the hosts", null],
  ["revoked", "complete", "open", "status", "Email the hosts", null],
];

describe("v5 re-join table: registration × account × event → screen, primary action, transition", () => {
  it.each(TABLE)("%s · %s · %s → %s / %s / %s", (reg, account, ev, screen, primary, transition) => {
    const row = initialFor(reg, account, ev);
    expect(joinScreen(row.initial)).toEqual({ screen, primary });
    expect(row.transition).toBe(transition);
  });

  it("covers every registration, account and event state at least once", () => {
    const regs = new Set(TABLE.map((r) => r[0])), accounts = new Set(TABLE.map((r) => r[1])), events = new Set(TABLE.map((r) => r[2]));
    expect([...regs].sort()).toEqual(["none", ...Object.keys(REG)].sort());
    expect([...accounts].sort()).toEqual(["deleting", "signed_out", ...Object.keys(ONBOARDING)].sort());
    expect([...events].sort()).toEqual(Object.keys(EVENT).sort());
  });

  it("a guest requesting again never sees onboarding or the profile offer when the profile is complete", () => {
    for (const [reg, account, ev, screen] of TABLE) {
      if (reg === "none" || account !== "complete") continue;
      expect(["profile", "face", "face_intro"], `${reg}/${ev}`).not.toContain(screen);
    }
  });

  it("every blocked state says why in one line (no dead buttons)", () => {
    for (const [reg, , ev, screen] of TABLE) {
      if (screen !== "status" || reg === "none") continue;
      const r = rejoin(rejoinFacts({ ...REG[reg], event: EVENT[ev].facts }));
      if (["pending", "waitlisted", "approved", "checked_in"].includes(r.kind)) continue;
      expect(r.rule, `${reg}/${ev}`).toBeTruthy();
    }
  });
});
