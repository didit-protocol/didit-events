import { forbidden, notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getDb, queryable, type DomainEvent, type StaffPrincipal } from "@didit-events/core";
import { adminViewer, eventActor, globalActor, type AdminViewer } from "@didit-events/core/access/principal";
import type { EventCapability, GlobalCapability } from "@didit-events/core/access/capabilities";
import { camelRow } from "@didit-events/core/door/service";
import { COOKIE_NAMES, PolicyError, requestCookies } from "@didit-events/core/http/policy";
import { IdentityError } from "@didit-events/core/identity";
import { requireGuest, requireStaff } from "./actions";
import { appOrigin, guardBrowser } from "./browser";
import { identity } from "./runtime";
import { accountLinks, safeNext as guestNext } from "../accounts/links";
import { pendingDeletion } from "../accounts/deletion";
import { safeNext } from "../admin/login/signin";

/*
 * Admin authorization, one place. Every admin page, server action and API route names a capability from
 * @didit-events/core/access/capabilities (the single source of truth) through one of:
 *   requireEventAccess(idOrSlug, capability)        pages and server actions on one event
 *   requireGlobalAccess(capability)                  pages and server actions not about one event
 *   routeEventAccess(req, idOrSlug, capability)      route handlers on one event
 *   routeGlobalAccess(req, capability)               route handlers not about one event
 * Core services re-check the same capability inside their transaction (requireEventActor), so a page that forgot to
 * ask would still be refused by the write. `access.test.ts` asserts every admin route and action declares one.
 * Request-local checks: never cache a principal across page segments or actions.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Both URL slugs and stored UUIDs resolve here; an arbitrary URL segment is never cast to uuid. */
export async function findEvent(idOrSlug: string): Promise<DomainEvent | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(idOrSlug)) return null;
  const [row] = await queryable(getDb()).query(`select * from events where slug=$1 or id=$2::uuid
    order by (id=$2::uuid) desc nulls last limit 1`, [idOrSlug, UUID.test(idOrSlug) ? idOrSlug : null]);
  return row ? camelRow<DomainEvent>(row) : null;
}

async function sessionCookie() { return (await cookies()).get(COOKIE_NAMES.session)?.value ?? ""; }

/** Whoever may enter the admin (staff, or a member of at least one event team); else sign-in / forbidden. */
export async function adminPage(next = "/admin"): Promise<AdminViewer> {
  next = safeNext(next);
  try { return await adminViewer(await sessionCookie(), { identity }); }
  catch (error) {
    if (error instanceof IdentityError && error.status === 403) redirect(`/admin/forbidden?next=${encodeURIComponent(next)}`);
    if (error instanceof IdentityError && error.status === 401) redirect(accountLinks.login(next));
    throw error;
  }
}

/**
 * The actor for `capability` on one event, or a redirect: sign-in (401), forbidden (403, also for members asking
 * about an event that is not theirs or does not exist, so event ids cannot be probed) or 404 for staff.
 */
export async function requireEventAccess(idOrSlug: string, capability: EventCapability, next = `/admin/events/${encodeURIComponent(idOrSlug)}`): Promise<StaffPrincipal> {
  return (await eventAccess(idOrSlug, capability, next)).actor;
}
export async function eventAccess(idOrSlug: string, capability: EventCapability, next = `/admin/events/${encodeURIComponent(idOrSlug)}`): Promise<{ actor: StaffPrincipal; event: DomainEvent; viewer: AdminViewer }> {
  const viewer = await adminPage(next);
  const event = await findEvent(idOrSlug);
  if (!event) { if (viewer.kind === "staff") notFound(); forbidden(); }
  try { return { actor: eventActor(viewer, event!.id, capability), event: event!, viewer }; }
  catch (error) { if (error instanceof IdentityError && error.status === 403) forbidden(); throw error; }
}

/**
 * Like `eventAccess`, but an unknown event is `null` for staff (loaders that report "not found" themselves). Members
 * still get the forbidden page for events that are not theirs or do not exist.
 */
export async function findEventAccess(idOrSlug: string, capability: EventCapability, next = `/admin/events/${encodeURIComponent(idOrSlug)}`): Promise<{ actor: StaffPrincipal; event: DomainEvent; viewer: AdminViewer } | null> {
  const viewer = await adminPage(next);
  const event = await findEvent(idOrSlug);
  if (!event) { if (viewer.kind === "staff") return null; forbidden(); }
  try { return { actor: eventActor(viewer, event!.id, capability), event: event!, viewer }; }
  catch (error) { if (error instanceof IdentityError && error.status === 403) forbidden(); throw error; }
}

/** The global actor for `capability` (null for event members on capabilities they hold through an event), or forbidden. */
export async function requireGlobalAccess(capability: GlobalCapability, next = "/admin"): Promise<{ viewer: AdminViewer; actor: StaffPrincipal | null }> {
  const viewer = await adminPage(next);
  try { return { viewer, actor: globalActor(viewer, capability) }; }
  catch (error) { if (error instanceof IdentityError && error.status === 403) forbidden(); throw error; }
}

/** Global staff actor for staff-only capabilities (team, calendar, tokens, new events). */
export async function requireStaffAccess(capability: GlobalCapability, next = "/admin"): Promise<StaffPrincipal> {
  const { actor } = await requireGlobalAccess(capability, next);
  if (!actor) forbidden();
  return actor!;
}

/** Route handlers: browser callers only. Mutations also pass the Origin + CSRF guard. Errors are IdentityError/PolicyError. */
async function routeViewer(req: Request, mutation?: { maxBytes?: number; contentType?: string }): Promise<{ viewer: AdminViewer; body?: Uint8Array }> {
  if (["authorization", "x-signature", "x-signature-v2"].some(h => req.headers.has(h))) throw new PolicyError(403, "BrowserCallerRequired");
  if (mutation) {
    const proof = await guardBrowser(req, mutation);
    return { viewer: await adminViewer(proof.sessionCookie, { identity }), body: proof.body };
  }
  const expectedOrigin = appOrigin(), origin = req.headers.get("origin");
  if (origin && origin !== expectedOrigin) throw new PolicyError(403, "BrowserOriginRequired");
  return { viewer: await adminViewer(requestCookies(req).get(COOKIE_NAMES.session) ?? "", { identity }) };
}
export async function routeEventAccess(req: Request, idOrSlug: string, capability: EventCapability, mutation?: { maxBytes?: number; contentType?: string }): Promise<{ actor: StaffPrincipal; event: DomainEvent; body?: Uint8Array }> {
  const { viewer, body } = await routeViewer(req, mutation);
  const event = await findEvent(idOrSlug);
  if (!event) throw viewer.kind === "staff" ? new PolicyError(404, "EventNotFound") : new IdentityError("EventForbidden", 403);
  return { actor: eventActor(viewer, event.id, capability), event, body };
}
export async function routeGlobalAccess(req: Request, capability: GlobalCapability, mutation?: { maxBytes?: number; contentType?: string }): Promise<{ viewer: AdminViewer; actor: StaffPrincipal | null; body?: Uint8Array }> {
  const { viewer, body } = await routeViewer(req, mutation);
  return { viewer, actor: globalActor(viewer, capability), body };
}

/** Legacy global-staff guard. Admin routes use the capability helpers above; kept for non-admin callers. */
export async function staffPage(next = "/admin", roles?: readonly ("owner" | "admin" | "staff")[]) {
  next = safeNext(next);
  try { return await requireStaff(roles); }
  catch (error) {
    if (error instanceof IdentityError && error.status === 403) redirect(`/admin/forbidden?next=${encodeURIComponent(next)}`);
    if (error instanceof IdentityError && error.status === 401) redirect(accountLinks.login(next));
    throw error;
  }
}

export async function guestPage(next: string, maxAge?: number) {
  try { return await requireGuest(maxAge); }
  catch (error) {
    // v5: this browser's account is in its deletion grace period: offer "Keep my account" instead of a sign-in.
    if (error instanceof IdentityError && error.status === 401 && await pendingDeletion()) redirect(`/me/deleting?next=${encodeURIComponent(guestNext(next))}`);
    if (error instanceof IdentityError && [401, 403].includes(error.status)) redirect(accountLinks.login(next));
    throw error;
  }
}
