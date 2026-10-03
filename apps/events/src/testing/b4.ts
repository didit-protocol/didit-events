import { admissionService,eventService,type GuestPrincipal,type StaffPrincipal } from "@didit-events/core";
import { queryable } from "@didit-events/core/db/tx";
import type { Db } from "@didit-events/core/db";
import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,beforeEach,vi } from "vitest";
import type * as Access from "../auth/access";
type AccessModule = typeof Access;
import { resetDatabase,testDatabase } from "../../../../packages/core/src/testing/database.ts";
import { guestFixture,requestFixture,staffFixture } from "../../../../packages/core/src/testing/model.ts";

const stateAuth = vi.hoisted(() => ({ staff: null as StaffPrincipal | null, guest: null as GuestPrincipal | null }));
export const auth = stateAuth;
// Real browser guards are covered in auth/wiring.test.ts. Adapter tests exercise real services and DB writes.
vi.mock("../server/b4-policy", () => ({
  guardAction: async () => {}, appOrigin: () => "https://events.example.test",
  staffPrincipal: async () => { if (!stateAuth.staff) throw new Error("StaffSessionRequired"); return stateAuth.staff; },
  actionStaff: async () => stateAuth.staff && ({ ...stateAuth.staff, name: "Alberto", initials: "AR" }), guestPrincipal: async () => stateAuth.guest,
  staffRead: async () => { if (!stateAuth.staff) throw new Error("StaffSessionRequired"); return stateAuth.staff; },
}));
vi.mock("../auth/actions", () => ({ guardAction: async () => {}, requireGuest: async () => { if (!stateAuth.guest) throw new Error("SignInRequired"); return stateAuth.guest; }, isBodyTooLarge: () => false }));
vi.mock("../auth/access", async original => {
  const { redirect } = await import("next/navigation");
  const actual = await original<AccessModule>();
  const staff = (next = "/admin") => { if (!stateAuth.staff) redirect(`/admin/login?next=${encodeURIComponent(next)}`); return stateAuth.staff!; };
  const viewer = () => ({ kind: "staff" as const, staff: stateAuth.staff!, email: stateAuth.staff!.email });
  // The signed-in principal is the test's; the event lookup and the capability matrix stay real (core re-checks them too).
  return {
    ...actual,
    staffPage: async (next = "/admin") => staff(next),
    adminPage: async (next = "/admin") => { staff(next); return viewer(); },
    requireEventAccess: async (id: string, _capability: string, next = `/admin/events/${encodeURIComponent(id)}`) => staff(next),
    eventAccess: async (id: string, _capability: string, next = `/admin/events/${encodeURIComponent(id)}`) => { const actor = staff(next); const event = await actual.findEvent(id); if (!event) throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); return { actor, event, viewer: viewer() }; },
    findEventAccess: async (id: string, _capability: string, next = `/admin/events/${encodeURIComponent(id)}`) => { const actor = staff(next); const event = await actual.findEvent(id); return event ? { actor, event, viewer: viewer() } : null; },
    requireGlobalAccess: async (_capability: string, next = "/admin") => ({ actor: staff(next), viewer: viewer() }),
    requireStaffAccess: async (_capability: string, next = "/admin") => staff(next),
    // Route handlers keep the real Origin/CSRF/body guard; only the principal is the test's.
    routeEventAccess: async (req: Request, id: string, _capability: string, mutation?: { maxBytes?: number; contentType?: string }) => {
      const { guardBrowser } = await import("../auth/browser"), { PolicyError } = await import("@didit-events/core/http/policy");
      const body = mutation ? (await guardBrowser(req, mutation)).body : undefined;
      if (!stateAuth.staff) throw new PolicyError(401, "StaffSessionRequired");
      const event = await actual.findEvent(id); if (!event) throw new PolicyError(404, "EventNotFound");
      return { actor: stateAuth.staff, event, body };
    },
    guestPage: async (next: string) => { if (!stateAuth.guest) redirect(`/login?next=${encodeURIComponent(next)}`); return stateAuth.guest; },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
export function databaseSuite(options: { legacy?: boolean } = {}) {
  const state = { db: undefined as unknown as Db, eventId: "", otherId: "", registrationId: "", accountId: "" };
  let close: () => Promise<void>;
  const owner: StaffPrincipal = { principal: "staff", email: "events.owner@didit.me", role: "owner", sessionId: randomUUID() };
  beforeAll(async () => {
    const result = await testDatabase(process.env.TEST_DATABASE_URL ? "postgres" : "pglite"); state.db = result.db; close = result.close;
    (globalThis as typeof globalThis & { __diditEventsDb?: Db }).__diditEventsDb = state.db;
  }, 60000);
  afterAll(async () => { delete (globalThis as typeof globalThis & { __diditEventsDb?: Db }).__diditEventsDb; await close(); });
  beforeEach(async () => {
    auth.staff = owner; auth.guest = null;
    await resetDatabase(state.db);
    await staffFixture(state.db,owner);
    const input = { name: "Arbitrary event", startsAt: new Date(Date.now() + 48 * 3600000), endsAt: new Date(Date.now() + 52 * 3600000), capacity: 3,venue:"HQ",address:"One Street" };
    const event = await eventService.create(owner, { ...input, slug: "arbitrary" }); await eventService.publish(owner, event.id); state.eventId = event.id;
    const other = await eventService.create(owner, { ...input, slug: "second" }); await eventService.publish(owner, other.id); state.otherId = other.id;
    auth.guest=await guestFixture(state.db,"ana@example.test");state.accountId=auth.guest.accountId;
    if(options.legacy) {
      const q=queryable(state.db);
      await q.query("delete from evidence where account_id=$1",[state.accountId]);
      await q.query("delete from verifications where account_id=$1",[state.accountId]);
      const [r]=await q.query<{id:string}>("insert into registrations(account_id,event_id,admission,legacy_imported,policy_version,form_version) values($1,$2,'approved',true,1,1) returning id",[state.accountId,state.eventId]);
      state.registrationId=r!.id;
    } else state.registrationId = (await admissionService.apply(auth.guest, state.eventId,await requestFixture(state.db,auth.guest,state.eventId))).id;
  });
  return state;
}
