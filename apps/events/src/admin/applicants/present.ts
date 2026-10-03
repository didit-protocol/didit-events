/** What each tab shows per column and which row actions it offers (design/05 `ap` tab overrides). */
import type { TagTone } from "@didit-events/ui";
import type { ApplicantRow, ApplicantsEvent, ApplicantTab, ApprovedStatus, Decision, SignalTag, SignIn, TagToneKey } from "./types";

/** The SIGN-IN column / drawer copy (plan §1: a Didit email code, never a magic link). */
export const signInLabel = (signIn: SignIn) => (signIn === "google" ? "Google" : "Email code");

export const TAG_TONE: Record<TagToneKey, TagTone> = { ok: "success", warn: "warning", bad: "danger", brand: "brand", neu: "soft", feat: "feature" };

export const HEADS: Record<ApplicantTab, string[]> = {
  pending: ["APPLICANT", "SIGN-IN", "COMPANY · ROLE", "WHY THEY WANT TO COME", "SIGNALS", "REQUESTED"],
  waitlist: ["APPLICANT", "SIGN-IN", "COMPANY · ROLE", "WHY", "POSITION", "JOINED"],
  approved: ["GUEST", "SIGN-IN", "COMPANY · ROLE", "VERIFICATION", "STATUS", "APPROVED"],
  rejected: ["APPLICANT", "SIGN-IN", "COMPANY · ROLE", "REASON (INTERNAL)", "EMAILED", "REJECTED"],
  cancelled: ["GUEST", "SIGN-IN", "COMPANY · ROLE", "GUEST’S REASON", "WHEN", "CANCELLED"],
};

const STATUS_TAG: Record<ApprovedStatus, SignalTag> = {
  going: { label: "Going", tone: "ok" },
  "link-sent": { label: "Link sent", tone: "warn" },
  "in-review": { label: "In review", tone: "feat" },
  verifying: { label: "Verifying", tone: "brand" },
  declined: { label: "Declined", tone: "bad" },
  expired: { label: "Expired", tone: "neu" },
  invited: { label: "Invited", tone: "brand" },
};

export interface RowCells {
  why: string;
  tags: SignalTag[];
  time: string;
}

export function cellsFor(r: ApplicantRow): RowCells {
  switch (r.tab) {
    case "waitlist":
      return { why: r.why, tags: [{ label: `#${r.position ?? "—"}`, tone: "warn" }], time: r.requested };
    case "approved":
      return { why: r.approval?.line ?? "—", tags: r.approval ? [STATUS_TAG[r.approval.status]] : [], time: r.requested };
    case "rejected":
      return { why: r.rejection?.reason ?? "—", tags: [r.rejection?.emailed === false ? { label: "Not emailed", tone: "neu" } : { label: "M-10 sent", tone: "ok" }], time: r.requested };
    case "cancelled":
      return { why: r.cancellation?.reason ?? "—", tags: [r.cancellation?.late ? { label: "Late · <24h", tone: "warn" } : { label: "Place released", tone: "neu" }], time: r.cancellation?.when ?? r.requested };
    default:
      return { why: r.why, tags: r.signals, time: r.requested };
  }
}

export interface RowAction {
  decision: Decision | "open";
  label: string;
  kind?: "danger" | "primary";
}

/** Row buttons per tab (AP-01, AP-12, AP-13, AP-14, AP-15) and at capacity (AP-24: Reject + Waitlist). */
export function actionsFor(r: ApplicantRow, event: Pick<ApplicantsEvent, "registration">): RowAction[] {
  switch (r.tab) {
    case "pending":
      return event.registration === "full"
        ? [{ decision: "reject", label: "Reject", kind: "danger" }, { decision: "waitlist", label: "Waitlist", kind: "primary" }]
        : [{ decision: "reject", label: "Reject", kind: "danger" }, { decision: "waitlist", label: "Waitlist" }, { decision: "approve", label: "Approve", kind: "primary" }];
    case "waitlist":
      return [{ decision: "remove", label: "Remove", kind: "danger" }, { decision: "promote", label: "Promote", kind: "primary" }];
    case "approved":
      return r.approval?.status === "going" ? [{ decision: "revoke", label: "Revoke", kind: "danger" }, { decision: "open", label: "Open" }] : [{ decision: "resend", label: "Resend link" }, { decision: "open", label: "Open" }];
    case "rejected":
      return [{ decision: "reconsider", label: "Reconsider" }];
    case "cancelled":
      return [{ decision: "reapprove", label: "Re-approve" }];
  }
}

export const initialsOf = (name: string) =>
  name
    .split(" ")
    .map((x) => x[0])
    .join("")
    .slice(0, 2);

export const firstName = (name: string) => name.split(" ")[0] ?? name;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** AP-07 body: how many need a Didit verification (M-03) and how many go straight to Going (M-06). */
export function bulkApproveBody(rows: Pick<ApplicantRow, "verified">[]): string {
  const verified = rows.filter((r) => r.verified).length;
  const need = rows.length - verified;
  const parts: string[] = [];
  if (need) parts.push(`${need} ${plural(need, "needs", "need")} Didit verification and ${plural(need, "gets", "get")} M-03.`);
  if (verified) parts.push(`${verified} ${plural(verified, "is", "are")} already verified and ${plural(verified, "goes", "go")} straight to Going (M-06).`);
  return parts.join(" ");
}

/** AP-06 body. */
export function capacityBody(names: string[], approved: number, capacity: number, releaseOn: string): string {
  const who = names.length === 1 ? firstName(names[0]!) : `${names.length} applicants`;
  return `Approving ${who} puts you at ${approved + names.length} of ${capacity}. Approved guests who never verify are released on ${releaseOn}.`;
}
