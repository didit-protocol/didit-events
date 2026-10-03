import type { StaffUser } from "../types";

export type StaffRole = StaffUser["role"];

/** A row of A-12 / A-19: a `staff` row (plan §2: email PK, role, invited_by, disabled_at) plus the last sign-in. */
export interface TeamMember {
  email: string;
  name: string;
  initials: string;
  role: StaffRole;
  /** Last authenticated request; null for an invite nobody has used yet. */
  lastActiveAt: string | null;
  /** Set when access was disabled (A-19d). */
  disabledAt?: string | null;
}

/** The A-19 invite form, as the server action returns it. */
export type InviteState =
  | { status: "idle" }
  | { status: "invalid"; email: string; role: string; errors: { email?: string; role?: string } }
  | { status: "sent"; email: string }
  | { status: "failed"; email: string; role: string; message: string }
  | { status: "session_expired"; error: "session_expired" };

/** Disable / restore access results. */
export type AccessResult = { ok: true } | { error: "session_expired" | "forbidden" | "not_found" };

/** Resend invite results. `cooldown`: the previous invite to that address went out less than a minute ago. */
export type ResendResult = { ok: true } | { error: "session_expired" | "forbidden" | "not_found" | "signed_in" | "cooldown" | "failed" };
