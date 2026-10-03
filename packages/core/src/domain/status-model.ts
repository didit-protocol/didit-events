// S-00 rows transcribed from design/05 Accounts and Applicants.dc.html:421-459.
// Descriptive email-link wording belongs to the design; runtime authentication is Didit OTP (C5).
export const STATUS_MODEL = {
  "signed_out": {
    "label": "SIGNED OUT",
    "setBy": "Default",
    "guest": "Event page with Request to join",
    "admin": "—",
    "email": "—",
    "canMoveTo": "Signed in"
  },
  "signed_in": {
    "label": "SIGNED IN",
    "setBy": "Guest · Google or magic link",
    "guest": "Their name in the header, My events",
    "admin": "Sign-in method on every applicant",
    "email": "M-17 link · M-18 welcome",
    "canMoveTo": "Profile incomplete · Deleted"
  },
  "profile_incomplete": {
    "label": "PROFILE INCOMPLETE",
    "setBy": "System",
    "guest": "Complete-profile step before the request is sent",
    "admin": "Not visible (no request yet)",
    "email": "—",
    "canMoveTo": "Signed in"
  },
  "profile_verified": {
    "label": "PROFILE VERIFIED",
    "setBy": "Didit, after first verification",
    "guest": "Blue check on photo, verified items listed on profile",
    "admin": "Verified items vs event requirements",
    "email": "—",
    "canMoveTo": "Re-verify (expiry / name change)"
  },
  "deleted": {
    "label": "DELETED",
    "setBy": "Guest",
    "guest": "Confirmation, then signed out",
    "admin": "Anonymised row, registrations cancelled",
    "email": "M-22",
    "canMoveTo": "—"
  },
  "pending": {
    "label": "PENDING",
    "setBy": "Guest submits request",
    "guest": "Your request is in",
    "admin": "Pending tab · approve / waitlist / reject",
    "email": "M-02",
    "canMoveTo": "Approved · Waitlist · Rejected · Withdrawn"
  },
  "invited": {
    "label": "INVITED",
    "setBy": "Staff invites directly",
    "guest": "Invite email, accept on event page",
    "admin": "Approved tab · Invited",
    "email": "M-19",
    "canMoveTo": "Link sent · Going (if verified)"
  },
  "waitlist": {
    "label": "WAITLIST",
    "setBy": "Staff, or auto when full",
    "guest": "You are #12 on the waitlist",
    "admin": "Waitlist tab · promote",
    "email": "M-09",
    "canMoveTo": "Approved (promoted) · Expired at close"
  },
  "rejected": {
    "label": "REJECTED",
    "setBy": "Staff with internal reason",
    "guest": "This one is full for now",
    "admin": "Rejected tab · reason · reconsider",
    "email": "M-10 (optional)",
    "canMoveTo": "Approved (reconsider)"
  },
  "withdrawn": {
    "label": "WITHDRAWN",
    "setBy": "Guest before a decision",
    "guest": "Request withdrawn · request again",
    "admin": "Cancelled tab",
    "email": "M-20",
    "canMoveTo": "Pending (request again)"
  },
  "link_sent": {
    "label": "LINK SENT",
    "setBy": "System on approval",
    "guest": "Verify my identity",
    "admin": "Approved tab · resend link",
    "email": "M-03 · M-05 nudge",
    "canMoveTo": "Verifying · Expired"
  },
  "verifying": {
    "label": "VERIFYING",
    "setBy": "Guest opens Didit flow",
    "guest": "Continue verification",
    "admin": "Step shown (name · email · selfie)",
    "email": "M-04 Didit code",
    "canMoveTo": "Verified · In review · Declined"
  },
  "in_review": {
    "label": "IN REVIEW",
    "setBy": "Didit",
    "guest": "We are checking your verification",
    "admin": "In review since …",
    "email": "M-07",
    "canMoveTo": "Verified · Declined"
  },
  "declined": {
    "label": "DECLINED",
    "setBy": "Didit",
    "guest": "Try again (retries left) or contact team",
    "admin": "Reason + retries left",
    "email": "M-08",
    "canMoveTo": "Verifying (retry)"
  },
  "verified": {
    "label": "VERIFIED",
    "setBy": "Didit webhook",
    "guest": "You are in · face ticket",
    "admin": "Going",
    "email": "M-06",
    "canMoveTo": "Checked in · Cancelled · Revoked"
  },
  "reused": {
    "label": "REUSED",
    "setBy": "System on approval, when the profile already meets every event requirement",
    "guest": "No verification step: straight to You are in",
    "admin": "Going · “Reused verification” tag",
    "email": "M-06",
    "canMoveTo": "Checked in · Cancelled · Revoked"
  },
  "re_verify": {
    "label": "RE-VERIFY",
    "setBy": "System when a required item expired or name changed",
    "guest": "Only the missing or expired steps",
    "admin": "Link sent · partial",
    "email": "M-03 (short)",
    "canMoveTo": "Verifying"
  },
  "going": {
    "label": "GOING",
    "setBy": "After verification (or returning verified)",
    "guest": "Face ticket, reminders",
    "admin": "Guests tab · verified",
    "email": "M-11 · M-12",
    "canMoveTo": "Checked in · Cancelled · Revoked · No-show"
  },
  "cancelled": {
    "label": "CANCELLED",
    "setBy": "Guest with reason",
    "guest": "You cancelled · request again",
    "admin": "Cancelled tab · reason · late flag if <24h",
    "email": "M-20",
    "canMoveTo": "Pending (request again) · Re-approved by staff"
  },
  "revoked": {
    "label": "REVOKED",
    "setBy": "Staff",
    "guest": "This invite is no longer active",
    "admin": "Guests tab · revoked",
    "email": "M-10 variant",
    "canMoveTo": "Approved (restore)"
  },
  "checked_in": {
    "label": "CHECKED IN",
    "setBy": "Kiosk match",
    "guest": "Welcome in (door + email)",
    "admin": "Check-in log · arrivals",
    "email": "M-13",
    "canMoveTo": "—"
  },
  "no_show": {
    "label": "NO-SHOW",
    "setBy": "System at event end",
    "guest": "Thanks + recordings anyway",
    "admin": "No-shows count on history",
    "email": "M-14",
    "canMoveTo": "—"
  },
  "draft": {
    "label": "DRAFT",
    "setBy": "Staff",
    "guest": "Not public",
    "admin": "Editable, no links",
    "email": "—",
    "canMoveTo": "Open"
  },
  "open": {
    "label": "OPEN",
    "setBy": "Staff publishes",
    "guest": "Request to join",
    "admin": "Pending requests arrive",
    "email": "—",
    "canMoveTo": "Full · Closed · Live"
  },
  "full": {
    "label": "FULL",
    "setBy": "System at capacity",
    "guest": "Join waitlist",
    "admin": "Auto-waitlist banner",
    "email": "—",
    "canMoveTo": "Open (capacity raised / cancellations)"
  },
  "closed": {
    "label": "CLOSED",
    "setBy": "Staff or close date",
    "guest": "Registration is closed",
    "admin": "Decide pending, invite directly",
    "email": "—",
    "canMoveTo": "Open (reopen) · Live"
  },
  "live": {
    "label": "LIVE",
    "setBy": "Doors open time",
    "guest": "Checked in / See the agenda",
    "admin": "Arrivals feed, kiosk",
    "email": "M-13 per guest",
    "canMoveTo": "Ended"
  },
  "ended": {
    "label": "ENDED",
    "setBy": "End time or staff",
    "guest": "Thanks for coming",
    "admin": "Final summary, no-shows",
    "email": "M-14",
    "canMoveTo": "—"
  }
} as const;
export type DesignStatus = keyof typeof STATUS_MODEL;
