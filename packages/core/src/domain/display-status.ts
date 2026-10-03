import { STATUS_MODEL, type DesignStatus } from "./status-model.ts";
import type { Admission } from "./transitions.ts";
export interface StatusEvent { status: "draft" | "published" | "live" | "ended" | "cancelled"; startsAt: Date; endsAt: Date; registrationClosesAt: Date | null; capacity: number; approvedCount: number }
export interface StatusRegistration { admission: Admission; invited?: boolean; withdrawn?: boolean; checkedIn?: boolean; lateCancellation?: boolean; reason?: string | null }
/** Summary is derived from B1's evidence query, never from a browser callback. */
export interface EvidenceSummary {
  signedIn: boolean; profileComplete?: boolean; profileVerified?: boolean; deleting?: boolean; deleted?: boolean;
  eligible: boolean; previouslyEligible?: boolean; reused?: boolean; missing?: readonly string[];
  /** B1/B4 distinguish tightened requirements from ordinary expiry of a reusable selfie. */
  requirementsChanged?: boolean;
  verification: "not_started" | "started" | "in_review" | "declined" | "expired" | "approved";
  retriesLeft?: number; waitlistPosition?: number;
  /** Explicit surfaces expose S-00's independent axes. Default is the P-02 registration card. */
  surface?: "card" | "account" | "event" | "verification" | "attendance";
}
export type DisplayStatus = DesignStatus | "requirements_unmet" | "expired" | "cancelled_by_host" | "event_cancelled";
const extra = {
  requirements_unmet: { label: "REQUIREMENTS UNMET", setBy: "System after requirements change", guest: "Complete the missing verification steps", admin: "Approved · requirements unmet", email: "—", canMoveTo: "Verifying · Verified" },
  expired: { label: "EXPIRED", setBy: "System", guest: "Your verification link expired", admin: "Approved tab · resend link", email: "—", canMoveTo: "Link sent" },
  cancelled_by_host: { label: "CANCELLED BY HOST", setBy: "Staff", guest: "Your registration was cancelled by the host", admin: "Cancelled tab · reason", email: "M-21", canMoveTo: "Approved" },
  event_cancelled: { label: "EVENT CANCELLED", setBy: "Staff", guest: "This event has been cancelled", admin: "Event cancelled", email: "M-21", canMoveTo: "—" },
} as const;
export interface DisplayResult { status: DisplayStatus; label: string; setBy: string; guest: string; admin: string; email: string; canMoveTo: string; frame: string | null; accountStatus: DesignStatus; eventStatus: DesignStatus | "event_cancelled"; attendanceStatus: "checked_in" | "no_show" | "going" | null }
const frames: Partial<Record<DisplayStatus, string>> = { signed_out: "P-02a", signed_in: "P-02a", pending: "P-02b", link_sent: "P-02c", verifying: "P-02d", in_review: "P-02e", verified: "P-02f", reused: "P-02f", going: "P-02f", declined: "P-02g", waitlist: "P-02h", rejected: "P-02i", full: "P-02j", closed: "P-02k", checked_in: "P-02l", ended: "P-02m", no_show: "P-02m", cancelled: "P-02n", re_verify: "U-42" };
/** All axes remain independent: display changes never mutate admission. S-00 and P-02a-n. */
export function displayStatus(event: StatusEvent, registration: StatusRegistration | null, summary: EvidenceSummary, now: Date): DisplayResult {
  const accountStatus: DesignStatus = summary.deleted || summary.deleting ? "deleted" : !summary.signedIn ? "signed_out" : summary.profileComplete === false ? "profile_incomplete" : summary.profileVerified ? "profile_verified" : "signed_in";
  const eventStatus = event.status === "cancelled" ? "event_cancelled" : event.status === "draft" ? "draft" : event.status === "ended" || now >= event.endsAt ? "ended" : event.status === "live" ? "live" : (event.registrationClosesAt !== null && now >= event.registrationClosesAt) || now >= event.startsAt ? "closed" : event.approvedCount >= event.capacity ? "full" : "open";
  const attendanceStatus = registration?.checkedIn ? "checked_in" : registration?.admission === "approved" && eventStatus === "ended" ? "no_show" : registration?.admission === "approved" && summary.eligible ? "going" : null;
  let status: DisplayStatus;
  const verification = (): DisplayStatus => {
    if (summary.eligible) return summary.reused ? "reused" : summary.surface === "attendance" ? "going" : "verified";
    if (summary.verification === "in_review") return "in_review";
    if (summary.verification === "declined") return "declined";
    if (summary.verification === "started") return "verifying";
    if (summary.requirementsChanged) return "requirements_unmet";
    if (summary.missing?.length === 1 && summary.missing[0] === "face") return "re_verify";
    if (summary.previouslyEligible) return "requirements_unmet";
    if (summary.verification === "expired") return "expired";
    return "link_sent";
  };
  if (summary.surface === "account" || accountStatus === "deleted") status = accountStatus;
  else if (summary.surface === "event") status = eventStatus;
  else if (eventStatus === "event_cancelled") status = "event_cancelled";
  else if (summary.surface === "attendance" && attendanceStatus) status = attendanceStatus;
  else if (eventStatus === "ended") status = "ended";
  else if (registration) {
    if (registration.admission === "cancelled_by_guest") status = registration.withdrawn ? "withdrawn" : "cancelled";
    else if (registration.admission === "cancelled_by_host") status = "cancelled_by_host";
    else if (registration.admission === "revoked") status = "revoked";
    else if (registration.admission === "rejected") status = "rejected";
    else if (registration.admission === "waitlisted") status = "waitlist";
    else if (registration.admission === "pending") status = "pending";
    else if (registration.checkedIn) status = "checked_in";
    else if (registration.invited) status = "invited";
    else status = verification();
  } else if (["draft", "closed", "full", "live"].includes(eventStatus)) status = eventStatus;
  else status = accountStatus;
  const row = status in STATUS_MODEL ? STATUS_MODEL[status as DesignStatus] : extra[status as keyof typeof extra];
  return { status, ...row, frame: frames[status] ?? null, accountStatus, eventStatus, attendanceStatus };
}
