/** What each staff role can do, in plain words. Pure data (client-safe): the admin Team page and the T-01 invite
 *  email read the same lines. Every line mirrors a server check: staff = requireActor default roles (admission/shared.ts),
 *  kiosk + check-in = staffAllowed (door/service.ts), admin = the ["owner","admin"] gates, owner = OwnerRequired (identity/team.ts). */
export type StaffRoleName = "owner" | "admin" | "staff";

export const ROLE_ORDER = ["owner", "admin", "staff"] as const satisfies readonly StaffRoleName[];

export const ROLE_LABEL: Record<StaffRoleName, string> = { owner: "Owner", admin: "Admin", staff: "Staff" };

/** One line for the Role select hint and the ROLE cell tooltip. */
export const ROLE_SUMMARY: Record<StaffRoleName, string> = {
  owner: "Full access, including other owners.",
  admin: "Runs events and manages the team, except owners.",
  staff: "Runs events, guests, kiosks and check-in.",
};

export const ROLE_CAN: Record<StaffRoleName, readonly string[]> = {
  owner: [
    "Everything an admin can do",
    "Invite new owners",
    "Disable, restore or change the role of other owners",
    "The last active owner can’t be disabled or demoted",
  ],
  admin: [
    "Everything staff can do",
    "Invite teammates as admin or staff",
    "Disable and restore access for admins and staff",
    "Approve guests over capacity",
    "Delete events and recover verifications",
  ],
  staff: [
    "Create, edit, publish, end or cancel events",
    "Approve, waitlist or reject guests, and send invites",
    "Pair, rename, pause and remove kiosks",
    "Check guests in by hand and undo check-ins",
    "See the team list",
  ],
};
