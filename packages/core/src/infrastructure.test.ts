import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { consume } from "./counters.ts";
import type { Db } from "./db/index.ts";
import { advisoryKey,lockAccount,lockForCheckin,lockForDecision,lockForDeletion,lockForSeatGrant,queryable,withTx } from "./db/tx.ts";
import { doorEligibility,type DoorEvent,type DoorKiosk,type DoorRegistration } from "./domain/door.ts";
import type { EvidenceFact } from "./domain/eligibility.ts";
import { dispatchInbox,InboxRegistry,store } from "./inbox.ts";
import { dispatchJobs,JobRegistry,scheduleJob,withJobLock } from "./jobs.ts";
import { ChangeBus,notifyInTx } from "./notify.ts";
import { dispatchOutbox,enqueue,OutboxRegistry } from "./outbox.ts";
import { BudgetExceeded,reserve,settle } from "./spend.ts";
import { deferred,resetDatabase,seed,testDatabase } from "./testing/database.ts";
import { skipPostgres } from "./testing/postgres.ts";

for (const kind of ["pglite", "postgres"] as const) {
  describe.skipIf(kind === "postgres" && skipPostgres)(`${kind} foundation`, () => {
    let db: Db, close: () => Promise<void>;
    beforeAll(async () => { ({ db, close } = await testDatabase(kind)); }, 60_000);
    beforeEach(async () => { await resetDatabase(db); });
    afterAll(async () => { await close?.(); });
    it("raw timestamp queries have the same Date contract with both database drivers", async () => {
      const at = new Date("2026-09-29T12:34:56.789Z");
      const q = queryable(db);
      expect(await q.query("select $1::timestamptz as at,$2::text as literal", [at, at.toISOString()])).toEqual([{ at, literal: at.toISOString() }]);
      expect(await withTx(tx => tx.query("select $1::timestamptz as at", [at]), db)).toEqual([{ at }]);
    });
    it("enforces composite ownership, partial unique checkin, redemption uniqueness, normalized identities and checks", async () => {
      const a = await seed(db), b = await seed(db), q = queryable(db);
      await expect(q.query("insert into checkins(event_id,registration_id,method) values($1,$2,'manual')", [b.eventId, a.registrationId])).rejects.toThrow();
      await q.query("insert into checkins(event_id,registration_id,method) values($1,$2,'manual')", [a.eventId, a.registrationId]);
      await expect(q.query("insert into checkins(event_id,registration_id,method) values($1,$2,'manual')", [a.eventId, a.registrationId])).rejects.toThrow();
      await q.query("update checkins set undone_at=clock_timestamp()");
      await q.query("insert into checkins(event_id,registration_id,method) values($1,$2,'manual')", [a.eventId, a.registrationId]);
      const [invite] = await q.query<{ id: string }>("insert into invites(event_id,token_hash,expires_at) values($1,'hash',clock_timestamp()+interval '1 day') returning id", [a.eventId]);
      const redemption = () => q.query("insert into invite_redemptions(invite_id,account_id,registration_id) values($1,$2,$3)", [invite!.id, a.accountId, a.registrationId]);
      await redemption(); await expect(redemption()).rejects.toThrow();
      await expect(q.query("update events set capacity=0 where id=$1", [a.eventId])).rejects.toThrow();
      await expect(q.query("update events set match_threshold=100 where id=$1", [a.eventId])).rejects.toThrow();
      await expect(q.query("update events set requirements=$2::jsonb where id=$1", [a.eventId, JSON.stringify({ liveness: "yes" })])).rejects.toThrow();
      await expect(q.query("update events set max_age=$2::jsonb where id=$1", [a.eventId, JSON.stringify({ face: 15552001 })])).rejects.toThrow();
      await expect(q.query("update events set age_min=18,requirements=$2::jsonb where id=$1", [a.eventId, JSON.stringify({ age_min: 21 })])).rejects.toThrow();
      await expect(q.query("insert into accounts(email) values('Upper@EXAMPLE.test')")).rejects.toThrow();
      await q.query("insert into account_identities(account_id,issuer,subject) values($1,'issuer','subject')", [a.accountId]);
      await expect(q.query("insert into account_identities(account_id,issuer,subject) values($1,'issuer','subject')", [b.accountId])).rejects.toThrow();
      const [verification] = await q.query<{ id: string }>("insert into verifications(account_id,didit_session_id,workflow_id,vendor_data) values($1,$2,$3,'fixture') returning id", [a.accountId, randomUUID(), randomUUID()]);
      const proof = (accountId: string, proofKind: string) => q.query("insert into evidence(account_id,verification_id,kind,value,established_at,valid_until,provider_status,activation) values($1,$2,$3,case when $3::text='identity' then '{}'::jsonb else null end,clock_timestamp(),clock_timestamp()+interval '1 day','approved','active')", [accountId, verification!.id, proofKind]);
      await expect(proof(b.accountId, "face")).rejects.toThrow(); await proof(a.accountId, "face"); await expect(proof(a.accountId, "face")).rejects.toThrow();
      const workflow = randomUUID();
      const op = () => q.query("insert into verification_ops(account_id,workflow_id,kind,expires_at,vendor_data,email_at_creation) values($1,$2,'full',clock_timestamp()+interval '1 day','legacy','fixture@example.test')", [a.accountId, workflow]);
      await op(); await expect(op()).rejects.toThrow();
      await q.query("update verification_ops set state='completed'"); await op();
      await expect(q.query("insert into sessions(token_hash,principal,auth_method,account_id,expires_at) values('bad','staff','email_otp',$1,clock_timestamp()+interval '1 day')", [a.accountId])).rejects.toThrow();
    });
    it("counters admit at most limit under 50 simultaneous calls and roll into a new window", async () => {
      const results = await Promise.all(Array.from({ length: 50 }, () => consume("rate", 9, 3600, db)));
      expect(results.filter(r => r.allowed)).toHaveLength(9);
      await queryable(db).query("update counters set expires_at=clock_timestamp()-interval '1 second'");
      expect((await consume("rate", 9, 3600, db)).remaining).toBe(8);
    });
    it.each([undefined, "", " \t ", "10"])("reserves with environment cap %j without coercing blanks to zero", async cap => {
      const previous = process.env.DIDIT_SPEND_CAP_USD;
      if (cap === undefined) delete process.env.DIDIT_SPEND_CAP_USD;
      else process.env.DIDIT_SPEND_CAP_USD = cap;
      try {
        const input = { op: "face_search" as const, usdMax: 10, scopes: [
          { kind: "app/day" as const, id: "app", usdCap: 20 },
          { kind: "total" as const, id: "test", usdCap: 20 },
        ] };
        await reserve(input, db);
        const q = queryable(db);
        const [row] = await q.query<{ scopes: Array<{ key: string; limitMicros: number }> }>("select scopes from spend");
        const environmentScopes = row!.scopes.filter(scope => scope.key === "spend:environment:total");
        expect(environmentScopes).toEqual(cap?.trim() ? [{ key: "spend:environment:total", limitMicros: 10000000 }] : [{ key: "spend:environment:total", limitMicros: 1000000000 }]);
        if (cap?.trim()) await expect(reserve({ ...input, usdMax: 0.05 }, db)).rejects.toBeInstanceOf(BudgetExceeded);
        else {
          expect(await q.query("select key from counters where key='spend:environment:total'")).toEqual([{ key: "spend:environment:total" }]);
          await reserve({ ...input, usdMax: 0.05 }, db);
        }
      } finally {
        if (previous === undefined) delete process.env.DIDIT_SPEND_CAP_USD;
        else process.env.DIDIT_SPEND_CAP_USD = previous;
      }
    });
    it.each([undefined, "", " "])("enforces and logs the default $1000 total with setting %j", async cap => {
      vi.stubEnv("DIDIT_SPEND_CAP_USD", cap);
      const logger = vi.spyOn(console, "info").mockImplementation(() => {});
      try {
        const q = queryable(db);
        await q.query("insert into counters(key,value,expires_at) values('spend:environment:total',999970000,'infinity')");
        const scopes = [{ kind: "app/day" as const, id: "default-cap", usdCap: 10000 }, { kind: "total" as const, id: "default-cap", usdCap: 10000 }];
        await reserve({ op: "email_send", usdMax: 0.03, scopes }, db);
        await expect(reserve({ op: "email_send", usdMax: 0.03, scopes }, db)).rejects.toBeInstanceOf(BudgetExceeded);
        expect(await q.query("select value::int from counters where key='spend:environment:total'")).toEqual([{ value: 1000000000 }]);
        expect(await q.query("select id from spend")).toHaveLength(1);
        expect(logger).toHaveBeenCalledWith(expect.stringContaining('"event":"spend.cap_reached"'));
        expect(logger).toHaveBeenCalledWith(expect.stringContaining('"capUsd":1000'));
      } finally { logger.mockRestore(); vi.unstubAllEnvs(); }
    });
    it("50 combined endpoint reservations cannot exceed any cap; uncertain holds and settlement is idempotent", async () => {
      const scopes = [{ kind: "app/day" as const, id: "app", usdCap: 1 }, { kind: "event/day" as const, id: "event", usdCap: 0.5 }, { kind: "total" as const, id: "test", usdCap: 0.3 }];
      const results = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => reserve({ op: i % 2 ? "face_search" : "passive_liveness", usdMax: 0.05, scopes }, db)));
      const successes = results.filter(r => r.status === "fulfilled");
      expect(successes).toHaveLength(6);
      for (const result of results) if (result.status === "rejected") expect(result.reason).toBeInstanceOf(BudgetExceeded);
      const rows = await queryable(db).query<{ value: string }>("select value from counters");
      expect(rows.every(r => Number(r.value) === 300_000)).toBe(true);
      const id = successes[0]!.value.id;
      await settle(id, "uncertain", db);
      await expect(reserve({ op: "face_search", usdMax: 0.05, scopes }, db)).rejects.toBeInstanceOf(BudgetExceeded);
      await Promise.all(Array.from({ length: 20 }, () => settle(id, 0, db)));
      await reserve({ op: "email_send", usdMax: 0.03, scopes }, db);
      await expect(settle(id, 0.01, db)).rejects.toThrow("ConflictingSettlement");
      expect((await queryable(db).query<{ value: string }>("select value from counters")).every(r => Number(r.value) === 280_000)).toBe(true);
    });
    it("the environment's total spend cap cannot be bypassed by choosing other scope IDs", async () => {
      const previous = process.env.DIDIT_SPEND_CAP_USD;
      process.env.DIDIT_SPEND_CAP_USD = "0.05";
      try {
        const scopes = [{ kind: "app/day" as const, id: "one", usdCap: 10 }, { kind: "total" as const, id: "one", usdCap: 10 }];
        await reserve({ op: "face_search", usdMax: 0.05, scopes }, db);
        await expect(reserve({ op: "email_send", usdMax: 0.03, scopes: scopes.map(s => ({ ...s, id: "two" })) }, db)).rejects.toBeInstanceOf(BudgetExceeded);
        expect(await queryable(db).query("select id from spend")).toHaveLength(1);
        expect(await queryable(db).query("select key from counters where key like '%two%'")).toHaveLength(0);
      } finally {
        if (previous === undefined) delete process.env.DIDIT_SPEND_CAP_USD;
        else process.env.DIDIT_SPEND_CAP_USD = previous;
      }
    });
    it("workers leave unregistered provider kinds pending without consuming attempts", async () => {
      await withTx(tx => enqueue(tx, { kind: "provider-disabled", dedupeKey: "disabled", payload: {} }), db);
      expect(await dispatchOutbox(db, new OutboxRegistry())).toBe(false);
      expect(await queryable(db).query("select status,attempts from outbox")).toEqual([{ status: "pending", attempts: 0 }]);
    });
    it("20 concurrent enqueues produce one row and one dispatch", async () => {
      await Promise.all(Array.from({ length: 20 }, () => withTx(tx => enqueue(tx, { kind: "email", dedupeKey: "one", payload: {} }), db)));
      const registry = new OutboxRegistry(); let calls = 0;
      registry.register("email", async () => { calls++; return { providerId: "sent" }; });
      await Promise.all([dispatchOutbox(db, registry), dispatchOutbox(db, registry)]);
      expect(calls).toBe(1);
      expect(await queryable(db).query("select status,attempts from outbox")).toEqual([{ status: "sent", attempts: 1 }]);
    });
    it("outbox retries with backoff, keeps dedupe key and suppresses exception bodies", async () => {
      await withTx(tx => enqueue(tx, { kind: "email", dedupeKey: "retry", payload: {} }), db);
      const registry = new OutboxRegistry(); let attempts = 0;
      registry.register("email", async message => { expect(message.dedupe_key).toBe("retry"); if (++attempts === 1) throw new Error("SECRET_BODY"); });
      await dispatchOutbox(db, registry); expect(await dispatchOutbox(db, registry)).toBe(false);
      const [row] = await queryable(db).query<{ error: string; attempts: number }>("select * from outbox");
      expect(row!.error).toBe("dispatch_failed");
      await queryable(db).query("update outbox set next_attempt_at=clock_timestamp()");
      await dispatchOutbox(db, registry); expect(attempts).toBe(2);
    });
    it("outbox handlers can open domain transactions without holding the dispatch pool or PGlite transaction", async () => {
      const registry = new OutboxRegistry(), ready = deferred(); let entered = 0;
      await withTx(async tx => {
        for (let i = 0; i < 8; i++) await enqueue(tx, { kind: "domain", dedupeKey: `nested:${i}`, payload: {} });
      }, db);
      registry.register("domain", async row => {
        if (++entered === 8) ready.resolve();
        await ready.promise;
        await withTx(tx => tx.query("insert into audit(actor,action,target) values('worker','handled',$1)", [row.id]), db);
      });
      await Promise.all(Array.from({ length: 8 }, () => dispatchOutbox(db, registry)));
      expect(await queryable(db).query("select id from audit")).toHaveLength(8);
      expect(await queryable(db).query("select id from outbox where status='sent' and attempts=1")).toHaveLength(8);
    });
    it("expired outbox leases recover after crashes and fence a stale worker checkpoint", async () => {
      await withTx(tx => enqueue(tx, { kind: "leased", dedupeKey: "leased", payload: {} }), db);
      const registry = new OutboxRegistry(), held = deferred(), release = deferred(); let calls = 0;
      registry.register("leased", async () => {
        if (++calls === 1) { held.resolve(); await release.promise; return { providerId: "stale" }; }
        return { providerId: "recovered" };
      });
      const first = dispatchOutbox(db, registry);
      await held.promise;
      try {
        expect(await dispatchOutbox(db, registry)).toBe(false);
        await queryable(db).query("update outbox set locked_until=clock_timestamp()-interval '1 second'");
        expect(await dispatchOutbox(db, registry)).toBe(true);
      } finally { release.resolve(); await first; }
      expect(calls).toBe(2);
      expect(await queryable(db).query("select status,attempts,provider_id,claim_token,locked_until from outbox")).toEqual([
        { status: "sent", attempts: 2, provider_id: "recovered", claim_token: null, locked_until: null },
      ]);
    });
    it("inbox is durable/deduplicated and failed handler writes roll back before retry", async () => {
      const raw = JSON.stringify({ event_id: "fixture", webhook_type: "status.updated" });
      const first = await store(raw, { authorization: "SECRET" }, db);
      expect((await store(raw, {}, db)).duplicate).toBe(true);
      const registry = new InboxRegistry(); let calls = 0;
      registry.register("status.updated", async (_, tx) => { calls++; await enqueue(tx, { kind: "email", dedupeKey: "effect", payload: {} }); if (calls === 1) throw new Error("SECRET"); });
      await dispatchInbox(db, registry);
      expect(await queryable(db).query("select * from outbox")).toHaveLength(0);
      expect(await queryable(db).query("select headers from inbox where id=$1", [first.id])).toEqual([{ headers: {} }]);
      await queryable(db).query("update inbox set next_attempt_at=clock_timestamp()");
      await dispatchInbox(db, registry); await dispatchInbox(db, registry);
      expect(calls).toBe(2); expect(await queryable(db).query("select * from outbox")).toHaveLength(1);
    });
    it("job runner checkpoints success and retries failed idempotent handlers", async () => {
      const registry = new JobRegistry(); let attempts = 0;
      registry.register("reconcile", async () => { if (++attempts === 1) throw new Error("PRIVATE"); });
      await scheduleJob("reconcile", 60, {}, db);
      expect(await dispatchJobs(db, registry)).toBe(1); expect(await dispatchJobs(db, registry)).toBe(0);
      await queryable(db).query("update jobs set next_run_at=clock_timestamp()");
      expect(await dispatchJobs(db, registry)).toBe(1); expect(attempts).toBe(2);
    });
    it("NOTIFY only arrives after commit, never rollback; fanout carries only change signals", async () => {
      const bus = new ChangeBus(), signals: unknown[] = [], notified = deferred();
      const stop = await bus.listen("event_fixture", db);
      const unsub = bus.subscribe(signal => { signals.push(signal); notified.resolve(); });
      await withTx(async tx => { await notifyInTx(tx, "event_fixture", { type: "scan", event_id: "fixture" }); await delay(25); expect(signals).toHaveLength(0); }, db);
      await Promise.race([notified.promise, delay(2000).then(() => { throw new Error("NotifyTimeout"); })]);
      await expect(withTx(async tx => { await notifyInTx(tx, "event_fixture", { type: "audit", event_id: "fixture" }); throw new Error("rollback"); }, db)).rejects.toThrow("rollback");
      await delay(30); expect(signals).toEqual([{ type: "scan", event_id: "fixture" }]);
      unsub(); await stop();
    });
    it("ordered checkin locks reject a registration from another account/event", async () => {
      const a = await seed(db), b = await seed(db);
      await withTx(tx => lockForCheckin(tx, a), db);
      await expect(withTx(tx => lockForCheckin(tx, { ...a, accountId: b.accountId }), db)).rejects.toThrow("RegistrationNotFound");
      expect(advisoryKey("account", a.accountId)).not.toBe(advisoryKey("job", a.accountId));
    });
    it.skipIf(kind !== "postgres")("two skip-locked workers claim different rows at the same time", async () => {
      await withTx(async tx => { for (const key of ["a", "b"]) await enqueue(tx, { kind: "parallel", dedupeKey: key, payload: {} }); }, db);
      const registry = new OutboxRegistry(), both = deferred(); const claimed = new Set<string>();
      registry.register("parallel", async row => { claimed.add(row.id); if (claimed.size === 2) both.resolve(); await both.promise; });
      await Promise.all([dispatchOutbox(db, registry), dispatchOutbox(db, registry)]);
      expect(claimed.size).toBe(2);
    });
    it.skipIf(kind !== "postgres")("50 new registrations lock capacity without FK upgrade deadlocks", async () => {
      const first = await seed(db), q = queryable(db);
      const accounts = Array.from({ length: 50 }, () => randomUUID());
      for (const id of accounts) await q.query("insert into accounts(id,email) values($1,$2)", [id, `${id}@example.test`]);
      await Promise.all(accounts.map(accountId => withTx(async tx => {
        await lockForSeatGrant(tx,[accountId],first.eventId);
        const [registration]=await tx.query<{id:string}>("insert into registrations(account_id,event_id,legacy_imported,policy_version,form_version) values($1,$2,true,1,1) returning id",[accountId,first.eventId]);
        const registrationId=registration!.id;
        const [count] = await tx.query<{ count: string }>("select count(*) from registrations where event_id=$1 and admission='approved'", [first.eventId]);
        if (Number(count!.count) < 10) await tx.query("update registrations set admission='approved' where id=$1", [registrationId]);
      }, db)));
      const [count] = await q.query<{ count: string }>("select count(*) from registrations where event_id=$1 and admission='approved'", [first.eventId]);
      expect(Number(count!.count)).toBe(10);
    });
    it.skipIf(kind !== "postgres")("advisory account locks serialize and job session locks exclude competing workers", async () => {
      const held = deferred(), release = deferred(), entered: number[] = [];
      const first = withTx(async tx => { await lockAccount(tx, "account"); entered.push(1); held.resolve(); await release.promise; }, db);
      await held.promise;
      const second = withTx(async tx => { await lockAccount(tx, "account"); entered.push(2); }, db);
      await delay(30); expect(entered).toEqual([1]); release.resolve(); await Promise.all([first, second]); expect(entered).toEqual([1, 2]);
      const jobHeld = deferred(), jobRelease = deferred();
      const leader = withJobLock("exclusive", async () => { jobHeld.resolve(); await jobRelease.promise; }, db);
      await jobHeld.promise;
      const attempts = await Promise.all(Array.from({ length: 20 }, () => withJobLock("exclusive", async () => { throw new Error("ShouldNotEnter"); }, db)));
      expect(attempts.every(x => !x.acquired)).toBe(true); jobRelease.resolve(); await leader;
      expect((await withJobLock("exclusive", async () => "next", db)).acquired).toBe(true);
    });
    it.skipIf(kind !== "postgres")("job locks never consume the pool required by their domain transactions", async () => {
      const ready = deferred(); let entered = 0;
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => withJobLock(`domain:${i}`, async () => {
        if (++entered === 8) ready.resolve();
        await ready.promise;
        await withTx(tx => tx.query("insert into audit(actor,action,target) values('job','handled',$1)", [String(i)]), db);
      }, db)));
      expect(results.every(r => r.acquired)).toBe(true);
      expect(await queryable(db).query("select id from audit")).toHaveLength(8);
    });
    it.skipIf(kind !== "postgres").each(["withdrawal", "renewal", "deletion"] as const)("a %s committed during a scan prevents use of the earlier matched face", async mutation => {
      const ids = await seed(db), q = queryable(db), sessionId = randomUUID();
      const [verification] = await q.query<{ id: string }>("insert into verifications(account_id,didit_session_id,workflow_id,vendor_data,status) values($1,$2,$3,$4,'approved') returning id", [ids.accountId, sessionId, randomUUID(), `acct_${ids.accountId}`]);
      for (const evidenceKind of ["identity", "face"]) await q.query(`insert into evidence(account_id,verification_id,kind,value,established_at,valid_until,provider_status,activation)
        values($1,$2,$3,case when $3::text='identity' then '{}'::jsonb else null end,clock_timestamp()-interval '1 day',clock_timestamp()+interval '179 days','approved','active')`, [ids.accountId, verification!.id, evidenceKind]);
      const [matched] = await q.query<{ id: string }>("select id from evidence where kind='face'");
      const held = deferred(), release = deferred(), entering = deferred();
      const writer = withTx(async tx => {
        await (mutation === "deletion" ? lockForDeletion : lockForDecision)(tx, ids.accountId);
        if (mutation === "withdrawal") {
          await tx.query("update evidence set invalidated_at=clock_timestamp(),state='invalidated',provider_status='withdrawn' where verification_id=$1", [verification!.id]);
        } else if (mutation === "renewal") {
          await tx.query("update evidence set superseded_at=clock_timestamp(),state='superseded',activation='superseded' where id=$1", [matched!.id]);
          const [renewal] = await tx.query<{ id: string }>("insert into verifications(account_id,didit_session_id,workflow_id,vendor_data,status) values($1,$2,$3,$4,'approved') returning id", [ids.accountId, randomUUID(), randomUUID(), `acct_${ids.accountId}`]);
          await tx.query("insert into evidence(account_id,verification_id,kind,value,established_at,valid_until,provider_status,activation) values($1,$2,'face',null,clock_timestamp(),clock_timestamp()+interval '180 days','approved','active')", [ids.accountId, renewal!.id]);
        } else {
          await tx.query("update accounts set deleting_at=clock_timestamp() where id=$1", [ids.accountId]);
          await tx.query("update evidence set invalidated_at=clock_timestamp(),state='invalidated',activation='revoked' where account_id=$1", [ids.accountId]);
          await tx.query("update registrations set admission='cancelled_by_guest',reason='account deleted' where account_id=$1", [ids.accountId]);
        }
        held.resolve(); await release.promise;
      }, db);
      await held.promise;
      let entered = false;
      const scan = withTx(async tx => {
        entering.resolve();
        await lockForCheckin(tx, ids); entered = true;
        const [a] = await tx.query<{ id: string; deletingAt: Date | null; deletedAt: Date | null }>('select id,deleting_at as "deletingAt",deleted_at as "deletedAt" from accounts where id=$1', [ids.accountId]);
        const proofs = await tx.query<EvidenceFact & Record<string, unknown>>(`select id,account_id as "accountId",verification_id as "verificationId",kind,value,state,provider_status as "providerStatus",activation,continuity_of as "continuityOf",
          established_at as "establishedAt",valid_until as "validUntil",invalidated_at as "invalidatedAt",superseded_at as "supersededAt" from evidence where account_id=$1`, [ids.accountId]);
        const [event] = await tx.query<DoorEvent & Record<string, unknown>>('select id,status,starts_at as "startsAt",ends_at as "endsAt",door_mode as "doorMode",requirements,max_age as "maxAge",age_min as "ageMin" from events where id=$1', [ids.eventId]);
        const [registration] = await tx.query<DoorRegistration & Record<string, unknown>>('select id,account_id as "accountId",event_id as "eventId",admission from registrations where id=$1', [ids.registrationId]);
        const [kiosk] = await tx.query<DoorKiosk & Record<string, unknown>>('select id,event_id as "eventId",revoked_at as "revokedAt" from kiosks where id=$1', [ids.kioskId]);
        const result = doorEligibility({ account: { ...a!, evidence: proofs }, event: event!, registration: registration!, kiosk: kiosk!, faceEvidenceId: matched!.id, now: new Date() });
        if (result.eligible) await tx.query("insert into checkins(event_id,registration_id,method,face_evidence_id) values($1,$2,'face',$3)", [ids.eventId, ids.registrationId, matched!.id]);
        await tx.query("insert into scans(event_id,kiosk_id,registration_id,result,latency_ms) values($1,$2,$3,$4,1)", [ids.eventId, ids.kioskId, ids.registrationId, result.eligible ? "welcomed" : result.result]);
        return result;
      }, db);
      await entering.promise;
      try { await delay(30); expect(entered).toBe(false); } finally { release.resolve(); }
      await writer;
      expect(await scan).toEqual({ eligible: false, result: mutation === "deletion" ? "unknown" : "not_verified" });
      expect(await q.query("select id from checkins")).toHaveLength(0);
      expect(await q.query("select result from scans")).toEqual([{ result: mutation === "deletion" ? "unknown" : "not_verified" }]);
    });
    it.skipIf(kind !== "postgres")("out-of-order scan/audit commits signal changes and reconnect reads both from a full snapshot", async () => {
      const ids = await seed(db), bus = new ChangeBus(), signals: string[] = [];
      let stop = await bus.listen("event_fixture", db);
      const unsub = bus.subscribe(signal => signals.push(signal.type));
      const held = deferred(), release = deferred();
      const slow = withTx(async tx => {
        await tx.query("insert into audit(actor,action,target,event_id,updated_at) values('staff','review','fixture',$1,clock_timestamp()-interval '10 seconds')", [ids.eventId]);
        await notifyInTx(tx, "event_fixture", { type: "audit", event_id: ids.eventId });
        held.resolve(); await release.promise;
      }, db);
      await held.promise;
      try {
        await withTx(async tx => {
          await tx.query("insert into scans(event_id,kiosk_id,result,latency_ms) values($1,$2,'unknown',10)", [ids.eventId, ids.kioskId]);
          await notifyInTx(tx, "event_fixture", { type: "scan", event_id: ids.eventId });
        }, db);
        await delay(30); expect(signals).toEqual(["scan"]);
      } finally { release.resolve(); await slow; }
      await delay(30); expect(signals).toEqual(["scan", "audit"]);
      await stop(); stop = await bus.listen("event_fixture", db);
      // C20 reconnect has no sequence replay. Its mandatory full DB snapshot
      // includes even a late commit older than an incremental overlap window.
      expect(await queryable(db).query("select id from scans where event_id=$1 union all select id from audit where event_id=$1", [ids.eventId])).toHaveLength(2);
      unsub(); await stop();
    });
  });
}
