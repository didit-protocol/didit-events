import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/index.ts";
import { queryable } from "../db/tx.ts";
import type { StaffPrincipal } from "../domain/services.ts";
import { requireEventActor } from "../admission/shared.ts";
import { resetDatabase, seed, testDatabase } from "../testing/database.ts";
import { skipPostgres } from "../testing/postgres.ts";
import { can, capabilitiesOf, EVENT_CAPABILITIES, GLOBAL_CAPABILITIES, type AccessRole, type Capability, type EventCapability } from "./capabilities.ts";
import { eventActor, globalActor, type AdminViewer } from "./principal.ts";
import { EventTeam, membershipsFor } from "./team.ts";

/**
 * The matrix, written out a second time on purpose: a change to who may do what has to change both tables. Columns:
 * owner, admin, staff, host, operator.
 */
const EXPECTED: Record<Capability, [boolean, boolean, boolean, boolean, boolean]> = {
  "event.view": [true, true, true, true, true],
  "guests.view": [true, true, true, true, true],
  "guests.photo": [true, true, true, true, false],
  "guests.export": [true, true, true, true, false],
  "requests.decide": [true, true, true, true, false],
  "guests.invite": [true, true, true, true, false],
  "guests.verification": [true, true, true, true, false],
  "checkin.view": [true, true, true, true, true],
  "checkin.manual": [true, true, true, true, true],
  "door.operate": [true, true, true, true, true],
  "door.manage": [true, true, true, true, false],
  "door.pin": [true, true, true, false, false],
  "event.edit": [true, true, true, true, false],
  "event.emails": [true, true, true, true, false],
  "event.publish": [true, true, true, true, false],
  "event.danger": [true, true, true, false, false],
  "event.delete": [true, true, false, false, false],
  "event.limits": [true, true, true, false, false],
  "team.view": [true, true, true, true, false],
  "team.manage": [true, true, true, true, false],
  "admin.enter": [true, true, true, true, true],
  "events.create": [true, true, true, false, false],
  "staff.view": [true, true, true, false, false],
  "staff.manage": [true, true, false, false, false],
  "tokens.manage": [true, true, false, false, false],
  "calendar.view": [true, true, true, false, false],
  "calendar.edit": [true, true, false, false, false],
  "people.search": [true, true, true, false, false],
  "people.view": [true, false, false, false, false],
  "places.search": [true, true, true, true, false],
  "verifications.recover": [true, true, false, false, false],
  "emails.requeue": [true, false, false, false, false],
};
const ROLES: AccessRole[] = ["owner", "admin", "staff", "host", "operator"];
const EVENT_CAPS = Object.keys(EVENT_CAPABILITIES) as EventCapability[];

describe("capability matrix", () => {
  it("covers exactly the declared capabilities", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...Object.keys(EVENT_CAPABILITIES), ...Object.keys(GLOBAL_CAPABILITIES)].sort());
  });
  it.each(ROLES.map((role, i) => [role, i] as const))("%s holds exactly its column", (role, i) => {
    for (const [capability, row] of Object.entries(EXPECTED)) expect(can(role, capability as Capability), `${role} ${capability}`).toBe(row[i]);
    expect(capabilitiesOf(role).sort()).toEqual(Object.entries(EXPECTED).filter(([, row]) => row[i]).map(([c]) => c).sort());
  });
  it("refuses unknown roles and capabilities", () => {
    expect(can(null, "event.view")).toBe(false);
    expect(can("guest" as AccessRole, "event.view")).toBe(false);
    expect(can("owner", "kiosk.pair" as Capability)).toBe(false);
  });
  it("members get a scoped actor only on their own event; staff keep their principal", () => {
    const member: AdminViewer = { kind: "member", email: "op@example.test", guest: { principal: "guest", accountId: "a", sessionId: "s", authenticatedAt: new Date() }, memberships: [{ eventId: "e1", role: "operator" }] };
    expect(eventActor(member, "e1", "checkin.manual")).toMatchObject({ principal: "staff", email: "op@example.test", role: "staff", scope: { eventId: "e1", role: "operator" } });
    expect(() => eventActor(member, "e1", "requests.decide")).toThrow("EventForbidden");
    expect(() => eventActor(member, "e2", "event.view")).toThrow("EventForbidden");
    expect(() => globalActor(member, "events.create")).toThrow("StaffForbidden");
    expect(globalActor(member, "admin.enter")).toBeNull();
    const staff: AdminViewer = { kind: "staff", email: "s@didit.me", staff: { principal: "staff", email: "s@didit.me", role: "staff", sessionId: "x" } };
    expect(eventActor(staff, "e2", "event.danger")).toBe(staff.staff);
    expect(() => eventActor(staff, "e2", "event.delete")).toThrow();
  });
});

for (const kind of ["pglite", "postgres"] as const) describe.skipIf(kind === "postgres" && skipPostgres)(`requireEventActor ${kind}`, () => {
  let db: Db, close: () => Promise<void>;
  const q = () => queryable(db);
  beforeAll(async () => { ({ db, close } = await testDatabase(kind)); }, 60_000);
  afterAll(async () => { await close?.(); });
  beforeEach(async () => { await resetDatabase(db); });

  async function staff(role: "owner" | "admin" | "staff"): Promise<StaffPrincipal> {
    const email = `${role}-${randomUUID().slice(0, 6)}@didit.me`, sessionId = randomUUID();
    await q().query("insert into staff(email,role) values($1,$2)", [email, role]);
    await q().query("insert into sessions(id,token_hash,principal,auth_method,staff_email,expires_at) values($1,$2,'staff','oidc_google',$3,clock_timestamp()+interval '1 day')", [sessionId, randomUUID(), email]);
    return { principal: "staff", email, role, sessionId };
  }
  async function member(eventId: string, role: "host" | "operator"): Promise<StaffPrincipal> {
    const accountId = randomUUID(), sessionId = randomUUID(), email = `${role}-${accountId.slice(0, 6)}@example.test`;
    await q().query("insert into accounts (id,email,email_verified_at,email_proof_method,email_proof_ref) values ($1,$2,clock_timestamp(),'legacy_verified','fixture')", [accountId, email]);
    await q().query("insert into sessions(id,token_hash,principal,auth_method,account_id,expires_at) values($1,$2,'guest','email_otp',$3,clock_timestamp()+interval '1 day')", [sessionId, randomUUID(), accountId]);
    await q().query("insert into event_members(event_id,email,role,invited_by) values($1,$2,$3,'owner@didit.me')", [eventId, email, role]);
    return { principal: "staff", email, role: "staff", accountId, sessionId, scope: { eventId, role } };
  }
  const allowed = async (actor: StaffPrincipal, eventId: string, capability: EventCapability) => requireEventActor(q(), actor, eventId, capability).then(() => true, (e: Error) => { if (e.message !== "Forbidden") throw e; return false; });

  it("every role × every event capability, on its own event and on another one", async () => {
    const { eventId } = await seed(db), other = (await seed(db)).eventId;
    const actors: Record<AccessRole, StaffPrincipal> = { owner: await staff("owner"), admin: await staff("admin"), staff: await staff("staff"), host: await member(eventId, "host"), operator: await member(eventId, "operator") };
    for (const [i, role] of ROLES.entries()) for (const capability of EVENT_CAPS) {
      const expected = EXPECTED[capability][i];
      expect(await allowed(actors[role], eventId, capability), `${role} ${capability}`).toBe(expected);
      // Global staff reach every event; members never reach another one, not even by claiming its id.
      expect(await allowed(actors[role], other, capability), `${role} ${capability} other event`).toBe(role === "host" || role === "operator" ? false : expected);
      if (actors[role].scope) expect(await allowed({ ...actors[role], scope: { ...actors[role].scope!, eventId: other } }, other, capability), `${role} forged scope`).toBe(false);
    }
  });
  it("members fail closed: forged role, removed membership, ended session, deleted account, API tokens and plain requireActor", async () => {
    const { eventId } = await seed(db);
    const operator = await member(eventId, "operator");
    expect(await allowed({ ...operator, scope: { eventId, role: "host" } }, eventId, "requests.decide")).toBe(false);
    expect(await allowed({ ...operator, apiTokenId: randomUUID() }, eventId, "event.view")).toBe(false);
    const { requireActor } = await import("../admission/shared.ts");
    await expect(requireActor(q(), operator)).rejects.toThrow("Forbidden");
    await q().query("update sessions set revoked_at=clock_timestamp() where id=$1", [operator.sessionId]);
    expect(await allowed(operator, eventId, "event.view")).toBe(false);
    const host = await member(eventId, "host");
    await q().query("update event_members set revoked_at=clock_timestamp() where email=$1", [host.email]);
    expect(await allowed(host, eventId, "event.view")).toBe(false);
    const again = await member(eventId, "operator");
    await q().query("update accounts set deleting_at=clock_timestamp() where id=$1", [again.accountId]);
    expect(await allowed(again, eventId, "event.view")).toBe(false);
    // Slugs resolve to the same event.
    const fine = await member(eventId, "operator"), [row] = await q().query<{ slug: string }>("select slug from events where id=$1", [eventId]);
    expect(await allowed(fine, row!.slug, "event.view")).toBe(true);
  });
  it("team service: staff and hosts manage, operators don't; email normalised, staff addresses refused, removal ends doors", async () => {
    const { eventId, kioskId } = await seed(db), owner = await staff("owner"), team = new EventTeam(db);
    const added = await team.add(owner, eventId, " Ops@Example.TEST ", "operator");
    expect(added).toMatchObject({ created: true, member: { email: "ops@example.test", role: "operator", isStaff: false } });
    expect(await q().query("select payload->>'to' as to, payload->'data'->>'role' as role, payload->'data'->>'adminUrl' as url from outbox where kind='email:M-27'")).toEqual([{ to: "ops@example.test", role: "operator", url: `/admin/events/${eventId}` }]);
    expect(await team.add(owner, eventId, "ops@example.test", "operator")).toMatchObject({ created: false, roleChanged: false });
    expect(await team.add(owner, eventId, "ops@example.test", "host")).toMatchObject({ created: false, roleChanged: true, member: { role: "host" } });
    expect(await q().query("select count(*)::int n from outbox where kind='email:M-27'")).toEqual([{ n: 2 }]);
    await expect(team.add(owner, eventId, "someone@didit.me", "host")).resolves.toMatchObject({ created: true });
    await expect(team.add(owner, eventId, owner.email, "host")).rejects.toThrow("AlreadyStaff");
    await expect(team.add(owner, eventId, "not-an-email", "host")).rejects.toThrow("InvalidEmail");
    await expect(team.add(owner, eventId, "x@example.test", "admin")).rejects.toThrow("InvalidRole");
    const operator = await member(eventId, "operator");
    await expect(team.add(operator, eventId, "y@example.test", "operator")).rejects.toThrow("Forbidden");
    await expect(team.list(operator, eventId)).rejects.toThrow("Forbidden");
    const host = await member(eventId, "host");
    expect((await team.list(host, eventId)).map(m => m.email)).toContain(operator.email);
    await expect(team.remove(host, eventId, (await team.list(host, eventId)).find(m => m.email === host.email)!.id)).rejects.toThrow("CannotRemoveSelf");
    // Removing the operator ends the doors they started.
    await q().query("insert into door_sessions(event_id,kiosk_id,account_id,email,token_hash,expires_at) values($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour')", [eventId, kioskId, operator.accountId, operator.email, randomUUID()]);
    await team.remove(host, eventId, (await team.list(host, eventId)).find(m => m.email === operator.email)!.id);
    expect(await q().query("select ended_by from door_sessions")).toEqual([{ ended_by: `removed by ${host.email}` }]);
    expect(await membershipsFor(q(), operator.email)).toEqual([]);
    expect(await membershipsFor(q(), "OPS@example.test")).toEqual([{ eventId, role: "host" }]);
    for (let i = 0; i < 3; i++) await team.resend(owner, eventId, added.member.id);
    await expect(team.resend(owner, eventId, added.member.id)).rejects.toThrow("ResendLimited");
    expect(await q().query("select action from audit where action like 'team.%' order by created_at,id")).toEqual(expect.arrayContaining([{ action: "team.add" }, { action: "team.role" }, { action: "team.remove" }, { action: "team.resend" }]));
  });
});
