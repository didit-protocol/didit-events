import { createHash,randomBytes,randomUUID } from "node:crypto";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import type { Db } from "../db/index.ts";
import { lockAccount,lockForDecision,queryable,withTx } from "../db/tx.ts";
import { DiditClient } from "../didit/client.ts";
import { fakeDiditServer } from "../didit/fake-server.ts";
import type { FaceMatch } from "../didit/types.ts";
import type { DoorIdentity,StaffPrincipal } from "../domain/services.ts";
import { deferred,resetDatabase,seed,testDatabase } from "../testing/database.ts";
import { skipPostgres } from "../testing/postgres.ts";
import { DEVICE_SCANS_PER_WINDOW,Door,doorOutcome,hashPin,STRICT_LIVENESS_MIN_FACE_PX,verifyPin } from "./service.ts";

const JPEG = new Uint8Array([255, 216, 255, 224, 1, 2, 3]);
// The fake answers in-process; a starved CI host must not turn the provider timeout into a spurious "error" result.
const NO_LOAD_TIMEOUTS = { timeoutMs: 60_000, faceTimeoutMs: 60_000 };
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const match = (sessionId: string, score = 98): FaceMatch => ({ session_id: sessionId, similarity_percentage: score, is_blocklisted: false, api_service: null, status: "Approved" });
for (const kind of ["pglite", "postgres"] as const) describe.skipIf(kind === "postgres" && skipPostgres)(`B3 ${kind}`, () => {
  let db: Db, close: () => Promise<void>, fake: Awaited<ReturnType<typeof fakeDiditServer>>, door: Door, actor: StaffPrincipal, starter: { accountId: string; email: string; sessionId: string };
  const q = () => queryable(db);
  const count = async (table: string) => Number((await q().query<{ n: number }>(`select count(*)::int as n from ${table}`))[0]!.n);
  /** A running door (station + door session) started by `starter` (an admin with an account), as the browser presents it. */
  async function kiosk(eventId: string, id = randomUUID(), by = starter) {
    const token = randomBytes(32).toString("base64url");
    await q().query("insert into kiosks(id,event_id,name) values($1,$2,'Door') on conflict(id) do nothing", [id, eventId]);
    const [session] = await q().query<{ id: string }>(`insert into door_sessions(event_id,kiosk_id,account_id,email,token_hash,expires_at)
      values($1,$2,$3,$4,$5,clock_timestamp()+interval '16 hours') returning id`, [eventId, id, by.accountId, by.email, digest(token)]);
    return { token, device: { principal: "door", eventId, kioskId: id, doorSessionId: session!.id, accountId: by.accountId, email: by.email } satisfies DoorIdentity };
  }
  /** An event team member with a live guest session, as the admin passes them to core (scoped actor). */
  async function member(eventId: string, role: "host" | "operator") {
    const accountId = randomUUID(), sessionId = randomUUID(), email = `${role}-${accountId.slice(0, 8)}@example.test`;
    await q().query("insert into accounts (id,email,email_verified_at,email_proof_method,email_proof_ref) values ($1,$2,clock_timestamp(),'legacy_verified','fixture')", [accountId, email]);
    await q().query("insert into sessions(id,token_hash,principal,auth_method,account_id,expires_at) values($1,$2,'guest','email_otp',$3,clock_timestamp()+interval '1 day')", [sessionId, randomUUID(), accountId]);
    await q().query("insert into event_members(event_id,email,role,invited_by) values($1,$2,$3,'door@didit.me')", [eventId, email, role]);
    return { principal: "staff", email, role: "staff", accountId, sessionId, scope: { eventId, role } } satisfies StaffPrincipal;
  }
  async function person() {
    const ids = await seed(db), verificationId = randomUUID(), sessionId = randomUUID(), faceEvidenceId = randomUUID();
    await q().query("update accounts set first_name='Fixture',last_name='Guest' where id=$1", [ids.accountId]);
    await q().query("insert into verifications(id,account_id,didit_session_id,workflow_id,vendor_data,status) values($1,$2,$3,$4,$5,'approved')", [verificationId, ids.accountId, sessionId, randomUUID(), `acct_${ids.accountId}`]);
    for (const evidenceKind of ["face", "identity"]) await q().query(`insert into evidence(id,account_id,verification_id,kind,value,established_at,valid_until,provider_status,activation)
      values($1,$2,$3,$4,case when $4::text='identity' then '{}'::jsonb else null end,clock_timestamp()-interval '1 day',clock_timestamp()+interval '90 days','approved','active')`, [evidenceKind === "face" ? faceEvidenceId : randomUUID(), ids.accountId, verificationId, evidenceKind]);
    return { ...ids, ...await kiosk(ids.eventId, ids.kioskId), sessionId, faceEvidenceId, verificationId };
  }
  beforeAll(async () => { ({ db, close } = await testDatabase(kind)); fake = await fakeDiditServer(); }, 60_000);
  afterAll(async () => { await fake?.close(); await close?.(); });
  afterEach(() => { vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.restoreAllMocks(); await resetDatabase(db);
    fake.state.matches = []; fake.state.liveness = "Approved"; fake.state.searchStatus = 200; fake.state.calls = { search: 0, liveness: 0 }; fake.state.saved = 0; fake.state.beforeResponse = undefined;
    fake.state.warnings=[];fake.state.imageCases.clear();fake.state.images=[];
    actor = { principal: "staff", email: "door@didit.me", role: "admin", sessionId: randomUUID() };
    await q().query("insert into staff(email,role) values($1,'admin')", [actor.email]);
    await q().query("insert into sessions(id,token_hash,principal,auth_method,staff_email,expires_at) values($1,$2,'staff','oidc_google',$3,clock_timestamp()+interval '1 day')", [actor.sessionId, randomUUID(), actor.email]);
    // The same admin with an account session: door sessions need an account to start.
    starter = { accountId: randomUUID(), email: actor.email, sessionId: randomUUID() };
    await q().query("insert into accounts (id,email,email_verified_at,email_proof_method,email_proof_ref) values ($1,$2,clock_timestamp(),'legacy_verified','fixture')", [starter.accountId, starter.email]);
    await q().query("insert into sessions(id,token_hash,principal,auth_method,account_id,expires_at) values($1,$2,'guest','oidc_google',$3,clock_timestamp()+interval '1 day')", [starter.sessionId, randomUUID(), starter.accountId]);
    door = new Door({ db, didit: new DiditClient({ apiKey: "test-only", fetch: fake.fetch, ...NO_LOAD_TIMEOUTS }), appUrl: "https://events.example" });
  });
  it("door mode: start needs door.operate and an account; the token resolves only for its event while the starter keeps access", async () => {
    const p = await person(), other = await person();
    await expect(door.startSession(actor, p.eventId, "Main door")).rejects.toMatchObject({ status: 409, message: "AccountSessionRequired" });
    const admin: StaffPrincipal = { ...actor, accountId: starter.accountId, sessionId: starter.sessionId };
    await expect(door.startSession(admin, p.eventId, " ")).rejects.toMatchObject({ message: "InvalidStation" });
    const started = await door.startSession(admin, p.eventId, "  Main   door ");
    expect(started.station).toBe("Main door");
    expect(Buffer.from(started.token, "base64url")).toHaveLength(32);
    expect(await q().query("select token_hash from door_sessions where id=$1", [started.door.doorSessionId])).toEqual([{ token_hash: digest(started.token) }]);
    // A second device with the same station name reuses the station (one row in the check-in log's door filter).
    const again = await door.startSession(admin, p.eventId, "main door");
    expect(again.door.kioskId).toBe(started.door.kioskId);
    expect((await door.resolveSession(started.token, p.eventId)).doorSessionId).toBe(started.door.doorSessionId);
    await expect(door.resolveSession(started.token, other.eventId)).rejects.toMatchObject({ status: 403, message: "DoorSessionOtherEvent" });
    await expect(door.resolveSession(randomBytes(32).toString("base64url"))).rejects.toMatchObject({ status: 401 });
    // An operator of another event cannot start this door; an operator of this one can.
    await expect(door.startSession(await member(other.eventId, "operator"), p.eventId, "Door")).rejects.toMatchObject({ status: 403 });
    const operator = await member(p.eventId, "operator");
    const mine = await door.startSession(operator, p.eventId, "Side door");
    // Removing the operator from the team ends their door on the next request.
    await q().query("update event_members set revoked_at=clock_timestamp() where email=$1", [operator.email]);
    await expect(door.resolveSession(mine.token, p.eventId)).rejects.toMatchObject({ status: 401, message: "DoorAccessRevoked" });
    await q().query("update door_sessions set expires_at=clock_timestamp()-interval '1 second' where id=$1", [started.door.doorSessionId]);
    await expect(door.resolveSession(started.token, p.eventId)).rejects.toMatchObject({ status: 401, message: "DoorSessionExpired" });
    await door.endSessionById(actor, p.eventId, again.door.doorSessionId);
    await expect(door.resolveSession(again.token, p.eventId)).rejects.toMatchObject({ status: 401, message: "DoorSessionEnded" });
    await expect(door.scan(again.door, JPEG)).rejects.toMatchObject({ status: 401 });
    // Face check-in off: the door cannot start (the launcher says so).
    await q().query("update events set door='{\"kiosk\":false}'::jsonb where id=$1", [other.eventId]);
    await expect(door.startSession(admin, other.eventId, "Door")).rejects.toMatchObject({ status: 409, message: "FaceCheckinOff" });
    expect(fake.state.calls).toEqual({ search: 0, liveness: 0 });
  });
  it("sends a pseudonymous operator ID to face search and retains DB audit linkage", async () => {
    const p = await person();
    const client = new DiditClient({ apiKey: "test-only", fetch: fake.fetch, ...NO_LOAD_TIMEOUTS });
    const spy = vi.spyOn(client, "faceSearch");
    const service = new Door({ db, didit: client, appUrl: "https://events.example" });
    await service.scan(p.device, JPEG, { test: true });
    expect(spy).toHaveBeenCalled();
    const options = spy.mock.calls[0]![2];
    expect(options).toMatchObject({ metadata: { operatorId: starter.accountId, doorSessionId: p.device.doorSessionId } });
    expect(JSON.stringify(options)).not.toContain(starter.email);
    expect(await q().query("select account_id,email from door_sessions where id=$1", [p.device.doorSessionId])).toEqual([{ account_id: starter.accountId, email: starter.email }]);
  });
  it("PIN: requires six digits for new PINs, enforces shared budgets and exponential cooldown", async () => {
    const p = await person();
    for (const pin of ["12", "1234", "12345"]) await expect(door.setPin(actor, p.eventId, pin)).rejects.toMatchObject({ message: "InvalidPin" });
    await expect(door.setPin(await member(p.eventId, "host"), p.eventId, "246810")).rejects.toMatchObject({ status: 403 });
    await expect(door.endSessionWithPin(p.device, "246810")).rejects.toMatchObject({ status: 409, message: "PinNotSet" });
    await door.setPin(actor, p.eventId, "246810");
    const [row] = await q().query<{ pin_hash: string }>("select pin_hash from door_pins");
    expect(row!.pin_hash).not.toContain("246810"); expect(await verifyPin("246810", row!.pin_hash)).toBe(true);
    for (let i = 0; i < 3; i++) {
      await q().query("update counters set expires_at=clock_timestamp()-interval '1 second' where key like 'door:pin:cooldown:%'");
      await expect(door.endSessionWithPin(p.device, "111111", "127.0.0.1")).rejects.toMatchObject({ status: 403, message: "WrongPin" });
      const [cooldown] = await q().query<{ seconds: number }>("select extract(epoch from expires_at-clock_timestamp())::float as seconds from counters where key like 'door:pin:cooldown:%'");
      expect(cooldown!.seconds).toBeGreaterThan(2 ** i - 1);
    }
    const next = await kiosk(p.eventId);
    await expect(door.endSessionWithPin(next.device, "246810", "another-ip")).rejects.toMatchObject({ status: 429, retryAfter: expect.any(Number) });
    await q().query("update counters set expires_at=clock_timestamp()-interval '1 second' where key like 'door:pin:cooldown:%'");
    await door.endSessionWithPin(p.device, "246810", "127.0.0.1");
    await expect(door.resolveSession(p.token)).rejects.toMatchObject({ message: "DoorSessionEnded" });
    await expect(door.endSessionWithPin(next.device, "246810", "fresh-ip")).rejects.toMatchObject({ status: 429 });
    expect(await q().query("select action from audit where action like 'door.%' order by created_at")).toEqual([{ action: "door.pin_set" }, { action: "door.end_pin" }]);
  });
  it.each(["1234", "12345"])("accepts the legacy %s PIN until changed", async pin => {
    const p = await person();
    await q().query("insert into door_pins(event_id,pin_hash,set_by) values($1,$2,$3)", [p.eventId, await hashPin(pin), actor.email]);
    await door.endSessionWithPin(p.device, pin);
    await expect(door.resolveSession(p.token)).rejects.toMatchObject({ message: "DoorSessionEnded" });
    await expect(door.setPin(actor, p.eventId, pin)).rejects.toMatchObject({ message: "InvalidPin" });
  });
  it("shares the IP budget across different events", async () => {
    const p = await person(), other = await person();
    await door.setPin(actor, p.eventId, "246810"); await door.setPin(actor, other.eventId, "246810");
    for (let i = 0; i < 5; i++) await door.endSessionWithPin(p.device, "000000", "shared-ip").catch(() => undefined);
    await expect(door.endSessionWithPin(other.device, "246810", "shared-ip")).rejects.toMatchObject({ status: 429 });
  });
  it.each(["before start", "after end", "cancelled", "live"] as const)("Test mode %s runs real recognition and writes no check-in, welcome or count", async when => {
    const p = await person(); fake.state.matches = [match(p.sessionId)];
    if (when === "before start") await q().query("update events set status='published',starts_at=clock_timestamp()+interval '1 day',ends_at=clock_timestamp()+interval '2 days' where id=$1", [p.eventId]);
    if (when === "after end") await q().query("update events set starts_at=clock_timestamp()-interval '3 hours',ends_at=clock_timestamp()-interval '1 hour' where id=$1", [p.eventId]);
    if (when === "cancelled") await q().query("update events set status='cancelled' where id=$1", [p.eventId]);
    const context = await door.context(p.device);
    expect(context.state).toBe(when === "before start" ? "not_started" : when === "after end" ? "ended" : when === "cancelled" ? "cancelled" : "live");
    // Outside Test mode a closed door makes no provider call.
    if (when !== "live") { expect((await door.scan(p.device, JPEG)).result).toBe("paused"); expect(fake.state.calls.search).toBe(0); }
    const result = await door.scan(p.device, JPEG, { test: true });
    expect(result.result).toBe("welcomed");
    expect(await door.scanView(result, p.eventId, true)).toMatchObject({ result: "welcomed", test: true, checkedInAt: null, firstName: "Fixture" });
    expect(await count("checkins")).toBe(0); expect(await count("outbox")).toBe(0);
    expect(await q().query("select result,test from scans where test")).toEqual([{ result: "welcomed", test: true }]);
    expect((await door.context(p.device)).arrived).toBe(0);
    expect((await door.context(p.device)).recentScans[0]).toMatchObject({ result: "welcomed", test: true });
    expect(fake.state.calls.search).toBe(1);
  });
  it("Test mode answers would-be outcomes: not approved (declined, withdrawn) and already checked in", async () => {
    const p = await person(); fake.state.matches = [match(p.sessionId)];
    await q().query("update registrations set admission='rejected' where id=$1", [p.registrationId]);
    const rejected = await door.scan(p.device, JPEG, { test: true });
    expect(await door.scanView(rejected, p.eventId, true)).toMatchObject({ result: "not_admitted", admission: "rejected", test: true });
    await q().query("update registrations set admission='cancelled_by_guest' where id=$1", [p.registrationId]);
    await q().query(`insert into admission_history(registration_id,"from","to",actor) values($1,'pending','cancelled_by_guest','guest')`, [p.registrationId]);
    await new Promise(resolve => setTimeout(resolve, 1250));
    const withdrawn = await door.scan(p.device, JPEG, { test: true });
    expect(await door.scanView(withdrawn, p.eventId, true)).toMatchObject({ result: "not_admitted", admission: "withdrawn" });
    await q().query("update registrations set admission='approved' where id=$1", [p.registrationId]);
    await door.manualCheckin(actor, p.registrationId, "At the desk");
    await new Promise(resolve => setTimeout(resolve, 1250));
    expect((await door.scan(p.device, JPEG, { test: true })).result).toBe("welcome_back");
    expect(await count("checkins")).toBe(1); expect(await count("outbox")).toBe(1);
  });
  it("event roles: operators check in by hand on their event only; hosts too; nobody else", async () => {
    const p = await person(), other = await person();
    const operator = await member(p.eventId, "operator");
    await expect(door.manualCheckin(await member(other.eventId, "host"), p.registrationId, "Desk")).rejects.toMatchObject({ status: 403 });
    await expect(door.manualCheckin({ ...operator, scope: { eventId: other.eventId, role: "operator" } }, p.registrationId, "Desk")).rejects.toMatchObject({ status: 403 });
    const done = await door.manualCheckin(operator, p.registrationId, "Photo ID at the desk");
    expect(await q().query("select by_staff from checkins")).toEqual([{ by_staff: operator.email }]);
    await door.undoCheckin(await member(p.eventId, "host"), done.checkinId, "Wrong guest");
    // A removed member's session no longer acts.
    await q().query("update event_members set revoked_at=clock_timestamp() where email=$1", [operator.email]);
    await expect(door.manualCheckin(operator, p.registrationId, "Again")).rejects.toMatchObject({ status: 403 });
    // Manual check-in outside the live window says why.
    await q().query("update events set status='published',starts_at=clock_timestamp()+interval '1 day',ends_at=clock_timestamp()+interval '2 days' where id=$1", [p.eventId]);
    await expect(door.manualCheckin(actor, p.registrationId, "Early")).rejects.toMatchObject({ status: 409, message: "EventNotLive" });
  });
  it.each(["welcomed", "welcome_back", "unknown", "ambiguous", "not_on_list", "not_admitted", "not_verified", "inconclusive", "withdrawn", "other_event", "no_face", "paused", "error"] as const)("persists resolution %s and enforces external-call count", async branch => {
    const p = await person(); fake.state.matches = [match(p.sessionId)];
    if (branch === "welcome_back") await door.manualCheckin(actor, p.registrationId, "Staff verified this guest");
    if (branch === "unknown") fake.state.matches = [match(randomUUID())];
    if (branch === "ambiguous") { const other = await person(); fake.state.matches.push(match(other.sessionId, 95)); }
    if (branch === "not_on_list") await q().query("delete from registrations where id=$1", [p.registrationId]);
    if (branch === "not_admitted") await q().query("update registrations set admission='waitlisted' where id=$1", [p.registrationId]);
    if (branch === "not_verified") await q().query("update accounts set email_verified_at=null,email_proof_method=null,email_proof_ref=null where id=$1", [p.accountId]);
    if (branch === "withdrawn") await q().query("update evidence set invalidated_at=clock_timestamp(),provider_status='withdrawn' where id=$1", [p.faceEvidenceId]);
    if (branch === "other_event") { const other = await person(); fake.state.matches = [match(other.sessionId)]; }
    // A full page of one guest's enrollments now resolves to that guest; a second face in the frame stays inconclusive.
    if (branch === "inconclusive") fake.state.warnings = [{ risk: "MULTIPLE_FACES_DETECTED", log_type: "warning" }];
    if (branch === "no_face") fake.state.searchStatus = 400;
    if (branch === "error") fake.state.searchStatus = 503;
    if (branch === "paused") await q().query("update events set starts_at=clock_timestamp()+interval '1 day',ends_at=clock_timestamp()+interval '2 days',status='published' where id=$1", [p.eventId]);
    const result = await door.scan(p.device, JPEG);
    const expected = branch === "withdrawn" ? "unknown" : branch === "other_event" ? "not_on_list" : branch === "ambiguous" ? "welcomed" : branch;
    expect(result.result).toBe(expected);
    expect(await q().query("select result from scans")).toEqual([{ result: expected }]);
    expect(await count("checkins")).toBe(["welcomed", "welcome_back"].includes(expected) ? 1 : 0);
    expect(await count("outbox")).toBe(["welcomed", "welcome_back"].includes(expected) ? 1 : 0);
    expect(fake.state.calls).toEqual({ search: branch === "paused" ? 0 : 1, liveness: 0 });
    // Door searches are stored in the Didit console; liveness calls are not.
    expect(fake.state.saved).toBe(branch === "paused" ? 0 : 1);
    expect(await count("spend")).toBe(branch === "paused" ? 0 : 1);
  });
  it.each(["supervised", "strict"])("%s door refuses multiple faces even with one eligible match", async mode => {
    const p=await person();fake.state.matches=[match(p.sessionId)];
    await q().query("update events set door=jsonb_build_object('kiosk',true,'mode',$2::text,'match_threshold',80) where id=$1",[p.eventId,mode]);
    fake.state.warnings=[{risk:"MULTIPLE_FACES_DETECTED",log_type:"warning"}];
    expect(await door.scan(p.device,JPEG)).toEqual({result:"inconclusive"});
    expect(await count("checkins")).toBe(0);expect(await count("outbox")).toBe(0);
    expect(await q().query("select result from scans")).toEqual([{result:"inconclusive"}]);
    expect(fake.state.calls).toEqual({search:1,liveness:mode==="strict"?1:0});
  });
  it.each([50, 65])("a full page of one guest's enrollments at threshold %s admits that guest", async threshold => {
    // A door-lab scan: an unmapped session first, then the guest's own enrollments.
    const p = await person();
    await q().query("update events set door=jsonb_build_object('kiosk',true,'mode','supervised','match_threshold',$2::int) where id=$1", [p.eventId, threshold]);
    fake.state.matches = [match(randomUUID(), 78.3), match(p.sessionId, 76.9), match(randomUUID(), 76.5), match(randomUUID(), 75.9), match(randomUUID(), 73.6)];
    expect((await door.scan(p.device, JPEG)).result).toBe("welcomed");
    expect(await count("checkins")).toBe(1);
  });
  it("strict no-face responses retain no_face when liveness also cannot find a face",async()=>{
    const p=await person();
    await q().query("update events set door=jsonb_build_object('kiosk',true,'mode','strict','match_threshold',80) where id=$1",[p.eventId]);
    fake.state.imageCases.set(createHash("sha256").update(JPEG).digest("hex"),{searchStatus:400,livenessStatus:400});
    expect(await door.scan(p.device,JPEG)).toEqual({result:"no_face"});
    expect(await count("checkins")).toBe(0);expect(await count("outbox")).toBe(0);
    expect(fake.state.calls).toEqual({search:1,liveness:1});
  });
  it("opens a published event at its start without waiting for the scheduler", async () => {
    const p = await person(); fake.state.matches = [match(p.sessionId)];
    await q().query("update events set status='published',starts_at=clock_timestamp()+interval '1 hour',ends_at=clock_timestamp()+interval '2 hours' where id=$1", [p.eventId]);
    expect((await door.context(p.device)).state).toBe("not_started");
    expect((await door.scan(p.device, JPEG)).result).toBe("paused");
    expect(fake.state.calls.search).toBe(0);
    await q().query("update events set starts_at=clock_timestamp()-interval '1 hour' where id=$1", [p.eventId]);
    expect((await door.context(p.device)).state).toBe("live");
    expect((await door.scan(p.device, JPEG)).result).toBe("welcomed");
    await q().query("update events set ends_at=clock_timestamp()-interval '1 second' where id=$1", [p.eventId]);
    expect((await door.context(p.device)).state).toBe("ended");
    expect((await door.scan(p.device, JPEG)).result).toBe("paused");
    expect(fake.state.calls.search).toBe(1);
  });
  it("strict liveness fails closed, reserves both prices, calls in parallel and logs no check-in", async () => {
    const p = await person(); fake.state.matches = [match(p.sessionId)]; fake.state.liveness = "Declined";
    await q().query("update events set door=jsonb_set(door,'{mode}','\"strict\"') where id=$1", [p.eventId]);
    const both = deferred(); fake.state.beforeResponse = async () => { if (fake.state.calls.search && fake.state.calls.liveness) both.resolve(); await both.promise; };
    expect((await door.scan(p.device, JPEG)).result).toBe("liveness_failed");
    expect(fake.state.calls).toEqual({ search: 1, liveness: 1 }); expect(fake.state.saved).toBe(1);
    expect(await count("checkins")).toBe(0); expect(await count("outbox")).toBe(0);
    expect(await q().query("select result from scans")).toEqual([{ result: "liveness_failed" }]);
    expect(await q().query("select sum(usd_max_micros)::int as reserved from spend")).toEqual([{ reserved: 100000 }]);
    expect((await door.context(p.device)).doorMode).toBe("strict");
  });
  it("strict scan budget reserves both or neither; foreign-event door sessions make zero calls", async () => {
    const p = await person(), other = await person();
    await q().query("update events set door=jsonb_set(door,'{mode}','\"strict\"') where id=$1", [p.eventId]);
    const capped = new Door({ db, didit: new DiditClient({ apiKey: "test-only", fetch: fake.fetch, ...NO_LOAD_TIMEOUTS }), totalUsd: 0.05 });
    expect((await capped.scan(p.device, JPEG)).result).toBe("budget_exhausted");
    expect((await capped.context(p.device)).budgetExhausted).toBe(true);
    expect(await count("spend")).toBe(0);
    await expect(door.resolveSession(p.token, other.eventId)).rejects.toMatchObject({ status: 403 });
    await expect(door.scan({ ...p.device, eventId: other.eventId }, JPEG)).rejects.toThrow("DoorSessionEnded");
    expect(fake.state.calls).toEqual({ search: 0, liveness: 0 });
  });
  it.each(["", " \t ", "10", "0"])("context and reservations agree on environment cap %j", async cap => {
    vi.stubEnv("DIDIT_SPEND_CAP_USD", cap);
    const p = await person();
    // Blank settings use the default cap and continue accounting for the previous ledger.
    await q().query("insert into counters(key,value,expires_at) values('spend:environment:total',10000000,'infinity')");
    const capped = cap.trim() !== "";
    expect((await door.context(p.device)).budgetExhausted).toBe(capped);
    expect((await door.scan(p.device, JPEG)).result).toBe(capped ? "budget_exhausted" : "unknown");
    expect(fake.state.calls).toEqual({ search: capped ? 0 : 1, liveness: 0 });
    expect(await count("spend")).toBe(capped ? 0 : 1);
    expect(await q().query("select value::int from counters where key='spend:environment:total'")).toEqual([{ value: capped ? 10000000 : 10050000 }]);
  });
  it.each(["replacement", "deletion", "threshold", "event_ended", "door_ended"] as const)("rechecks %s after provider resolution and before admitting", async change => {
    const p = await person(); fake.state.matches = [match(p.sessionId)];
    const original = door.checkin.bind(door);
    vi.spyOn(door, "checkin").mockImplementationOnce(async (...args) => {
      if (change === "replacement") await withTx(async tx => {
        await lockForDecision(tx, p.accountId);
        await tx.query("update evidence set activation='superseded',state='superseded',superseded_at=clock_timestamp() where id=$1", [p.faceEvidenceId]);
        const replacement = randomUUID();
        await tx.query("insert into verifications(id,account_id,didit_session_id,workflow_id,vendor_data,status) values($1,$2,$3,$4,$5,'approved')", [replacement, p.accountId, randomUUID(), randomUUID(), `acct_${p.accountId}`]);
        await tx.query(`insert into evidence(account_id,verification_id,kind,established_at,valid_until,provider_status,activation,continuity_of)
          values($1,$2,'face',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '90 days','approved','active',$3)`, [p.accountId, replacement, p.verificationId]);
      }, db);
      if (change === "deletion") await withTx(async tx => { await lockForDecision(tx, p.accountId); await tx.query("update accounts set deleting_at=clock_timestamp() where id=$1", [p.accountId]); }, db);
      if (change === "threshold") await q().query("update events set door=jsonb_set(door,'{match_threshold}','70') where id=$1", [p.eventId]);
      if (change === "event_ended") await q().query("update events set ends_at=clock_timestamp()-interval '1 second',starts_at=clock_timestamp()-interval '2 hours' where id=$1", [p.eventId]);
      if (change === "door_ended") await door.endSessionById(actor, p.eventId, p.device.doorSessionId);
      return original(...args);
    });
    if (change === "door_ended") await expect(door.scan(p.device, JPEG)).rejects.toMatchObject({ status: 401 });
    else {
      const expected = change === "replacement" ? "not_verified" : change === "deletion" ? "unknown" : change === "threshold" ? "inconclusive" : "paused";
      expect((await door.scan(p.device, JPEG)).result).toBe(expected);
      expect(await q().query("select result from scans")).toEqual([{ result: expected }]);
    }
    expect(await count("checkins")).toBe(0); expect(await count("outbox")).toBe(0); expect(fake.state.calls.search).toBe(1);
  });
  it("manual check-in and undo are authenticated, audited and keep the permanent welcome dedupe", async () => {
    const p = await person();
    await expect(door.manualCheckin({ ...actor, sessionId: randomUUID() }, p.registrationId, "Override")).rejects.toMatchObject({ status: 403 });
    await expect(door.manualCheckin(actor, p.registrationId, " ")).rejects.toThrow("ReasonRequired");
    const first = await door.manualCheckin(actor, p.registrationId, "Photo ID checked at desk");
    expect(await door.manualCheckin(actor, p.registrationId, "Duplicate click")).toEqual(first);
    await door.undoCheckin(actor, first.checkinId, "Wrong guest selected");
    await door.undoCheckin(actor, first.checkinId, "Duplicate click");
    const second = await door.manualCheckin(actor, p.registrationId, "Photo ID checked again");
    expect(second.checkinId).not.toBe(first.checkinId);
    expect(await count("checkins")).toBe(2); expect(await count("outbox")).toBe(1);
    expect(await q().query("select action from audit order by created_at")).toEqual([{ action: "checkin.manual" }, { action: "checkin.undone" }, { action: "checkin.manual" }]);
    expect(await q().query("select count(*)::int as active from checkins where undone_at is null")).toEqual([{ active: 1 }]);
    expect(fake.state.calls.search).toBe(0);
  });
  it("v5 compact result: outcome, display name, verified badge and the echoed track for every tag outcome", async () => {
    const p = await person(); fake.state.matches = [match(p.sessionId)];
    const fresh = async () => (await kiosk(p.eventId)).device;
    const scanned = async (options: { test?: boolean; faceWidth?: number } = {}) => door.scanResult(await door.scanFace(await fresh(), JPEG, options), p.eventId, options.test === true, { trackId: 7 });
    const test = await scanned({ test: true });
    expect(test).toMatchObject({ outcome: "test", result: "welcomed", firstName: "Fixture", displayName: "Fixture Guest", verified: true, photo: "none", trackId: 7, test: true });
    expect(Date.parse(test.verifiedAt!)).toBeLessThan(Date.now());
    expect(await scanned()).toMatchObject({ outcome: "welcome", displayName: "Fixture Guest", verified: true, test: false });
    // The duplicate scan is a welcome back: one check-in, one welcome email.
    expect(await scanned()).toMatchObject({ outcome: "welcome_back", displayName: "Fixture Guest", verified: true });
    expect(await count("checkins")).toBe(1); expect(await count("outbox")).toBe(1);
    await q().query("update registrations set admission='pending' where id=$1", [p.registrationId]);
    await q().query("delete from checkins");
    expect(await scanned()).toMatchObject({ outcome: "not_approved", result: "not_admitted", admission: "pending", displayName: "Fixture Guest", verified: true });
    await q().query("delete from scans"); await q().query("delete from registrations where id=$1", [p.registrationId]);
    expect(await scanned()).toMatchObject({ outcome: "not_on_list", firstName: "Fixture", verified: true });
    fake.state.matches = [];
    expect(await scanned()).toEqual({ result: "unknown", threshold: 80, bestScore: null, test: false, outcome: "unknown", firstName: null, displayName: null, verified: false, verifiedAt: null, photo: "none", trackId: 7 });
    expect(doorOutcome({ result: "ambiguous", test: false })).toBe("unknown");
    expect(doorOutcome({ result: "not_verified", firstName: "A", verification: "requirements_unmet", test: false })).toBe("not_approved");
  });
  it("strict door: a face too small for passive liveness answers liveness_needed with no call, spend or scan row; a close one is checked", async () => {
    const p = await person(); fake.state.matches = [match(p.sessionId)];
    const fresh = async () => (await kiosk(p.eventId)).device;
    // Supervised doors never need liveness: a far face is recognised.
    expect((await door.scanFace(await fresh(), JPEG, { faceWidth: 60 })).result).toBe("welcomed");
    await q().query("delete from checkins"); await q().query("delete from outbox");
    await q().query("update events set door=jsonb_set(door,'{mode}','\"strict\"') where id=$1", [p.eventId]);
    const before = { calls: { ...fake.state.calls }, spend: await count("spend"), scans: await count("scans") };
    const far = await door.scanFace(await fresh(), JPEG, { faceWidth: STRICT_LIVENESS_MIN_FACE_PX - 1 });
    expect(far).toEqual({ result: "liveness_needed" });
    expect(await door.scanResult(far, p.eventId, false, { trackId: 3 })).toMatchObject({ outcome: "liveness_needed", trackId: 3, displayName: null, verified: false });
    expect(fake.state.calls).toEqual(before.calls); expect(await count("spend")).toBe(before.spend); expect(await count("scans")).toBe(before.scans);
    expect((await door.scanFace(await fresh(), JPEG, { faceWidth: STRICT_LIVENESS_MIN_FACE_PX })).result).toBe("welcomed");
    expect(fake.state.calls.liveness).toBe(before.calls.liveness + 1);
    fake.state.liveness = "Declined";
    const failed = await door.scanFace(await fresh(), JPEG, { faceWidth: 400 });
    expect(await door.scanResult(failed, p.eventId)).toMatchObject({ outcome: "liveness_failed", displayName: null });
  });
  it("daily scan counters stop calls and the context reports exhausted; 1.2-second device throttle does not spend", async () => {
    const p = await person(), limited = new Door({ db, eventDailyScans: 1, didit: new DiditClient({ apiKey: "test-only", fetch: fake.fetch, ...NO_LOAD_TIMEOUTS }) });
    fake.state.matches = [];
    await limited.scan(p.device, JPEG);
    // The multi-face door runs up to 3 scans at once: 4 per 1.2 s window pass the device throttle, the 5th is refused.
    for (let i = 1; i < DEVICE_SCANS_PER_WINDOW; i++) expect((await limited.scan(p.device, JPEG)).result).toBe("budget_exhausted");
    await expect(limited.scan(p.device, JPEG)).rejects.toMatchObject({ status: 429 });
    const next = await kiosk(p.eventId);
    expect((await limited.scan(next.device, JPEG)).result).toBe("budget_exhausted");
    expect((await limited.context(p.device)).budgetExhausted).toBe(true);
    expect(fake.state.calls.search).toBe(1); expect(await count("spend")).toBe(1);
  });
  it.skipIf(kind !== "postgres")("20 concurrent scans for one person make exactly one check-in and one welcome", async () => {
    const p = await person(); fake.state.matches = [match(p.sessionId)];
    const devices = await Promise.all(Array.from({ length: 20 }, () => kiosk(p.eventId)));
    const results = await Promise.all(devices.map(d => door.scan(d.device, JPEG)));
    expect(results.filter(r => r.result === "welcomed")).toHaveLength(1);
    expect(results.filter(r => r.result === "welcome_back")).toHaveLength(19);
    expect(await count("checkins")).toBe(1); expect(await count("outbox")).toBe(1); expect(await count("scans")).toBe(20);
    expect(fake.state.calls).toEqual({ search: 20, liveness: 0 });
  });
  it.skipIf(kind !== "postgres")("50 simultaneous strict scans cannot exceed a $1 cap or dispatch an unpaired reservation", async () => {
    const p = await person(); fake.state.matches = [match(p.sessionId)];
    await q().query("update events set door=jsonb_set(door,'{mode}','\"strict\"') where id=$1", [p.eventId]);
    const limited = new Door({ db, totalUsd: 1, didit: new DiditClient({ apiKey: "test-only", fetch: fake.fetch, ...NO_LOAD_TIMEOUTS }) });
    const devices = await Promise.all(Array.from({ length: 50 }, () => kiosk(p.eventId)));
    const results = await Promise.all(devices.map(d => limited.scan(d.device, JPEG)));
    expect(results.filter(r => r.result === "budget_exhausted")).toHaveLength(40);
    expect(fake.state.calls).toEqual({ search: 10, liveness: 10 });
    expect(await count("spend")).toBe(20); expect(await count("scans")).toBe(50);
    expect(await count("checkins")).toBe(1); expect(await count("outbox")).toBe(1);
    expect(await q().query("select value::int from counters where key='spend:total:door'")).toEqual([{ value: 1000000 }]);
    expect((await limited.context(p.device)).budgetExhausted).toBe(true);
  });
  it.skipIf(kind !== "postgres")("withdrawal holds the account lock first: a pre-lock match is rejected after commit", async () => {
    const p = await person(); fake.state.matches = [match(p.sessionId)];
    const held = deferred<number>(), release = deferred();
    const withdrawing = withTx(async tx => {
      await lockAccount(tx, p.accountId);
      await tx.query("update evidence set invalidated_at=clock_timestamp(),provider_status='withdrawn' where id=$1", [p.faceEvidenceId]);
      const [backend] = await tx.query<{ pid: number }>("select pg_backend_pid() as pid");
      held.resolve(backend!.pid); await release.promise;
    }, db);
    const withdrawalPid = await Promise.race([held.promise, withdrawing.then(() => { throw new Error("WithdrawalDidNotHoldLock"); })]);
    const scanning = door.scan(p.device, JPEG);
    // Observe the database wait, not just entry into checkin(): committing at entry can hide a missing lock.
    let scanFinished = false;
    void scanning.then(() => { scanFinished = true; }, () => { scanFinished = true; });
    try {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const waiting = await q().query<{ pid: number }>(`select pid from pg_stat_activity
          where datname=current_database() and wait_event_type='Lock' and wait_event='advisory'
          and query='select pg_advisory_xact_lock($1::bigint)'
          and $1::int=any(pg_blocking_pids(pid))`, [withdrawalPid]);
        if (waiting.length) {
          expect(waiting).toHaveLength(1);
          expect(waiting[0]!.pid).not.toBe(withdrawalPid);
          break;
        }
        if (scanFinished) throw new Error("CheckinCompletedWithoutWaitingForAccountLock");
        if (Date.now() > deadline) throw new Error("CheckinNeverWaitedForAccountLock");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(scanFinished).toBe(false);
      release.resolve(); await withdrawing;
      expect((await scanning).result).toBe("not_verified");
    } finally {
      // Failed assertions/mutations must release pinned transactions rather than hanging the suite.
      release.resolve();
      await Promise.allSettled([withdrawing, scanning]);
    }
    expect(await count("checkins")).toBe(0); expect(await count("outbox")).toBe(0); expect(fake.state.calls.search).toBe(1);
    expect(await q().query("select result from scans")).toEqual([{ result: "not_verified" }]);
  });
  it.skipIf(kind !== "postgres")("check-in obtains account lock first: later withdrawal preserves history and raises C23 flag", async () => {
    const p = await person(); fake.state.matches = [match(p.sessionId)];
    // Hold the kiosk: check-in has already acquired account -> registration -> event before waiting here.
    const held = deferred<number>(), release = deferred();
    const kioskWriter = withTx(async tx => {
      await tx.query("select id from kiosks where id=$1 for update", [p.kioskId]);
      const [backend] = await tx.query<{ pid: number }>("select pg_backend_pid() as pid");
      held.resolve(backend!.pid); await release.promise;
    }, db);
    const kioskPid = await Promise.race([held.promise, kioskWriter.then(() => { throw new Error("KioskWriterDidNotHoldLock"); })]);
    const scanning = door.scan(p.device, JPEG);
    let withdrawing: Promise<void> | undefined;
    try {
      let checkinPid: number;
      const deadline = Date.now() + 10000;
      for (;;) {
        const waiting = await q().query<{ pid: number }>(`select pid from pg_stat_activity
          where datname=current_database() and wait_event_type='Lock' and query like 'select id from kiosks%'
          and $1::int=any(pg_blocking_pids(pid))`, [kioskPid]);
        if (waiting.length) { expect(waiting).toHaveLength(1); checkinPid = waiting[0]!.pid; break; }
        if (Date.now() > deadline) throw new Error("CheckinNeverWaitedForKiosk");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const started = deferred<number>();
      withdrawing = withTx(async tx => {
        const [backend] = await tx.query<{ pid: number }>("select pg_backend_pid() as pid");
        started.resolve(backend!.pid);
        await lockForDecision(tx, p.accountId);
        await tx.query("update evidence set invalidated_at=clock_timestamp(),provider_status='withdrawn' where id=$1", [p.faceEvidenceId]);
      }, db);
      let withdrawalFinished = false;
      void withdrawing.then(() => { withdrawalFinished = true; }, () => { withdrawalFinished = true; });
      const withdrawalPid = await Promise.race([started.promise, withdrawing.then(() => { throw new Error("WithdrawalDidNotStart"); })]);
      const withdrawalDeadline = Date.now() + 10000;
      for (;;) {
        const waiting = await q().query(`select pid from pg_stat_activity
          where pid=$1 and datname=current_database() and wait_event_type='Lock' and wait_event='advisory'
          and query='select pg_advisory_xact_lock($1::bigint)'
          and $2::int=any(pg_blocking_pids(pid))`, [withdrawalPid, checkinPid]);
        if (waiting.length) break;
        if (withdrawalFinished) throw new Error("WithdrawalCompletedWithoutWaitingForCheckinAccountLock");
        if (Date.now() > withdrawalDeadline) throw new Error("WithdrawalNeverWaitedForCheckinAccountLock");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(withdrawalFinished).toBe(false);
      expect(await q().query("select provider_status from evidence where id=$1", [p.faceEvidenceId])).toEqual([{ provider_status: "approved" }]);
      release.resolve(); await kioskWriter;
      expect((await scanning).result).toBe("welcomed"); await withdrawing;
    } finally {
      release.resolve();
      await Promise.allSettled([kioskWriter, scanning, ...(withdrawing ? [withdrawing] : [])]);
    }
    expect(await q().query("select provider_status from evidence where id=$1", [p.faceEvidenceId])).toEqual([{ provider_status: "withdrawn" }]);
    expect(await q().query(`select c.undone_at, c.checked_in_at <= e.invalidated_at as checked_in_first
      from checkins c join evidence e on e.id=c.face_evidence_id`)).toEqual([{ undone_at: null, checked_in_first: true }]);
    expect(await count("checkins")).toBe(1); expect(await count("outbox")).toBe(1); expect(fake.state.calls.search).toBe(1);
    const [checkin] = await q().query<{ id: string }>("select id from checkins");
    expect(await door.checkinFlags(actor, checkin!.id)).toEqual({ verification_withdrawn_after_checkin: true });
  });
});
