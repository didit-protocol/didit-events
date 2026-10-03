import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { queryable } from "../db/tx.ts";
import { resetDatabase, testDatabase } from "../testing/database.ts";
import { skipPostgres } from "../testing/postgres.ts";
import type { Db } from "../db/index.ts";
import { createIdentityServices } from "./index.ts";
import { accountStaffRole, staffForSession } from "./sessions.ts";
import { STAFF_SESSION_TTL_SECONDS, SESSION_TTL_SECONDS } from "./shared.ts";

const secret = "session-fixture-secret-over-thirty-two-characters";
for (const kind of ["pglite", "postgres"] as const) describe.skipIf(kind === "postgres" && skipPostgres)(`persistent account sessions ${kind}`, () => {
  let db: Db, close: () => Promise<void>, identity: ReturnType<typeof createIdentityServices>;
  const q = () => queryable(db);
  beforeAll(async () => { ({ db, close } = await testDatabase(kind)); }, 60000);
  beforeEach(async () => { await resetDatabase(db); identity = createIdentityServices({ db, secret }); });
  afterAll(async () => close?.());
  async function login(email = "guest@example.test") {
    const [account] = await q().query<{ id: string }>("insert into accounts(email) values($1) on conflict(email) do update set email=excluded.email returning id", [email]);
    return identity.sessions.rotate({ principal: "guest", accountId: account!.id, authMethod: "email_otp" });
  }
  const due = (id: string) => q().query("update sessions set created_at=clock_timestamp()-interval '2 days' where id=$1", [id]);
  const expireGrace = (id: string) => q().query("update sessions set rotated_at=clock_timestamp()-interval '31 seconds' where id=$1", [id]);
  it("rotates guest and staff account sessions only once per day, preserving authentication age and CSRF", async () => {
    await q().query("insert into staff(email,role) values('ops@didit.me','admin')");
    for (const email of ["guest@example.test", "ops@didit.me"]) {
      const first = await login(email); await due(first.session.id);
      expect(first.session.deliveredAt).toBeInstanceOf(Date);
      const second = (await identity.sessions.refresh(first.cookie))!;
      expect(second.cookie).toBeTruthy(); expect(second.session.principal).toBe("guest");
      expect(second.session.deliveredAt).toBeNull();
      expect(second.session.authenticatedAt).toEqual(first.session.authenticatedAt);
      expect(second.csrfToken).toBe(first.session.csrfToken);
      expect((second.session.expiresAt.getTime() - second.session.createdAt.getTime()) / 1000).toBeCloseTo(email.endsWith("@didit.me") ? STAFF_SESSION_TTL_SECONDS : SESSION_TTL_SECONDS, 0);
      expect((await identity.sessions.refresh(second.cookie!))?.cookie).toBeUndefined();
      expect(await identity.sessions.validCsrf(second.cookie!, second.csrfToken)).toBe(true);
      if (email.endsWith("@didit.me")) expect(await identity.auth.requireStaff(second.cookie!)).toMatchObject({ accountId: first.session.accountId, role: "admin" });
    }
  });
  it("parallel refresh requests receive exactly the same successor, and guards accept the old token during grace", async () => {
    const first = await login(); await due(first.session.id);
    const results = await Promise.all(Array.from({ length: 8 }, () => identity.sessions.refresh(first.cookie)));
    expect(results.every(Boolean)).toBe(true);
    expect(new Set(results.map(r => r?.cookie)).size).toBe(1);
    expect(new Set(results.map(r => r?.session.id)).size).toBe(1);
    expect(await q().query("select id,delivered_at from sessions where rotated_from=$1", [first.session.id])).toEqual([{ id: results[0]!.session.id, delivered_at: null }]);
    for (const result of results) expect(await identity.auth.requireGuest(result!.cookie!)).toMatchObject({ sessionId: result!.session.id });
    expect(await identity.auth.requireGuest(first.cookie)).toMatchObject({ sessionId: results[0]!.session.id });
  });
  it("recovers the same undelivered successor after grace until it is presented directly", async () => {
    const first = await login(); await due(first.session.id);
    const second = (await identity.sessions.refresh(first.cookie))!;
    expect(second.session.deliveredAt).toBeNull();
    expect(await identity.sessions.resolve(first.cookie)).toMatchObject({ id: second.session.id, deliveredAt: null });
    await expireGrace(first.session.id);
    // Even a daily rotation deadline must not advance a successor the client never received.
    await due(second.session.id);
    expect(await identity.sessions.resolve(first.cookie)).toMatchObject({ id: second.session.id, deliveredAt: null });
    expect(await identity.sessions.refresh(first.cookie)).toMatchObject({ cookie: second.cookie, csrfToken: second.csrfToken, session: { id: second.session.id, deliveredAt: null } });
    expect(await q().query("select id,delivered_at,revoked_at from sessions where rotated_from=$1", [first.session.id])).toEqual([{ id: second.session.id, delivered_at: null, revoked_at: null }]);
    expect(await q().query("select id from sessions where rotated_from=$1", [second.session.id])).toHaveLength(0);
    expect(await identity.sessions.resolve(second.cookie!)).toMatchObject({ id: second.session.id, deliveredAt: expect.any(Date) });
    expect(await identity.sessions.resolve(first.cookie)).toBeNull();
    expect(await identity.sessions.resolve(second.cookie!)).toBeNull();
    expect(await identity.sessions.refresh(first.cookie)).toBeNull();
    expect(await q().query("select id from sessions where id in ($1,$2) and revoked_at is null", [first.session.id, second.session.id])).toHaveLength(0);
  });
  it.each(["resolve", "refresh"] as const)("direct %s marks delivery once, so ancestor reuse after grace revokes the family", async method => {
    const first = await login(); await due(first.session.id);
    const second = (await identity.sessions.refresh(first.cookie))!;
    expect(await identity.sessions[method](second.cookie!)).not.toBeNull();
    const delivered = await q().query("select delivered_at::text from sessions where id=$1", [second.session.id]);
    expect(delivered).toEqual([{ delivered_at: expect.any(String) }]);
    expect(await identity.sessions[method](second.cookie!)).not.toBeNull();
    expect(await q().query("select delivered_at::text from sessions where id=$1", [second.session.id])).toEqual(delivered);
    await expireGrace(first.session.id);
    expect(await identity.sessions.resolve(first.cookie)).toBeNull();
    expect(await identity.sessions.resolve(second.cookie!)).toBeNull();
    expect(await q().query("select id from sessions where id in ($1,$2) and revoked_at is null", [first.session.id, second.session.id])).toHaveLength(0);
  });
  it("requests authorized just before rotation can finish during grace, but sign out fences them", async () => {
    await q().query("insert into staff(email,role) values('ops@didit.me','admin')");
    const first = await login("ops@didit.me");
    const principal = await identity.auth.requireGuest(first.cookie);
    await due(first.session.id);
    const second = (await identity.sessions.refresh(first.cookie))!;
    await identity.profile.preference(principal, true);
    expect(await staffForSession(q(), principal.sessionId)).toMatchObject({ email: "ops@didit.me" });
    await identity.sessions.revoke(second.session.id);
    expect(await staffForSession(q(), principal.sessionId)).toBeNull();
    await expect(identity.profile.preference(principal, false)).rejects.toMatchObject({ code: "SessionRequired" });
  });
  it("reuse after grace revokes all ancestors and descendants but leaves other devices signed in", async () => {
    const first = await login(), other = await login(); await due(first.session.id);
    const second = (await identity.sessions.refresh(first.cookie))!; await due(second.session.id);
    const third = (await identity.sessions.refresh(second.cookie!))!;
    await q().query("update sessions set rotated_at=clock_timestamp()-interval '31 seconds' where id=$1", [first.session.id]);
    expect(await identity.sessions.resolve(first.cookie)).toBeNull();
    expect(await identity.sessions.resolve(third.cookie!)).toBeNull();
    expect(await identity.sessions.resolve(second.cookie!)).toBeNull();
    expect(await identity.sessions.resolve(other.cookie)).not.toBeNull();
    expect(await q().query("select id from sessions where revoked_at is null")).toHaveLength(1);
  });
  it("revoke from any family member serializes against refresh and terminates site and staff access", async () => {
    await q().query("insert into staff(email,role) values('ops@didit.me','staff')");
    const first = await login("ops@didit.me"); await due(first.session.id);
    const [refreshed] = await Promise.all([identity.sessions.refresh(first.cookie), identity.sessions.revoke(first.session.id)]);
    expect(await identity.sessions.resolve(first.cookie)).toBeNull();
    if (refreshed?.cookie) {
      await expect(identity.auth.requireGuest(refreshed.cookie)).rejects.toMatchObject({ status: 401 });
      await expect(identity.auth.requireStaff(refreshed.cookie)).rejects.toMatchObject({ status: 401 });
    }
    expect(await q().query("select id from sessions where revoked_at is null")).toHaveLength(0);
  });
  it("all-devices sign out and deletion serialize with refresh without resurrecting sessions", async () => {
    const first = await login(), second = await login(); await due(first.session.id);
    const principal = await identity.auth.requireGuest(second.cookie);
    await Promise.all([identity.sessions.refresh(first.cookie), identity.sessions.revokeAll(principal)]);
    expect(await q().query("select id from sessions where revoked_at is null")).toHaveLength(0);
    const third = await login(); await due(third.session.id);
    await q().query("update accounts set deleting_at=clock_timestamp() where id=$1", [third.session.accountId]);
    expect(await identity.sessions.refresh(third.cookie)).toBeNull();
    await expect(identity.auth.requireGuest(third.cookie)).rejects.toMatchObject({ status: 401 });
  });
  it("role changes and disablement apply immediately; non-Didit staff rows never qualify", async () => {
    await q().query("insert into staff(email,role) values('ops@didit.me','staff'),('outside@example.test','owner')");
    const account = await login("ops@didit.me"), outside = await login("outside@example.test");
    const staff = await identity.auth.requireStaff(account.cookie);
    expect(staff.accountId).toBe(account.session.accountId);
    await expect(identity.auth.requireStaff(account.cookie, ["owner"])).rejects.toMatchObject({ status: 403 });
    expect(await accountStaffRole(q(), account.session.accountId!)).toBe("staff");
    await q().query("update staff set role='owner' where email='ops@didit.me'");
    expect(await identity.auth.requireStaff(account.cookie, ["owner"])).toMatchObject({ role: "owner" });
    await q().query("update staff set disabled_at=clock_timestamp() where email='ops@didit.me'");
    await expect(identity.auth.requireStaff(account.cookie)).rejects.toMatchObject({ status: 403 });
    expect(await accountStaffRole(q(), account.session.accountId!)).toBeUndefined();
    expect(await identity.auth.requireGuest(account.cookie)).toBeTruthy();
    await expect(identity.auth.requireStaff(outside.cookie)).rejects.toMatchObject({ status: 403 });
    expect(await staffForSession(q(), outside.session.id)).toBeNull();
    expect(await accountStaffRole(q(), outside.session.accountId!)).toBeUndefined();
    await expect(identity.auth.requireStaff("")).rejects.toMatchObject({ status: 401 });
  });
  it("old-code row and signed-cookie fixtures resume after deploy; legacy staff expires at its existing deadline", async () => {
    // Deliberately uses only pre-0019 (account sessions) columns and the old code's literal signing recipe.
    const token = randomBytes(32).toString("base64url");
    const cookie = `${token}.${createHmac("sha256", secret).update(`session\0${token}`).digest("base64url")}`;
    const tokenHash = createHash("sha256").update(token).digest("hex"), accountId = randomUUID();
    await q().query("insert into accounts(id,email) values($1,'old@example.test')", [accountId]);
    const [old] = await q().query<{ id: string }>(`insert into sessions(token_hash,principal,auth_method,account_id,created_at,expires_at)
      values($1,'guest','email_otp',$2,clock_timestamp()-interval '2 days',clock_timestamp()+interval '28 days') returning id`, [tokenHash, accountId]);
    expect(await identity.auth.requireGuest(cookie)).toMatchObject({ sessionId: old!.id, accountId });
    const migrated = (await identity.sessions.refresh(cookie))!;
    expect(await identity.auth.requireGuest(migrated.cookie!)).toMatchObject({ accountId });
    const legacyToken = randomBytes(32).toString("base64url");
    const legacyCookie = `${legacyToken}.${createHmac("sha256", secret).update(`session\0${legacyToken}`).digest("base64url")}`;
    await q().query("insert into staff(email,role) values('legacy@didit.me','admin')");
    await q().query(`insert into sessions(token_hash,principal,auth_method,staff_email,expires_at)
      values($1,'staff','oidc_google','legacy@didit.me',clock_timestamp()+interval '1 hour')`, [createHash("sha256").update(legacyToken).digest("hex")]);
    expect(await identity.auth.requireStaff(legacyCookie)).toMatchObject({ email: "legacy@didit.me", role: "admin" });
    expect((await identity.sessions.refresh(legacyCookie))?.cookie).toBeUndefined();
    await q().query("update sessions set expires_at=clock_timestamp()-interval '1 second' where principal='staff'");
    expect(await identity.sessions.resolve(legacyCookie)).toBeNull();
  });
  it.each([
    ["guest@example.test", 89, true], ["guest@example.test", 90, false],
    ["ops@didit.me", 29, true], ["ops@didit.me", 30, false],
  ])("enforces idle age for %s at %s days", async (email, days, live) => {
    await q().query("insert into staff(email,role) values('ops@didit.me','admin')");
    const first = await login(email), principal = await identity.auth.requireGuest(first.cookie);
    await q().query("update sessions set last_seen_at=clock_timestamp()-$2*interval '1 day' where id=$1", [first.session.id, days]);
    if (!live) {
      await expect(identity.profile.preference(principal, true)).rejects.toMatchObject({ code: "SessionRequired" });
      expect(await staffForSession(q(), first.session.id)).toBeNull();
    }
    const [before] = await q().query("select last_seen_at from sessions where id=$1", [first.session.id]);
    expect(!!await identity.sessions.resolve(first.cookie)).toBe(live);
    if (!live) expect(await q().query("select last_seen_at from sessions where id=$1", [first.session.id])).toEqual([before]);
    expect(!!await identity.sessions.refresh(first.cookie)).toBe(live);
  });
  it.each(["guest@example.test", "ops@didit.me"])("ordinary authenticated requests advance %s activity at most once an hour", async email => {
    await q().query("insert into staff(email,role) values('ops@didit.me','admin')");
    const first = await login(email);
    await q().query("update sessions set created_at=clock_timestamp()-interval '2 hours',last_seen_at=clock_timestamp()-interval '2 hours' where id=$1", [first.session.id]);
    const [before] = await q().query<{ last_seen_at: Date }>("select last_seen_at from sessions where id=$1", [first.session.id]);
    // requireGuest is the ordinary request guard; this path never calls refresh.
    await identity.auth.requireGuest(first.cookie);
    const [after] = await q().query<{ last_seen_at: Date }>("select last_seen_at from sessions where id=$1", [first.session.id]);
    expect(after!.last_seen_at.getTime()).toBeGreaterThan(before!.last_seen_at.getTime());
    for (let i = 0; i < 3; i++) expect((await identity.sessions.resolve(first.cookie))!.lastSeenAt).toEqual(after!.last_seen_at);
    expect(await q().query("select last_seen_at from sessions where id=$1", [first.session.id])).toEqual([after]);
    expect(await q().query("select id from sessions where rotated_from=$1", [first.session.id])).toEqual([]);
  });
  it.each([["guest@example.test", 400], ["ops@didit.me", 90]])("caps existing %s families despite a later stored expiry", async (email, days) => {
    await q().query("insert into staff(email,role) values('ops@didit.me','admin')");
    const first = await login(email);
    await q().query("update sessions set authenticated_at=clock_timestamp()-$2*interval '1 day',expires_at=clock_timestamp()+interval '400 days' where id=$1", [first.session.id, days]);
    expect(await identity.sessions.refresh(first.cookie)).toBeNull();
  });
  it("does not extend the absolute deadline on rotation", async () => {
    const first = await login(); await due(first.session.id);
    const second = (await identity.sessions.refresh(first.cookie))!;
    expect(second.session.expiresAt).toEqual(first.session.expiresAt);
  });
  it("retains rotated ancestors for reuse detection while their descendants are live", async () => {
    const first = await login(); await due(first.session.id);
    const second = (await identity.sessions.refresh(first.cookie))!;
    expect(await identity.sessions.resolve(second.cookie!)).not.toBeNull();
    await q().query("update sessions set expires_at=clock_timestamp()-interval '2 days',rotated_at=clock_timestamp()-interval '31 seconds' where id=$1", [first.session.id]);
    await identity.processDeletions();
    expect(await q().query("select id from sessions where id=$1", [first.session.id])).toHaveLength(1);
    expect(await identity.sessions.resolve(first.cookie)).toBeNull();
    expect(await identity.sessions.resolve(second.cookie!)).toBeNull();
  });
});
