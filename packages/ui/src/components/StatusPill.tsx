import type { ReactNode } from "react";
import { cx } from "../cx";
import styles from "./StatusPill.module.css";

/** The 16 C-00 pills: guest statuses, kiosk results and event lifecycle. */
export const PILL_STATUSES = {
  requested: { label: "Requested", cls: styles.requested },
  approved: { label: "Approved", cls: styles.approved },
  "link-sent": { label: "Link sent", cls: styles.linkSent },
  verifying: { label: "Verifying", cls: styles.verifying },
  verified: { label: "Verified", cls: styles.verified },
  "in-review": { label: "In review", cls: styles.inReview },
  declined: { label: "Declined", cls: styles.declined },
  rejected: { label: "Rejected", cls: styles.rejected },
  revoked: { label: "Revoked", cls: styles.revoked },
  "checked-in": { label: "Checked in", cls: styles.checkedIn },
  missing: { label: "Missing", cls: styles.missing },
  "unknown-face": { label: "Unknown face", cls: styles.unknownFace },
  draft: { label: "Draft", cls: styles.draft },
  open: { label: "Open", cls: styles.open },
  live: { label: "Live", cls: styles.live },
  ended: { label: "Ended", cls: styles.ended },
} as const;

/** Guest-side statuses of design/04 and 05 (My events, profile badge). Not part of the C-00 sixteen. */
export const GUEST_PILL_STATUSES = {
  going: { label: "Going", cls: styles.going },
  pending: { label: "Pending", cls: styles.pending },
  waitlist: { label: "Waitlist", cls: styles.waitlist },
  attended: { label: "Attended", cls: styles.attended },
  "no-show": { label: "No-show", cls: styles.cancelled },
  cancelled: { label: "Cancelled", cls: styles.cancelled },
  withdrawn: { label: "Withdrawn", cls: styles.withdrawn },
  "not-approved": { label: "Not approved", cls: styles.notApproved },
  "profile-verified": { label: "Profile verified", cls: styles.profileVerified },
  "profile-incomplete": { label: "Profile incomplete", cls: styles.profileIncomplete },
} as const;

/** Event registration states of design/05 AP-24 / AP-25 (the S-00 EVENT rows FULL and CLOSED). */
export const EVENT_PILL_STATUSES = {
  full: { label: "Full", cls: styles.full },
  closed: { label: "Closed", cls: styles.closed },
} as const;

export type PillStatus = keyof typeof PILL_STATUSES;
export type EventPillStatus = keyof typeof EVENT_PILL_STATUSES;
export type GuestPillStatus = keyof typeof GUEST_PILL_STATUSES;
export const PILL_STATUS_KEYS = Object.keys(PILL_STATUSES) as PillStatus[];
export const GUEST_PILL_STATUS_KEYS = Object.keys(GUEST_PILL_STATUSES) as GuestPillStatus[];
const ALL: Record<PillStatus | GuestPillStatus | EventPillStatus, { label: string; cls: string | undefined }> = { ...PILL_STATUSES, ...GUEST_PILL_STATUSES, ...EVENT_PILL_STATUSES };

export interface StatusPillProps {
  status: PillStatus | GuestPillStatus | EventPillStatus;
  /** Overrides the default label (rendered uppercase by CSS). */
  children?: ReactNode;
  className?: string;
}

export function StatusPill({ status, children, className }: StatusPillProps) {
  const def = ALL[status];
  return (
    <span className={cx(styles.pill, def.cls, className)} data-status={status}>
      <span className={styles.dot} aria-hidden="true" />
      {children ?? def.label}
    </span>
  );
}
