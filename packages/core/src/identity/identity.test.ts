import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import type { Db } from "../db/index.ts";
import { lockForDeletion,queryable,withTx } from "../db/tx.ts";
import { DiditClient } from "../didit/client.ts";
import { fakeDiditServer } from "../didit/fake-server.ts";
import type { ConsentInput } from "../domain/event-model.ts";
import type { GuestPrincipal } from "../domain/services.ts";
import { deferred,resetDatabase,testDatabase } from "../testing/database.ts";
import { createIdentityServices,validatePhoto } from "./index.ts";
import { hash } from "./shared.ts";
const consent: ConsentInput = {disclosureVersion:"events-profile-v2",shareProfileWithHosts:true,eventConsentAccepted:true,acceptedChecks:["face"]};

const kinds = ["pglite", ...(process.env.TEST_DATABASE_URL ? ["postgres"] : [])] as ("pglite" | "postgres")[];
for (const kind of kinds) describe(`B2 identity ${kind}`, () => {
  let db: Db, close: () => Promise<void>, fake: Awaited<ReturnType<typeof fakeDiditServer>>, identity: ReturnType<typeof createIdentityServices>;
  let beforeCheck: (() => Promise<void>) | undefined, beforeSend: (() => Promise<void>) | undefined;
  const q = () => queryable(db);
  beforeAll(async () => { ({ db, close } = await testDatabase(kind)); }, 60000);
  beforeEach(async () => {
    await fake?.close(); await resetDatabase(db); await q().query("truncate otp_challenges,otp_deliveries,oidc_transactions");
    beforeCheck = undefined; beforeSend = undefined;
    fake = await fakeDiditServer({ beforeCheck: () => beforeCheck?.() ?? Promise.resolve(), beforeSend: () => beforeSend?.() ?? Promise.resolve() });
    identity = createIdentityServices({ db, secret: "test-secret-that-is-over-thirty-two-characters", didit: new DiditClient({ apiKey: "local-fixture-only", fetch: fake.fetch }), totalCapUsd: 100, dailyCapUsd: 100 });
  });
  afterAll(async () => { await fake?.close(); await close?.(); });
  async function login(email = "guest@example.test", previousCookie?: string) {
    const challenge = await identity.auth.sendOtp(email, "127.0.0.1");
    return identity.auth.checkOtp(challenge.challengeId, "481903", { consent, otpCookie: challenge.cookie, previousCookie });
  }
  async function registration(principal: GuestPrincipal) {
    const event = randomUUID(), registration = randomUUID(), verification = randomUUID(), remote = randomUUID();
    await q().query("insert into events(id,slug,name,starts_at,ends_at,capacity,status) values($1::uuid,$1::text,'Fixture',clock_timestamp()+interval '1 day',clock_timestamp()+interval '2 days',10,'published')", [event]);
    await q().query("insert into registrations(legacy_imported,policy_version,form_version,id,event_id,account_id,admission) values(true,1,1,$1,$2,$3,'approved')", [registration, event, principal.accountId]);
    await q().query("insert into verifications(id,account_id,didit_session_id,workflow_id,vendor_data) values($1,$2,$3,$4,$5)", [verification, principal.accountId, remote, randomUUID(), `acct_${principal.accountId}`]);
    for (const kind of ["identity", "face"]) await q().query("insert into evidence(account_id,verification_id,kind,value,established_at,valid_until,activation,provider_status) values($1,$2,$3,case when $3::text='identity' then '{}'::jsonb else null end,clock_timestamp()-interval '1 day',clock_timestamp()+interval '90 days','active','approved')", [principal.accountId, verification, kind]);
    await q().query("insert into link_tokens(hash,registration_id,expires_at) values($1,$2,clock_timestamp()+interval '1 day')", [randomUUID(), registration]);
    return { event, registration, remote };
  }
  it("development staff login requires an enabled existing membership and is unavailable in production", async () => {
    vi.stubEnv("DEV_AUTH", "1"); vi.stubEnv("APP_URL", "http://localhost:3000"); vi.stubEnv("NODE_ENV", "test");
    try {
      await expect(identity.devStaffLogin("missing@didit.me")).rejects.toMatchObject({ status: 403 });
      await q().query("insert into staff(email,role) values('events.owner@didit.me','owner')");
      const result = await identity.devStaffLogin("events.owner@didit.me");
      expect(await identity.auth.requireStaff(result.cookie)).toMatchObject({ email: "events.owner@didit.me", principal: "staff", role: "owner" });
      await q().query("update staff set disabled_at=clock_timestamp() where email='events.owner@didit.me'");
      await expect(identity.devStaffLogin("events.owner@didit.me")).rejects.toMatchObject({ status: 403 });
      vi.stubEnv("NODE_ENV", "production");
      await expect(identity.devStaffLogin("events.owner@didit.me")).rejects.toMatchObject({ status: 404 });
    } finally { vi.unstubAllEnvs(); }
  });

  it("reserves $0.03 before the only paid send and redeems a browser-bound challenge", async () => {
    beforeSend = async () => { expect(await q().query("select id from spend where op='email_send' and usd_max_micros=30000 and dispatched_at is not null")).toHaveLength(1); };
    const challenge = await identity.auth.sendOtp(" GUEST@example.test ", "ip");
    await expect(identity.auth.checkOtp(challenge.challengeId, "481903", { consent, otpCookie: `${challenge.challengeId}.${"x".repeat(43)}` })).rejects.toThrow();
    expect(fake.counts.check).toBe(0);
    const result = await identity.auth.checkOtp(challenge.challengeId, "481903", { consent, otpCookie: challenge.cookie });
    expect((await identity.auth.requireGuest(result.cookie)).accountId).toBe(result.principal.accountId);
    expect(await q().query("select id from accounts where email='guest@example.test'")).toHaveLength(1);
    expect(await q().query("select id from otp_challenges where redeemed_at is not null")).toHaveLength(1);
    expect(fake.counts).toEqual({ send: 1, check: 1, delete: 0 });
    expect(fake.requests[1]!.body).toMatchObject({ enable_social: false, enable_enrichment: false });
  });
  it("wrong codes persist three attempts; a resend cannot reset the lockout", async () => {
    const c = await identity.auth.sendOtp("wrong@example.test", "ip");
    for (let i = 0; i < 3; i++) await expect(identity.auth.checkOtp(c.challengeId, "111111", { consent, otpCookie: c.cookie })).rejects.toMatchObject({ code: i === 2 ? "OtpLocked" : "OtpWrong" });
    await expect(identity.auth.checkOtp(c.challengeId, "481903", { consent, otpCookie: c.cookie })).rejects.toMatchObject({ code: "OtpLocked" });
    await expect(identity.auth.sendOtp("wrong@example.test", "ip", { cookie: c.cookie, resend: true })).rejects.toMatchObject({ code: "OtpRateLimited" });
    expect(await q().query("select id from accounts")).toHaveLength(0);
    expect((await q().query("select attempts from otp_challenges"))[0]!.attempts).toBe(3);
    expect(fake.counts).toEqual({ send: 1, check: 3, delete: 0 });
  });
  it("expired and mismatched provider request IDs never create accounts", async () => {
    const c = await identity.auth.sendOtp("expired@example.test", "ip");
    fake.mismatchRequest(true);
    await expect(identity.auth.checkOtp(c.challengeId, "481903", { consent, otpCookie: c.cookie })).rejects.toMatchObject({ code: "OtpWrong" });
    await q().query("update otp_challenges set expires_at=clock_timestamp()-interval '1 second'");
    await expect(identity.auth.checkOtp(c.challengeId, "481903", { consent, otpCookie: c.cookie })).rejects.toMatchObject({ code: "OtpExpired" });
    expect(fake.counts.check).toBe(1); expect(await q().query("select id from sessions")).toHaveLength(0);
  });
  it("maps the provider's HTTP-200 expired status without authenticating", async () => {
    const c = await identity.auth.sendOtp("expired@example.test", "ip"); fake.setCheckStatus("Expired or Not Found");
    await expect(identity.auth.checkOtp(c.challengeId, "481903", { consent, otpCookie: c.cookie })).rejects.toMatchObject({ code: "OtpExpired" });
    expect(fake.counts.check).toBe(1); expect(await q().query("select id from sessions")).toHaveLength(0);
  });
  it("preserves original expiry and attempts for the one allowed resend", async () => {
    const c = await identity.auth.sendOtp("resend@example.test", "ip");
    await expect(identity.auth.checkOtp(c.challengeId, "111111", { consent, otpCookie: c.cookie })).rejects.toThrow();
    await q().query("update otp_challenges set last_sent_at=clock_timestamp()-interval '31 seconds'");
    const resent = await identity.auth.sendOtp("resend@example.test", "ip", { cookie: c.cookie, resend: true });
    expect(resent.challengeId).toBe(c.challengeId); expect(resent.expiresAt).toEqual(c.expiresAt);
    expect((await q().query("select attempts,sends from otp_challenges"))[0]).toEqual({ attempts: 1, sends: 2 });
    await expect(identity.auth.sendOtp("resend@example.test", "ip", { cookie: c.cookie, resend: true })).rejects.toThrow();
    expect(fake.counts.send).toBe(2);
  });
  it("single atomic concurrent redemption dispatches only one provider check", async () => {
    const c = await identity.auth.sendOtp("race@example.test", "ip"), entered = deferred(), release = deferred();
    beforeCheck = async () => { entered.resolve(); await release.promise; };
    const first = identity.auth.checkOtp(c.challengeId, "481903", { consent, otpCookie: c.cookie }); await entered.promise;
    await expect(identity.auth.checkOtp(c.challengeId, "481903", { consent, otpCookie: c.cookie })).rejects.toThrow();
    release.resolve(); await first;
    expect(fake.counts.check).toBe(1); expect(await q().query("select id from sessions where revoked_at is null")).toHaveLength(1);
    await expect(identity.auth.checkOtp(c.challengeId, "481903", { consent, otpCookie: c.cookie })).rejects.toThrow();
    expect(fake.counts.check).toBe(1);
  });
  it("limits sends to five per email and twenty per IP before external calls", async () => {
    for (let i = 0; i < 5; i++) await identity.auth.sendOtp("limited@example.test", `ip-${i}`);
    await expect(identity.auth.sendOtp("limited@example.test", "another")).rejects.toMatchObject({ status: 429 });
    expect(fake.counts.send).toBe(5);
    for (let i = 0; i < 20; i++) await identity.auth.sendOtp(`email-${i}@example.test`, "one-ip");
    await expect(identity.auth.sendOtp("twentyone@example.test", "one-ip")).rejects.toMatchObject({ status: 429 });
    expect(fake.counts.send).toBe(25); expect(await q().query("select id from spend")).toHaveLength(25);
  });
  it.each(["existing", "unknown", "deleting", "tombstoned", "undeliverable"])("%s OTP sends and wrong-code responses have the same counters, attempts and expiry", async state => {
    const email = `${state}@example.test`, ip = `${state}-ip`;
    if (["existing", "deleting"].includes(state)) await q().query("insert into accounts(email,deleting_at) values($1,$2)", [email, state === "deleting" ? new Date() : null]);
    if (state === "tombstoned") await q().query("insert into deletions(email_hash,state,didit_session_ids) values($1,'manual','[]')", [hash(email)]);
    if (state === "undeliverable") fake.setSendStatus("Undeliverable");
    const synthetic = ["deleting", "tombstoned", "undeliverable"].includes(state);
    let sent!: Awaited<ReturnType<typeof identity.auth.sendOtp>>;
    for (let i = 0; i < 5; i++) {
      // Separate browser bindings also cover a provider Retry already owned by another browser.
      sent = await identity.auth.sendOtp(email, ip);
      expect(sent).toEqual({ challengeId: expect.any(String), cookie: expect.any(String), expiresAt: expect.any(Date) });
      const [row] = await q().query<{ ttl: number; attempts: number; redeemed_at: Date | null }>("select extract(epoch from (expires_at-created_at))::float8 as ttl,attempts,redeemed_at from otp_challenges where id=$1", [sent.challengeId]);
      expect(row).toMatchObject({ attempts: 0, redeemed_at: null });
      expect(row!.ttl).toBeGreaterThanOrEqual(299); expect(row!.ttl).toBeLessThan(305);
    }
    await expect(identity.auth.sendOtp(email, ip)).rejects.toMatchObject({ code: "OtpRateLimited", status: 429 });
    for (const [code, attemptsLeft] of [["OtpWrong", 2], ["OtpWrong", 1], ["OtpLocked", 0]] as const) {
      await expect(identity.auth.checkOtp(sent.challengeId, "111111", { consent, otpCookie: sent.cookie })).rejects.toMatchObject({ code, status: 400, attemptsLeft });
    }
    await expect(identity.auth.checkOtp(sent.challengeId, "481903", { consent, otpCookie: sent.cookie })).rejects.toMatchObject({ code: "OtpLocked", status: 400 });
    expect(await q().query("select value::int as value from counters where key=$1", [`otp:email:${hash(email)}`])).toEqual([{ value: 5 }]);
    expect(await q().query("select value::int as value from counters where key=$1", [`otp:ip:${hash(ip)}`])).toEqual([{ value: 6 }]);
    expect(await q().query("select attempts,check_token,redeemed_at from otp_challenges where id=$1", [sent.challengeId])).toEqual([{ attempts: 3, check_token: null, redeemed_at: null }]);
    expect(await q().query("select id from sessions")).toHaveLength(0);
    expect(fake.counts).toEqual({ send: ["deleting", "tombstoned"].includes(state) ? 0 : 5, check: synthetic ? 0 : 3, delete: 0 });
    expect(await q().query("select id from spend")).toHaveLength(["deleting", "tombstoned"].includes(state) ? 0 : 5);
  });
  it("synthetic resends preserve attempts and expiry, and expire without calling Didit", async () => {
    const email = "deleting@example.test";
    await q().query("insert into accounts(email,deleting_at) values($1,clock_timestamp())", [email]);
    const first = await identity.auth.sendOtp(email, "ip");
    await expect(identity.auth.checkOtp(first.challengeId, "481903", { consent, otpCookie: first.cookie })).rejects.toMatchObject({ code: "OtpWrong", attemptsLeft: 2 });
    await expect(identity.auth.sendOtp(email, "ip", { cookie: first.cookie, resend: true })).rejects.toMatchObject({ status: 429 });
    await q().query("update otp_challenges set last_sent_at=clock_timestamp()-interval '31 seconds'");
    const second = await identity.auth.sendOtp(email, "ip", { cookie: first.cookie, resend: true });
    expect(second).toEqual(first);
    expect(await q().query("select attempts,sends from otp_challenges")).toEqual([{ attempts: 1, sends: 2 }]);
    await q().query("update otp_challenges set expires_at=clock_timestamp()-interval '1 second'");
    await expect(identity.auth.checkOtp(first.challengeId, "481903", { consent, otpCookie: first.cookie })).rejects.toMatchObject({ code: "OtpExpired", status: 400 });
    expect(fake.counts).toEqual({ send: 0, check: 0, delete: 0 });
  });
  it("deleting addresses consume the shared IP limit before account-state branching", async () => {
    for (let i = 0; i < 21; i++) await q().query("insert into accounts(email,deleting_at) values($1,clock_timestamp())", [`deleted-${i}@example.test`]);
    for (let i = 0; i < 20; i++) await identity.auth.sendOtp(`deleted-${i}@example.test`, "one-ip");
    await expect(identity.auth.sendOtp("deleted-20@example.test", "one-ip")).rejects.toMatchObject({ status: 429 });
    expect(await q().query("select value::int as value from counters where key=$1", [`otp:ip:${hash("one-ip")}`])).toEqual([{ value: 20 }]);
    expect(await q().query("select id from otp_challenges")).toHaveLength(20);
    expect(fake.counts).toEqual({ send: 0, check: 0, delete: 0 });
  });
  if (kind === "postgres") it("concurrent synthetic sends cannot exceed the atomic per-email counter", async () => {
    const email = "deleting@example.test";
    await q().query("insert into accounts(email,deleting_at) values($1,clock_timestamp())", [email]);
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => identity.auth.sendOtp(email, `ip-${i}`)));
    const accepted = results.filter(result => result.status === "fulfilled");
    expect(accepted.length).toBeGreaterThan(0); expect(accepted.length).toBeLessThanOrEqual(5);
    for (const result of results) if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "OtpRateLimited", status: 429 });
    expect(await q().query("select value::int as value from counters where key=$1", [`otp:email:${hash(email)}`])).toEqual([{ value: 5 }]);
    expect(await q().query("select id from otp_challenges where synthetic")).toHaveLength(accepted.length);
    expect(await q().query("select id from spend")).toHaveLength(0);
    expect(fake.counts).toEqual({ send: 0, check: 0, delete: 0 });
  });
  it("budget exhaustion sends nothing and rolls back the spend reservation", async () => {
    const blocked = createIdentityServices({ db, secret: "s".repeat(40), didit: new DiditClient({ apiKey: "fixture", fetch: fake.fetch }), totalCapUsd: 0 });
    await expect(blocked.auth.sendOtp("budget@example.test", "ip")).rejects.toThrow("budget");
    expect(fake.counts.send).toBe(0); expect(await q().query("select id from spend")).toHaveLength(0);
  });
  it("session replacement, signature verification, no idle expiry and revocation", async () => {
    const first = await login();
    const second = await identity.sessions.rotate({ ...first.principal, authMethod: "email_otp" }, first.principal.sessionId);
    expect(await identity.sessions.resolve(first.cookie)).toBeNull();
    expect(await identity.sessions.resolve(second.cookie + "x")).toBeNull();
    expect(await identity.sessions.resolve(second.cookie)).toMatchObject({ id: second.session.id });
    await q().query("update sessions set last_seen_at=clock_timestamp()-interval '31 days' where id=$1", [second.session.id]);
    expect(await identity.sessions.resolve(second.cookie)).not.toBeNull();
    await identity.sessions.revoke(second.session.id);
    expect((await q().query("select id from sessions where revoked_at is not null"))).toHaveLength(2);
  });
  it("staff is derived from account email; disabling retains the account session", async () => {
    const guest = await login("events.owner@didit.me");
    await expect(identity.auth.requireStaff(guest.cookie)).rejects.toMatchObject({ status: 403 });
    await q().query("insert into staff(email,role) values('events.owner@didit.me','owner')");
    const owner = guest;
    const actor = await identity.auth.requireStaff(owner.cookie);
    await identity.auth.inviteStaff(actor, "colleague@didit.me", "staff");
    const colleague = await login("colleague@didit.me");
    await identity.auth.disableStaff(actor, "colleague@didit.me");
    expect(await identity.auth.requireGuest(colleague.cookie)).toMatchObject({ accountId: colleague.principal.accountId });
    await expect(identity.auth.requireStaff(colleague.cookie)).rejects.toMatchObject({ status: 403 });
    await expect(identity.auth.disableStaff(actor, actor.email)).rejects.toMatchObject({ code: "FinalOwner" });
    expect((await q().query("select id from sessions where revoked_at is not null"))).toHaveLength(0);
    expect(fake.counts).toEqual({ send: 2, check: 2, delete: 0 });
  });
  it("profile name edits preserve verified facts and persist profile/preferences", async () => {
    const loginResult = await login(); await registration(loginResult.principal);
    await identity.profile.updateProfile(loginResult.principal, { firstName: "Ana", lastName: "Ruiz", headline: "Guest" });
    await identity.profile.preference(loginResult.principal, true);
    expect(await identity.accounts.get(loginResult.principal.accountId)).toMatchObject({ firstName: "Ana", headline: "Guest", marketingOptIn: true });
    expect(await q().query("select kind from evidence where invalidated_at is not null")).toEqual([]);
    expect(await q().query("select kind from evidence where activation='active' order by kind")).toEqual([{ kind: "face" },{kind:"identity"}]);
  });
  it("staff has no idle timeout, while sensitive guest actions require fresh authentication", async () => {
    await q().query("insert into staff(email,role) values('owner@didit.me','owner')");
    const staff = await login("owner@didit.me");
    await q().query("update sessions set last_seen_at=clock_timestamp()-interval '13 hours' where id=$1", [staff.principal.sessionId]);
    expect(await identity.auth.requireStaff(staff.cookie)).toMatchObject({ role: "owner" });
    const guest = await login();
    await q().query("update sessions set authenticated_at=clock_timestamp()-interval '16 minutes' where id=$1", [guest.principal.sessionId]);
    await expect(identity.auth.requireGuest(guest.cookie, 900)).rejects.toMatchObject({ code: "FreshAuthenticationRequired" });
    expect(fake.counts.check).toBe(2);
  });
  it("concurrent owner disablement preserves one active owner and cannot trust a forged role", async () => {
    await q().query("insert into staff(email,role) values('one@didit.me','owner'),('two@didit.me','owner'),('helper@didit.me','staff')");
    const one = await login("one@didit.me");
    const two = await login("two@didit.me");
    const helper = await login("helper@didit.me");
    const first = await identity.auth.requireStaff(one.cookie), second = await identity.auth.requireStaff(two.cookie), low = await identity.auth.requireStaff(helper.cookie);
    await expect(identity.auth.inviteStaff({ ...low, role: "owner" }, "intruder@didit.me", "owner")).rejects.toMatchObject({ status: 403 });
    const results = await Promise.allSettled([identity.auth.disableStaff(first, first.email), identity.auth.disableStaff(second, second.email)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await q().query("select email from staff where role='owner' and disabled_at is null")).toHaveLength(1);
    expect(await q().query("select id from sessions where revoked_at is null")).toHaveLength(3);
    expect(fake.counts).toEqual({ send: 3, check: 3, delete: 0 });
  });
  it("deletion disables immediately, preserves tombstones for legacy erasure, then purges on confirmed erasure", async () => {
    const guest = await login(), r = await registration(guest.principal);
    const deletion = await identity.accounts.requestDeletion(guest.principal);
    expect(await identity.sessions.resolve(guest.cookie)).toBeNull(); expect(await identity.accounts.get(guest.principal.accountId)).toBeNull();
    expect(await q().query("select id from evidence where activation='active'")).toHaveLength(0);
    expect(await q().query("select admission,reason from registrations")).toEqual([{ admission: "cancelled_by_guest", reason: "account deleted" }]);
    expect(await q().query("select id from link_tokens where revoked_at is not null")).toHaveLength(1);
    expect(fake.counts.delete).toBe(0);
    fake.setDeletionStatus(204);
    expect(await identity.accounts.finishDeletion(deletion.id)).toMatchObject({ state: "manual" });
    expect(await q().query("select id from accounts")).toHaveLength(1);
    expect(await identity.profile.isTombstoned({ diditSessionId: r.remote })).toBe(true);
    await q().query("update deletions set state='pending' where id=$1", [deletion.id]); fake.setDeletionStatus(200);
    expect(await identity.accounts.finishDeletion(deletion.id)).toMatchObject({ state: "complete", accountId: null });
    expect(await q().query("select id from accounts")).toHaveLength(0);
    expect(await identity.profile.isTombstoned({ email: "guest@example.test" })).toBe(false);
    expect(await identity.profile.isTombstoned({ accountId: guest.principal.accountId })).toBe(true);
    expect(fake.counts.delete).toBe(4);
  });
  it("purges JSON-escaped email payloads literally, including backslashes and LIKE metacharacters", async () => {
    const email = "guest\\_%@example.test", guest = await login(email);
    const payloads = [
      ["target", { email }], ["nested", { recipient: { email } }],
      ["unrelated", { email: "guest\\aXX@example.test" }], ["unescaped", { email: "guest_%@example.test" }],
    ] as const;
    for (const [dedupe, payload] of payloads) await q().query("insert into outbox(kind,dedupe_key,payload) values('fixture',$1,$2::jsonb)", [dedupe, JSON.stringify(payload)]);
    const deletion = await identity.accounts.requestDeletion(guest.principal);
    expect(await identity.accounts.finishDeletion(deletion.id)).toMatchObject({ state: "complete" });
    expect(await q().query("select dedupe_key,payload,status from outbox where dedupe_key in ('nested','target','unrelated','unescaped') order by dedupe_key")).toEqual([
      { dedupe_key: "nested", payload: null, status: "sent" },
      { dedupe_key: "target", payload: null, status: "sent" },
      { dedupe_key: "unescaped", payload: payloads[3][1], status: "pending" },
      { dedupe_key: "unrelated", payload: payloads[2][1], status: "pending" },
    ]);
    expect(await q().query("select id from accounts")).toHaveLength(0);
    expect(await identity.profile.isTombstoned({ email })).toBe(false);
    expect(fake.counts).toEqual({ send: 1, check: 1, delete: 1 });
  });
  it("a completed deletion permits a new OTP account without any old data, and can be deleted again", async () => {
    const old = await login(), r = await registration(old.principal);
    await identity.profile.updateProfile(old.principal, { firstName: "Old", lastName: "Profile", bio: "private old bio" });
    const deletion = await identity.accounts.requestDeletion(old.principal);
    await identity.accounts.finishDeletion(deletion.id);
    const fresh = await login();
    expect(fresh.isNew).toBe(true); expect(fresh.principal.accountId).not.toBe(old.principal.accountId);
    expect(await identity.accounts.get(fresh.principal.accountId)).toMatchObject({ firstName: null, bio: null, photo: null });
    for (const table of ["registrations", "evidence", "account_identities"]) expect(await q().query(`select * from ${table} where account_id=$1`, [fresh.principal.accountId])).toHaveLength(0);
    expect(await identity.sessions.resolve(old.cookie)).toBeNull();
    expect(await identity.profile.isTombstoned({ email: "guest@example.test" })).toBe(false);
    expect(await identity.profile.isTombstoned({ accountId: old.principal.accountId })).toBe(true);
    expect(await identity.profile.isTombstoned({ diditSessionId: r.remote })).toBe(true);
    expect(await q().query("select email_hash,original_account_id from deletions")).toEqual([{ email_hash: null, original_account_id: old.principal.accountId }]);
    const next = await identity.accounts.requestDeletion(fresh.principal);
    await identity.accounts.finishDeletion(next.id);
    expect(await q().query("select id from deletions where state='complete' and email_hash is null")).toHaveLength(2);
    expect(fake.counts).toEqual({ send: 2, check: 2, delete: 3 });
  });
  it.each(["pending", "remote_pending", "manual"])("%s deletion returns a neutral OTP result before any spend or Didit send", async state => {
    const old = await login(), deletion = await identity.accounts.requestDeletion(old.principal);
    await q().query("update deletions set state=$2 where id=$1", [deletion.id, state]);
    const sent = await identity.auth.sendOtp(" GUEST@example.test ", "new-ip");
    expect(sent).toEqual({ challengeId: expect.any(String), cookie: expect.any(String), expiresAt: expect.any(Date) });
    expect(sent.cookie).toMatch(new RegExp(`^${sent.challengeId}\\.`));
    expect(sent.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(fake.counts).toEqual({ send: 1, check: 1, delete: 0 });
    expect(await q().query("select id from spend")).toHaveLength(2); // OTP plus the immediate face operation.
    expect(await q().query("select id from otp_challenges where id=$1 and synthetic", [sent.challengeId])).toHaveLength(1);
    await expect(identity.auth.checkOtp(sent.challengeId, "481903", { consent, otpCookie: sent.cookie })).rejects.toThrow();
    expect(fake.counts.check).toBe(1);
    expect(await q().query("select id from accounts")).toEqual([{ id: old.principal.accountId }]);
  });
  it("retains a manual tombstone when a provider verification creation may still be in flight", async () => {
    const guest = await login();
    await q().query("insert into verification_ops(account_id,workflow_id,kind,expires_at,vendor_data,email_at_creation) values($1::uuid,$2,'full',clock_timestamp()+interval '1 day','acct_'||$1::text,'guest@example.test')", [guest.principal.accountId, randomUUID()]);
    const deletion = await identity.accounts.requestDeletion(guest.principal);
    expect(await identity.accounts.finishDeletion(deletion.id)).toMatchObject({ state: "manual", manualReason: "verification_creation_in_flight" });
    expect(await q().query("select id from accounts where deleting_at is not null")).toHaveLength(1);
    expect(await q().query("select state from verification_ops")).toEqual([{ state: "expired" },{state:"expired"}]);
    expect(fake.counts.delete).toBe(1);
  });
  it("stores only a valid 512px JPEG and rejects a false size header without changing the photo", async () => {
    const guest = await login(), photo = new Uint8Array(await readFile(new URL("./fixtures/photo.jpg", import.meta.url)));
    await identity.profile.savePhoto(guest.principal, photo);
    const account = await identity.accounts.get(guest.principal.accountId);
    const stored=new Uint8Array(account!.photo!); validatePhoto(stored); expect(stored).not.toEqual(photo); expect(account!.photoUrl).toBe("/api/me/photo");
    const small = photo.slice(); const sof = small.findIndex((byte, i) => byte === 255 && small[i + 1] === 192); expect(sof).toBeGreaterThan(0);
    small[sof + 5] = 1;
    await expect(identity.profile.savePhoto(guest.principal, small)).rejects.toThrow("InvalidPhoto");
    expect(new Uint8Array((await identity.accounts.get(guest.principal.accountId))!.photo!)).toEqual(stored);
  });
  it("deletion wins while an OTP provider check is in flight; no account restoration", async () => {
    const guest = await login();
    fake.challenges.get("guest@example.test")!.expired = true;
    const challenge = await identity.auth.sendOtp("guest@example.test", "ip"), entered = deferred(), release = deferred();
    beforeCheck = async () => { entered.resolve(); await release.promise; };
    const result = identity.auth.checkOtp(challenge.challengeId, "481903", { consent, otpCookie: challenge.cookie });
    const assertion = expect(result).rejects.toMatchObject({ code: "AccountUnavailable" });
    await entered.promise; const deletion = await identity.accounts.requestDeletion(guest.principal); await identity.accounts.finishDeletion(deletion.id);
    release.resolve(); await assertion;
    expect(await q().query("select id from accounts")).toHaveLength(0); expect(await q().query("select id from sessions")).toHaveLength(0);
    expect(fake.counts).toEqual({ send: 2, check: 2, delete: 1 });
  });
  it("redemption committed first is revoked by the subsequent deletion", async () => {
    const guest = await login(); await identity.accounts.requestDeletion(guest.principal);
    expect(await q().query("select id from sessions where revoked_at is null")).toHaveLength(0);
    expect(await q().query("select id from accounts where deleting_at is not null")).toHaveLength(1);
    expect(fake.counts.check).toBe(1);
  });
  if (kind === "postgres") it("OTP redemption blocks on the C22 account lock and rechecks deletion after acquiring it", async () => {
    const guest = await login(), locked = deferred(), release = deferred();
    fake.challenges.get("guest@example.test")!.expired = true;
    const c = await identity.auth.sendOtp("guest@example.test", "ip");
    const deletion = withTx(async tx => { await lockForDeletion(tx, guest.principal.accountId); locked.resolve(); await release.promise; await tx.query("update accounts set deleting_at=clock_timestamp() where id=$1", [guest.principal.accountId]); }, db);
    await locked.promise;
    const checked = deferred(); beforeCheck = async () => { checked.resolve(); };
    const check = identity.auth.checkOtp(c.challengeId, "481903", { consent, otpCookie: c.cookie }); const assertion = expect(check).rejects.toMatchObject({ code: "AccountUnavailable" });
    await checked.promise; release.resolve(); await deletion; await assertion;
    expect(await q().query("select id from sessions")).toHaveLength(1); expect(fake.counts.check).toBe(2);
  });
  it("the identity worker cleans expired sessions, OTP records and OIDC state", async () => {
    await login();
    await q().query("update sessions set expires_at=clock_timestamp()-interval '2 days'");
    await q().query("update otp_challenges set expires_at=clock_timestamp()-interval '2 days'");
    await q().query("insert into oidc_transactions(state_hash,expires_at) values('expired',clock_timestamp()-interval '2 days'),('live',clock_timestamp()+interval '5 minutes')");
    await q().query("insert into otp_deliveries(email_hash,owner,lease_until) values('expired',$1,clock_timestamp()-interval '2 days')", [randomUUID()]);
    await identity.processDeletions();
    for (const table of ["sessions", "otp_challenges", "otp_deliveries"]) expect(await q().query(`select * from ${table}`)).toHaveLength(0);
    expect(await q().query("select state_hash from oidc_transactions")).toEqual([{ state_hash: "live" }]);
    expect(await q().query("select id from accounts")).toHaveLength(1);
    expect(fake.counts).toEqual({ send: 1, check: 1, delete: 0 });
  });
  it("DEV_AUTH is inert in production even when enabled", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("DEV_AUTH", "1"); vi.stubEnv("APP_URL", "http://localhost:3000");
    try { await expect(identity.devLogin("dev@example.test")).rejects.toMatchObject({ status: 404 }); }
    finally { vi.unstubAllEnvs(); }
    expect(await q().query("select id from accounts")).toHaveLength(0); expect(fake.counts.send).toBe(0);
  });
  it("dev login marks the email as verified, so the join flow asks for no code", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("DEV_AUTH", "1"); vi.stubEnv("APP_URL", "http://localhost:3000");
    try { await identity.devLogin("dev@example.test"); await identity.devLogin("dev@example.test"); }
    finally { vi.unstubAllEnvs(); }
    const rows = await q().query<{ verified: boolean; email_proof_method: string; email_proof_ref: string }>("select email_verified_at<=clock_timestamp() as verified,email_proof_method,email_proof_ref from accounts where email='dev@example.test'");
    expect(rows).toEqual([{ verified: true, email_proof_method: "legacy_verified", email_proof_ref: "dev-login" }]);
    expect(fake.counts.send).toBe(0);
  });
  it("dev login refuses a non-localhost APP_URL even outside production", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("DEV_AUTH", "1");
    try {
      for (const url of ["https://events.didit.me", "https://localhost.evil.test", "", "not a url"]) {
        vi.stubEnv("APP_URL", url);
        await expect(identity.devLogin("guest@example.test")).rejects.toMatchObject({ status: 404 });
        await expect(identity.devStaffLogin("guest@example.test")).rejects.toMatchObject({ status: 404 });
      }
    } finally { vi.unstubAllEnvs(); }
  });

  it("production never verifies an email through dev login, with or without DEV_AUTH", async () => {
    await q().query("insert into accounts(id,email) values($1,'dev@example.test')", [randomUUID()]);
    for (const flag of ["1", ""]) {
      vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("DEV_AUTH", flag); vi.stubEnv("APP_URL", "http://localhost:3000");
      try {
        await expect(identity.devLogin("dev@example.test")).rejects.toMatchObject({ status: 404 });
        await expect(identity.devStaffLogin("dev@example.test")).rejects.toMatchObject({ status: 404 });
      } finally { vi.unstubAllEnvs(); }
    }
    expect(await q().query("select email_verified_at,email_proof_method from accounts")).toEqual([{ email_verified_at: null, email_proof_method: null }]);
    expect(await q().query("select id from sessions")).toHaveLength(0);
  });
});
it("photo validation rejects undersized, oversized and non-JPEG uploads", () => {
  expect(() => validatePhoto(new Uint8Array(300 * 1024 + 1))).toThrow();
  expect(() => validatePhoto(new Uint8Array([255, 216, 255, 217]))).toThrow();
});
