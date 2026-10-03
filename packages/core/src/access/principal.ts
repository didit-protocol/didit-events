import type { Db } from "../db/index.ts";
import { getDb } from "../db/index.ts";
import { queryable } from "../db/tx.ts";
import type { GuestPrincipal,StaffPrincipal } from "../domain/services.ts";
import { identity as defaultIdentity,IdentityError } from "../identity/index.ts";
import { can,type EventCapability,type EventRole,type GlobalCapability } from "./capabilities.ts";
import { membershipsFor,type Membership } from "./team.ts";

/** Whoever is signed in to the admin: global staff, or an account with at least one event membership. */
export type AdminViewer =
  | { kind: "staff"; staff: StaffPrincipal; email: string }
  | { kind: "member"; guest: GuestPrincipal; email: string; memberships: Membership[] };

type Identity = Pick<typeof defaultIdentity, "auth" | "accounts"> & { db?: () => Db };

/** 401 without a session; 403 for a signed-in account that is neither staff nor on any event team. Read on every request. */
export async function adminViewer(cookie: string, options: { identity?: Identity; db?: Db } = {}): Promise<AdminViewer> {
  const ident = options.identity ?? defaultIdentity;
  try {
    const staff = await ident.auth.requireStaff(cookie);
    return { kind: "staff", staff, email: staff.email };
  } catch (error) {
    if (!(error instanceof IdentityError) || error.status !== 403) throw error;
  }
  let guest: GuestPrincipal;
  try { guest = await ident.auth.requireGuest(cookie); }
  catch { throw new IdentityError("AdminForbidden", 403); }
  const account = await ident.accounts.get(guest.accountId);
  if (!account) throw new IdentityError("AdminForbidden", 403);
  const memberships = await membershipsFor(queryable(options.db ?? ident.db?.() ?? getDb()), account.email);
  if (!memberships.length) throw new IdentityError("AdminForbidden", 403);
  return { kind: "member", guest, email: account.email, memberships };
}

/** The viewer's role on one event (staff keep their global role), or null. */
export function roleOn(viewer: AdminViewer, eventId: string): StaffPrincipal["role"] | EventRole | null {
  if (viewer.kind === "staff") return viewer.staff.role;
  return viewer.memberships.find(m => m.eventId === eventId)?.role ?? null;
}

/**
 * The actor core services receive for `capability` on `eventId` (a stored UUID), or a 403. Members get a scoped
 * actor; core re-checks the membership row and session inside its own transaction (`requireEventActor`).
 */
export function eventActor(viewer: AdminViewer, eventId: string, capability: EventCapability): StaffPrincipal {
  const role = roleOn(viewer, eventId);
  if (!can(role, capability)) throw new IdentityError("EventForbidden", 403);
  if (viewer.kind === "staff") return viewer.staff;
  return { principal: "staff", email: viewer.email, role: "staff", accountId: viewer.guest.accountId, sessionId: viewer.guest.sessionId, authenticatedAt: viewer.guest.authenticatedAt, scope: { eventId, role: role as EventRole } };
}

/** Global staff actor for `capability`, or a 403 (event members never hold global capabilities except entering the admin). */
export function globalActor(viewer: AdminViewer, capability: GlobalCapability): StaffPrincipal | null {
  if (viewer.kind === "staff") {
    if (!can(viewer.staff.role, capability)) throw new IdentityError("StaffForbidden", 403);
    return viewer.staff;
  }
  if (!viewer.memberships.some(m => can(m.role, capability))) throw new IdentityError("StaffForbidden", 403);
  return null;
}
