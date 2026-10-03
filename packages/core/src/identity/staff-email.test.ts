import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import type { Db } from "../db/index.ts";
import { queryable } from "../db/tx.ts";
import { DiditClient } from "../didit/client.ts";
import { fakeDiditServer } from "../didit/fake-server.ts";
import type { ConsentInput } from "../domain/event-model.ts";
import { resetDatabase,testDatabase } from "../testing/database.ts";
import { createIdentityServices } from "./index.ts";
const consent:ConsentInput={disclosureVersion:"events-profile-v2",shareProfileWithHosts:true,eventConsentAccepted:true,acceptedChecks:["face"]};

const CODE = "481903";
const kinds = ["pglite", ...(process.env.TEST_DATABASE_URL ? ["postgres"] : [])] as ("pglite" | "postgres")[];
for (const kind of kinds) describe(`staff email sign-in ${kind}`, () => {
  let db: Db, close: () => Promise<void>, fake: Awaited<ReturnType<typeof fakeDiditServer>>, identity: ReturnType<typeof createIdentityServices>;
  const q = () => queryable(db);
  const staff = (email: string, role = "admin", disabled = false) =>
    q().query("insert into staff(email,role,disabled_at) values($1,$2,$3)", [email, role, disabled ? new Date() : null]);
  beforeAll(async () => { ({ db, close } = await testDatabase(kind)); }, 60000);
  beforeEach(async () => {
    await fake?.close(); await resetDatabase(db); await q().query("truncate otp_challenges,otp_deliveries,oidc_transactions,sessions");
    fake = await fakeDiditServer();
    identity = createIdentityServices({ db, secret: "test-secret-that-is-over-thirty-two-characters", didit: new DiditClient({ apiKey: "local-fixture-only", fetch: fake.fetch }), totalCapUsd: 100, dailyCapUsd: 100 });
  });
  afterAll(async () => { await fake?.close(); await close?.(); });

  it("an enabled @didit.me staff member gets a real code and an account session like the Google path", async () => {
    await staff("ops@didit.me", "admin");
    const sent = await identity.auth.sendStaffOtp(" OPS@didit.me ", "ip");
    expect(fake.counts.send).toBe(1);
    const [row] = await q().query<{ purpose: string; synthetic: boolean; ttl: number }>("select purpose,synthetic,extract(epoch from (expires_at-created_at))::float8 as ttl from otp_challenges where id=$1", [sent.challengeId]);
    expect(row).toMatchObject({ purpose: "staff_login", synthetic: false });
    expect(row!.ttl).toBeCloseTo(300, 0);

    const result = await identity.auth.checkStaffOtp(sent.challengeId, CODE, { consent, otpCookie: sent.cookie, email: "ops@didit.me" });
    expect(result.principal).toMatchObject({ principal: "guest" });
    expect(await identity.auth.requireStaff(result.cookie)).toMatchObject({ principal: "staff", email: "ops@didit.me", role: "admin", sessionId: result.principal.sessionId });
    const [session] = await q().query<{ ttl: number; auth_method: string; principal: string; account_id: string | null }>("select extract(epoch from (expires_at-created_at))::float8 as ttl,auth_method,principal,account_id from sessions where id=$1", [result.principal.sessionId]);
    expect(session).toMatchObject({ auth_method: "email_otp", principal: "guest", account_id: result.principal.accountId });
    expect(session!.ttl).toBeCloseTo(90 * 86400, 0);
    // Staff actions that re-read the session (team management) accept it.
    await expect(identity.auth.inviteStaff(await identity.auth.requireStaff(result.cookie), "new@didit.me", "staff")).resolves.toMatchObject({ email: "new@didit.me" });
    // The verified email owns the account.
    expect(await q().query("select id from accounts")).toHaveLength(1);
  });

  it.each([
    ["non-staff @didit.me", "nobody@didit.me", async () => {}],
    ["disabled staff", "gone@didit.me", async () => { await staff("gone@didit.me", "admin", true); }],
    ["non-didit address", "guest@example.test", async () => {}],
  ])("%s can sign in as an account without staff privileges", async (_label, email, setup) => {
    await setup();
    const sent = await identity.auth.sendStaffOtp(email, "ip");
    const result = await identity.auth.checkStaffOtp(sent.challengeId, CODE, { consent, otpCookie: sent.cookie });
    expect(await identity.auth.requireGuest(result.cookie)).toMatchObject({ accountId: result.principal.accountId });
    await expect(identity.auth.requireStaff(result.cookie)).rejects.toMatchObject({ status: 403 });
  });

  it("disablement after sending still permits account login but denies staff access", async () => {
    await staff("late@didit.me");
    const sent = await identity.auth.sendStaffOtp("late@didit.me", "ip");
    await q().query("update staff set disabled_at=clock_timestamp() where email='late@didit.me'");
    const result = await identity.auth.checkStaffOtp(sent.challengeId, CODE, { consent, otpCookie: sent.cookie });
    await expect(identity.auth.requireStaff(result.cookie)).rejects.toMatchObject({ status: 403 });
    expect(await identity.auth.requireGuest(result.cookie)).toBeTruthy();
  });

  it("a code is single use and expires like the guest code", async () => {
    await staff("ops@didit.me");
    const sent = await identity.auth.sendStaffOtp("ops@didit.me", "ip");
    await identity.auth.checkStaffOtp(sent.challengeId, CODE, { consent, otpCookie: sent.cookie });
    await expect(identity.auth.checkStaffOtp(sent.challengeId, CODE, { consent, otpCookie: sent.cookie })).rejects.toMatchObject({ code: "OtpExpired" });
    expect(await q().query("select id from sessions")).toHaveLength(1);

    const second = await identity.auth.sendStaffOtp("ops@didit.me", "ip");
    await q().query("update otp_challenges set expires_at=clock_timestamp()-interval '1 second' where id=$1", [second.challengeId]);
    await expect(identity.auth.checkStaffOtp(second.challengeId, CODE, { consent, otpCookie: second.cookie })).rejects.toMatchObject({ code: "OtpExpired" });
    expect(await q().query("select id from sessions")).toHaveLength(1);
  });

  it("wrong codes lock the challenge after three attempts", async () => {
    await staff("ops@didit.me");
    const sent = await identity.auth.sendStaffOtp("ops@didit.me", "ip");
    for (let i = 0; i < 3; i++) await expect(identity.auth.checkStaffOtp(sent.challengeId, "111111", { consent, otpCookie: sent.cookie })).rejects.toMatchObject({ code: i === 2 ? "OtpLocked" : "OtpWrong" });
    await expect(identity.auth.checkStaffOtp(sent.challengeId, CODE, { consent, otpCookie: sent.cookie })).rejects.toMatchObject({ code: "OtpLocked" });
    expect(await q().query("select id from sessions")).toHaveLength(0);
  });

  it("staff and guest challenges never cross over", async () => {
    await staff("ops@didit.me");
    const staffChallenge = await identity.auth.sendStaffOtp("ops@didit.me", "ip");
    await expect(identity.auth.checkOtp(staffChallenge.challengeId, CODE, { consent, otpCookie: staffChallenge.cookie })).rejects.toMatchObject({ code: "OtpExpired" });
    const guestChallenge = await identity.auth.sendOtp("ops@didit.me", "ip");
    await expect(identity.auth.checkStaffOtp(guestChallenge.challengeId, CODE, { consent, otpCookie: guestChallenge.cookie })).rejects.toMatchObject({ code: "OtpExpired" });
    expect(await q().query("select id from sessions")).toHaveLength(0);
    expect(await q().query("select id from accounts")).toHaveLength(0);
  });

  it("sends are rate limited per address with the guest limits", async () => {
    await staff("ops@didit.me");
    for (let i = 0; i < 5; i++) await identity.auth.sendStaffOtp("ops@didit.me", `ip-${i}`);
    await expect(identity.auth.sendStaffOtp("ops@didit.me", "ip-x")).rejects.toMatchObject({ code: "OtpRateLimited", status: 429 });
    // Unknown addresses hit the same wall, so the limit does not reveal staff access either.
    for (let i = 0; i < 5; i++) await identity.auth.sendStaffOtp("nobody@didit.me", `ip-n${i}`);
    await expect(identity.auth.sendStaffOtp("nobody@didit.me", "ip-y")).rejects.toMatchObject({ code: "OtpRateLimited", status: 429 });
    expect(fake.counts.send).toBe(10);
  });

  it("a staff email session replaces the browser's previous session", async () => {
    vi.stubEnv("DEV_AUTH", "1"); vi.stubEnv("APP_URL", "http://localhost:3000"); vi.stubEnv("NODE_ENV", "test");
    try {
      await staff("ops@didit.me");
      const previous = await identity.devLogin("someone@example.test");
      const sent = await identity.auth.sendStaffOtp("ops@didit.me", "ip");
      const result = await identity.auth.checkStaffOtp(sent.challengeId, CODE, { consent, otpCookie: sent.cookie, previousCookie: previous.cookie });
      await expect(identity.auth.requireGuest(previous.cookie)).rejects.toThrow();
      expect((await identity.auth.requireStaff(result.cookie)).email).toBe("ops@didit.me");
    } finally { vi.unstubAllEnvs(); }
  });
});
