import { isStaffEmail, staffEmailDomains } from "@didit-events/core/staff-email";
/** A-19 team management rules: who may invite / disable whom, the configured staff invite schema, "last active". */
import { z } from "zod";
import type { StaffUser } from "../types";
import { STAFF_DOMAIN } from "./domain";
import type { StaffRole, TeamMember } from "./types";

export const ROLES = ["owner", "admin", "staff"] as const satisfies readonly StaffRole[];
export { ROLE_LABEL } from "./labels";

export { STAFF_DOMAIN };
export const INVITE_ERRORS = {
  email: "Enter an email address.",
  domain: `Use a ${staffEmailDomains(STAFF_DOMAIN).map(domain => `@${domain}`).join(" or ")} address.`,
  role: "Choose a role.",
  member: (email: string) => `${email} is already on the team.`,
  /** The staff row and its email are one transaction: nothing was saved. */
  failed: (email: string) => `Couldn’t send the invite to ${email}. Nothing was saved. Try again.`,
} as const;

/** Owners and admins manage the team; staff see the read-only list (A-12). */
export const canManageTeam = (viewer: Pick<StaffUser, "role">) => viewer.role === "owner" || viewer.role === "admin";

/** Owners grant any role; admins grant admin or staff; staff grant nothing. */
export function assignableRoles(viewer: Pick<StaffUser, "role">): StaffRole[] {
  if (viewer.role === "owner") return [...ROLES];
  if (viewer.role === "admin") return ["admin", "staff"];
  return [];
}

/** Nobody disables themselves; only an owner disables an owner. */
export function canDisable(viewer: Pick<StaffUser, "role" | "email">, member: TeamMember): boolean {
  if (!canManageTeam(viewer) || member.disabledAt) return false;
  if (member.email === viewer.email) return false;
  return member.role !== "owner" || viewer.role === "owner";
}

/** A pending invite (active, never signed in) can be emailed again, by anyone who could disable that member. */
export function canResendInvite(viewer: Pick<StaffUser, "role" | "email">, member: TeamMember): boolean {
  return member.lastActiveAt === null && canDisable(viewer, member);
}

export function canRestore(viewer: Pick<StaffUser, "role">, member: TeamMember): boolean {
  return Boolean(member.disabledAt) && canManageTeam(viewer) && (member.role !== "owner" || viewer.role === "owner");
}

const staffEmail = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, INVITE_ERRORS.email)
  .pipe(z.email({ error: INVITE_ERRORS.email }))
  .refine((e) => isStaffEmail(e, staffEmailDomains(STAFF_DOMAIN)), INVITE_ERRORS.domain);

/** Normalised staff email or undefined (disable / restore take an email from a form). */
export function parseStaffEmail(value: unknown): string | undefined {
  const r = staffEmail.safeParse(value);
  return r.success ? r.data : undefined;
}

export type InviteParse =
  | { ok: true; email: string; role: StaffRole }
  | { ok: false; email: string; role: string; errors: { email?: string; role?: string } };

/** Validates the invite form for this viewer: a configured staff email and a role they may grant. */
export function parseInvite(viewer: Pick<StaffUser, "role">, input: { email: unknown; role: unknown }): InviteParse {
  const roles = assignableRoles(viewer);
  const schema = z.object({
    email: staffEmail,
    role: z.string().refine((r): r is StaffRole => (roles as string[]).includes(r), INVITE_ERRORS.role),
  });
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const role = typeof input.role === "string" ? input.role : "";
  const r = schema.safeParse({ email: input.email ?? "", role });
  if (r.success) return { ok: true, email: r.data.email, role: r.data.role as StaffRole };
  const errors: { email?: string; role?: string } = {};
  for (const issue of r.error.issues) {
    const key = issue.path[0];
    if ((key === "email" || key === "role") && !errors[key]) errors[key] = issue.message;
  }
  return { ok: false, email, role, errors };
}

const TZ = "Europe/Madrid";
const DAY_PARTS = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric" });

/** The Madrid calendar date of an instant, as a day number (UTC-epoch days of that Y-M-D): DST never shifts it. */
function madridDay(d: Date): { year: number; day: number } {
  const parts = Object.fromEntries(DAY_PARTS.formatToParts(d).map((p) => [p.type, p.value]));
  const year = Number(parts.year);
  return { year, day: Date.UTC(year, Number(parts.month) - 1, Number(parts.day)) / 86_400_000 };
}

/** "Now", "12 min ago", "Today 11:20", "Yesterday", "19 Oct" (another year: "19 Oct 2025"); Madrid time. */
export function formatLastActive(at: string | Date | null, now: Date): string {
  if (!at) return "Not signed in yet";
  const when = typeof at === "string" ? new Date(at) : at;
  const diff = now.getTime() - when.getTime();
  if (diff < 60_000) return "Now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  const a = madridDay(when);
  const b = madridDay(now);
  const days = b.day - a.day;
  if (days === 0) return `Today ${new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(when)}`;
  if (days === 1) return "Yesterday";
  const sameYear = a.year === b.year;
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(when);
}
