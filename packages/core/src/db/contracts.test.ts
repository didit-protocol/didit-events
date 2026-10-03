import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { doorEligibility,type DoorEvent,type DoorKiosk,type DoorRegistration } from "../domain/door.ts";
import { eligible,type EvidenceFact } from "../domain/eligibility.ts";
import { deriveEvidence,verificationWithdrawnAfterCheckin,type EvidenceChanges } from "../domain/evidence.ts";
import { deferred,resetDatabase,seed,testDatabase } from "../testing/database.ts";
import { skipPostgres } from "../testing/postgres.ts";
import type { Db } from "./index.ts";
import { lockForCheckin,lockForDecision,lockForDeletion,lockForSeatGrant,promoteOne,queryable,withTx,type Tx } from "./tx.ts";

const evidenceSelect = `select id,account_id as "accountId",verification_id as "verificationId",kind,value,state,activation,continuity_of as "continuityOf",
  provider_status as "providerStatus",established_at as "establishedAt",valid_until as "validUntil",invalidated_at as "invalidatedAt",
  superseded_at as "supersededAt",invalidated_reason as "invalidatedReason",recovered_by as "recoveredBy",recovery_reason as "recoveryReason" from evidence where account_id=$1`;
async function proofs(tx: Tx, accountId: string): Promise<EvidenceFact[]> { return tx.query<EvidenceFact & Record<string, unknown>>(evidenceSelect, [accountId]); }
async function verification(db: Db, accountId: string) {
  const id = randomUUID(), sessionId = randomUUID();
  await queryable(db).query("insert into verifications(id,account_id,didit_session_id,workflow_id,vendor_data) values($1,$2,$3,$4,'fixture')", [id, accountId, sessionId, randomUUID()]);
  return { id, sessionId };
}
async function apply(tx: Tx, changes: EvidenceChanges) {
  for (const row of changes.update) await tx.query(`update evidence set state=$2,activation=$3,provider_status=$4,invalidated_at=$5,superseded_at=$6,invalidated_reason=$7,recovered_by=$8,recovery_reason=$9,continuity_of=$10 where id=$1`, [row.id, row.state, row.activation, row.providerStatus, row.invalidatedAt?.toISOString() ?? null, row.supersededAt?.toISOString() ?? null, row.invalidatedReason, row.recoveredBy, row.recoveryReason, row.continuityOf]);
  for (const row of changes.insert) await tx.query(`insert into evidence(account_id,verification_id,kind,value,established_at,valid_until,state,activation,provider_status,recovered_by,recovery_reason,continuity_of)
    values($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12)`, [row.accountId, row.verificationId, row.kind, JSON.stringify(row.value), row.establishedAt.toISOString(), row.validUntil.toISOString(), row.state, row.activation, row.providerStatus, row.recoveredBy, row.recoveryReason, row.continuityOf]);
  if (changes.recoveryAudit) {
    const audit = changes.recoveryAudit;
    await tx.query("insert into audit(actor,action,target,data) values($1,$2,$3,$4::jsonb)", [audit.actor, audit.action, audit.target, JSON.stringify({ reason: audit.reason })]);
  }
}
async function waitlist(db: Db, eventId: string, id = randomUUID(), appliedAt = new Date()) {
  const accountId = randomUUID(), q = queryable(db);
  await q.query("insert into accounts(id,email) values($1,$2)", [accountId, `${accountId}@example.test`]);
  await q.query("insert into registrations(legacy_imported,policy_version,form_version,id,account_id,event_id,admission,applied_at) values(true,1,1,$1,$2,$3,'waitlisted',$4)", [id, accountId, eventId, appliedAt]);
  return { id, account_id: accountId };
}
async function approve(tx: Tx, candidate: { id: string }) {
  await tx.query("update registrations set admission='approved' where id=$1", [candidate.id]);
  await tx.query("insert into admission_history(registration_id,\"from\",\"to\",actor) values($1,'waitlisted','approved','promotion')", [candidate.id]);
  return candidate.id;
}
async function fixture(db: Db) {
  const ids = await seed(db), v = await verification(db, ids.accountId);
  await withTx(async tx => {
    await lockForDecision(tx, ids.accountId);
    await apply(tx, deriveEvidence({ accountId: ids.accountId, verificationId: v.id, providerStatus: "approved", establishedAt: new Date(Date.now() - 86400_000), observedAt: new Date(), matches: [], proofs: [{ kind: "identity", value: {} }, { kind: "face", value: null }, { kind: "age", value: 16 }] }, { evidence: [], hasFaceHistory: false, sessionIds: new Map() }));
  }, db);
  const [face] = await queryable(db).query<{ id: string }>("select id from evidence where account_id=$1 and kind='face'", [ids.accountId]);
  return { ...ids, verificationId: v.id, sessionId: v.sessionId, faceEvidenceId: face!.id };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function checkin(tx: Tx, ids: Fixture) {
  await lockForCheckin(tx, ids);
  const [a] = await tx.query<{ id: string; deletingAt: Date | null; deletedAt: Date | null }>('select id,deleting_at as "deletingAt",deleted_at as "deletedAt" from accounts where id=$1', [ids.accountId]);
  const [event] = await tx.query<DoorEvent & Record<string, unknown>>('select id,status,starts_at as "startsAt",ends_at as "endsAt",door_mode as "doorMode",requirements,max_age as "maxAge" from events where id=$1', [ids.eventId]);
  const [registration] = await tx.query<DoorRegistration & Record<string, unknown>>('select id,account_id as "accountId",event_id as "eventId",admission from registrations where id=$1', [ids.registrationId]);
  const [kiosk] = await tx.query<DoorKiosk & Record<string, unknown>>('select id,event_id as "eventId",revoked_at as "revokedAt" from kiosks where id=$1', [ids.kioskId]);
  const result = doorEligibility({ account: { ...a!, evidence: await proofs(tx, ids.accountId) }, event: event!, registration: registration!, kiosk: kiosk!, faceEvidenceId: ids.faceEvidenceId, now: new Date() });
  if (result.eligible) await tx.query("insert into checkins(event_id,registration_id,kiosk_id,face_evidence_id,method) values($1,$2,$3,$4,'face') on conflict do nothing", [ids.eventId, ids.registrationId, ids.kioskId, ids.faceEvidenceId]);
  return result;
}
async function invalidate(tx: Tx, ids: Fixture, mutation: "withdrawal" | "renewal" | "deletion") {
  if (mutation === "deletion") await lockForDeletion(tx, ids.accountId);
  else await lockForDecision(tx, ids.accountId);
  if (mutation === "renewal") await tx.query("update evidence set activation='superseded',state='superseded',superseded_at=clock_timestamp() where id=$1", [ids.faceEvidenceId]);
  else await tx.query("update evidence set provider_status='withdrawn',invalidated_at=clock_timestamp(),invalidated_reason=$2 where account_id=$1", [ids.accountId, mutation]);
  if (mutation === "deletion") {
    await tx.query("update accounts set deleting_at=clock_timestamp() where id=$1", [ids.accountId]);
    await tx.query("update registrations set admission='cancelled_by_guest' where account_id=$1", [ids.accountId]);
  }
}

describe.skipIf(skipPostgres)("C22-C25 real Postgres contracts", () => {
  let db: Db, close: () => Promise<void>;
  beforeAll(async () => { ({ db, close } = await testDatabase("postgres")); }, 60_000);
  beforeEach(async () => { await resetDatabase(db); });
  afterAll(async () => { await close?.(); });

  it("mixed approvals, check-ins, promotion and deletion finish without deadlock or exceeding capacity", async () => {
    const ids = await fixture(db), q = queryable(db), capacity = 3;
    await q.query("update events set capacity=$2 where id=$1", [ids.eventId, capacity]);
    const candidates: Array<{ accountId: string; registrationId: string }> = [];
    for (let i = 0; i < 12; i++) {
      const accountId = randomUUID(), registrationId = randomUUID();
      await q.query("insert into accounts(id,email) values($1,$2)", [accountId, `${accountId}@example.test`]);
      await q.query("insert into registrations(legacy_imported,policy_version,form_version,id,account_id,event_id,admission) values(true,1,1,$1,$2,$3,$4)", [registrationId, accountId, ids.eventId, i === 0 ? "waitlisted" : "pending"]);
      candidates.push({ accountId, registrationId });
    }
    const held = deferred(), release = deferred(), counts: number[] = [];
    const firstCheckin = withTx(async tx => { await tx.query("set local statement_timeout='5s'"); const result = await checkin(tx, ids); held.resolve(); await release.promise; return result; }, db);
    await held.promise;
    const grant = async (tx: Tx, registrationId: string) => {
      const [row] = await tx.query<{ count: string }>("select count(*) from registrations where event_id=$1 and admission='approved'", [ids.eventId]);
      if (Number(row!.count) < capacity) await tx.query("update registrations set admission='approved' where id=$1", [registrationId]);
      const [after] = await tx.query<{ count: string }>("select count(*) from registrations where event_id=$1 and admission='approved'", [ids.eventId]);
      counts.push(Number(after!.count));
      await delay(5);
      return registrationId;
    };
    const promotionGrant = vi.fn((tx: Tx, candidate: { id: string }) => grant(tx, candidate.id));
    const promotion = promoteOne(ids.eventId, { eligible: async () => true, grant: promotionGrant }, db);
    const work = [firstCheckin,
      promotion,
      withTx(tx => invalidate(tx, ids, "deletion"), db),
      withTx(tx => checkin(tx, ids), db),
      ...candidates.slice(1).map(c => withTx(async tx => { await tx.query("set local statement_timeout='5s'"); await lockForSeatGrant(tx, [c.accountId], ids.eventId); await grant(tx, c.registrationId); }, db)),
    ];
    release.resolve();
    await Promise.all(work);
    const promoted = await promotion;
    const [promotedRow] = await q.query<{ admission: string }>("select admission from registrations where id=$1", [candidates[0]!.registrationId]);
    expect(promoted.skipped).toEqual([]);
    if (promoted.stopped === "granted") {
      expect(promoted.granted).toBe(candidates[0]!.registrationId);
      expect(promotionGrant).toHaveBeenCalledExactlyOnceWith(expect.anything(), { id: candidates[0]!.registrationId, account_id: candidates[0]!.accountId });
      expect(promotedRow!.admission).toBe("approved");
    } else {
      expect(promoted).toEqual({ granted: null, skipped: [], stopped: "capacity" });
      expect(promotionGrant).not.toHaveBeenCalled();
      expect(promotedRow!.admission).toBe("waitlisted");
    }
    expect(counts.every(n => n <= capacity)).toBe(true);
    const [final] = await q.query<{ count: string }>("select count(*) from registrations where event_id=$1 and admission='approved'", [ids.eventId]);
    expect(Number(final!.count)).toBe(capacity);
    expect(await q.query("select id from checkins")).toHaveLength(1);
    // Opposite input ordering must still take both account locks in ascending order.
    await Promise.all([candidates.slice(1, 3), candidates.slice(1, 3).reverse()].map(cs => withTx(tx => lockForSeatGrant(tx, cs.map(c => c.accountId), ids.eventId), db)));
  }, 15_000);

  it.each(["withdrawal", "renewal", "deletion"] as const)("C23 %s first blocks a waiting check-in", async mutation => {
    const ids = await fixture(db), held = deferred(), release = deferred(), starting = deferred(); let entered = false;
    const first = withTx(async tx => { await invalidate(tx, ids, mutation); held.resolve(); await release.promise; }, db);
    await held.promise;
    const second = withTx(async tx => { starting.resolve(); const result = await checkin(tx, ids); entered = true; return result; }, db);
    await starting.promise;
    try { await delay(25); expect(entered).toBe(false); } finally { release.resolve(); }
    await first;
    expect(await second).toEqual({ eligible: false, result: mutation === "deletion" ? "unknown" : "not_verified" });
    expect(await queryable(db).query("select id from checkins")).toHaveLength(0);
  });
  it.each(["withdrawal", "renewal", "deletion"] as const)("C23 check-in first persists after %s; withdrawal flag is derivable", async mutation => {
    const ids = await fixture(db), held = deferred(), release = deferred(), starting = deferred(); let entered = false;
    const first = withTx(async tx => { const result = await checkin(tx, ids); held.resolve(); await release.promise; return result; }, db);
    await held.promise;
    const second = withTx(async tx => { starting.resolve(); await invalidate(tx, ids, mutation); entered = true; }, db);
    await starting.promise;
    try { await delay(25); expect(entered).toBe(false); } finally { release.resolve(); }
    expect(await first).toEqual({ eligible: true }); await second;
    const rows = await queryable(db).query<{ faceEvidenceId: string; checkedInAt: Date; undoneAt: Date | null }>('select face_evidence_id as "faceEvidenceId",checked_in_at as "checkedInAt",undone_at as "undoneAt" from checkins');
    expect(rows).toHaveLength(1); expect(rows[0]!.undoneAt).toBeNull();
    const evidence = await withTx(tx => proofs(tx, ids.accountId), db);
    expect(verificationWithdrawnAfterCheckin(rows[0]!, evidence)).toBe(mutation !== "renewal");
  });

  it("concurrent replacements revalidate continuity under the account lock; exactly one activates", async () => {
    const ids = await fixture(db), vs = await Promise.all([verification(db, ids.accountId), verification(db, ids.accountId)]);
    await Promise.all(vs.map(v => withTx(async tx => {
      await lockForDecision(tx, ids.accountId);
      const existing = await proofs(tx, ids.accountId);
      const changes = deriveEvidence({ accountId: ids.accountId, verificationId: v.id, providerStatus: "approved", establishedAt: new Date(), observedAt: new Date(), proofs: [{ kind: "face", value: null }, { kind: "age", value: 25 }, { kind: "identity", value: {} }], matches: [{ session_id: ids.sessionId, similarity_percentage: 95, is_blocklisted: false, api_service: null }] }, { evidence: existing, hasFaceHistory: true, sessionIds: new Map([[ids.verificationId, ids.sessionId], ...vs.map(v => [v.id, v.sessionId] as const)]) });
      await apply(tx, changes);
    }, db)));
    expect(await queryable(db).query("select activation,count(*)::int as count from evidence where kind='face' group by activation order by activation")).toEqual([
      { activation: "active", count: 1 }, { activation: "pending_continuity", count: 1 }, { activation: "superseded", count: 1 },
    ]);
    for (const v of vs) {
      const rows = await qRows(v.id);
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map(row => row.activation)).size).toBe(1);
      expect(new Set(rows.map(row => row.continuity_of))).toEqual(new Set([rows[0]!.activation === "active" ? ids.verificationId : null]));
    }
    async function qRows(verificationId: string) {
      return queryable(db).query<{ activation: string; continuity_of: string | null }>("select activation,continuity_of from evidence where verification_id=$1", [verificationId]);
    }
    expect(await qRows(ids.verificationId)).toEqual(Array(3).fill({ activation: "superseded", continuity_of: null }));
  });
  it("the partial unique index rejects simultaneous activation even if a writer omits the account lock", async () => {
    const ids = await seed(db), vs = await Promise.all([verification(db, ids.accountId), verification(db, ids.accountId)]);
    for (const v of vs) await queryable(db).query("insert into evidence(account_id,verification_id,kind,established_at,valid_until,state,provider_status,activation) values($1,$2,'face',clock_timestamp(),clock_timestamp()+interval '1 day','pending_continuity','approved','pending_continuity')", [ids.accountId, v.id]);
    const results = await Promise.allSettled(vs.map(v => withTx(tx => tx.query("update evidence set activation='active' where verification_id=$1", [v.id]), db)));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(r => r.status === "rejected");
    expect(rejected?.status === "rejected" && String(rejected.reason)).toContain("evidence_one_active_face");
  });
  it.each(["continuity", "recovery"] as const)("persists the age-gate fix and activates every pending row on %s", async mode => {
    const ids = await fixture(db), v = await verification(db, ids.accountId), now = new Date();
    const decision = { accountId: ids.accountId, verificationId: v.id, providerStatus: "approved" as const,
      establishedAt: now, observedAt: now, matches: [],
      proofs: [{ kind: "age" as const, value: 25 }, { kind: "identity" as const, value: {} }, { kind: "face" as const, value: null }] };
    const event = { endsAt: new Date(+now + 3600_000), requirements: { identity: true, email: true, liveness: true }, maxAge: {}, ageMin: 18 };
    const history = async (tx: Tx) => ({ evidence: await proofs(tx, ids.accountId), hasFaceHistory: true, sessionIds: new Map([[ids.verificationId, ids.sessionId], [v.id, v.sessionId]]) });
    await withTx(async tx => { await lockForDecision(tx, ids.accountId); await apply(tx, deriveEvidence(decision, await history(tx))); }, db);
    const pending = await withTx(tx => proofs(tx, ids.accountId), db);
    expect(pending.filter(row => row.verificationId === v.id).map(row => row.activation)).toEqual(Array(3).fill("pending_continuity"));
    expect(eligible({ id: ids.accountId, deletingAt: null, deletedAt: null, evidence: pending }, event)).toBe(false);
    await withTx(async tx => {
      await lockForDecision(tx, ids.accountId);
      await apply(tx, deriveEvidence({ ...decision, ...(mode === "continuity" ? {
        matches: [{ session_id: ids.sessionId, similarity_percentage: 90, is_blocklisted: false, api_service: null }],
      } : { recovery: { role: "owner" as const, staff: "owner@example.test", authenticatedAt: now, reason: "Confirmed in person" } }) }, await history(tx)));
    }, db);
    const active = await withTx(tx => proofs(tx, ids.accountId), db);
    expect(active.filter(row => row.verificationId === v.id)).toEqual(expect.arrayContaining(decision.proofs.map(proof => expect.objectContaining({
      kind: proof.kind, activation: "active", continuityOf: mode === "continuity" ? ids.verificationId : null,
      establishedAt: now, recoveredBy: mode === "recovery" ? "owner@example.test" : null,
    }))));
    expect(active.filter(row => row.verificationId === ids.verificationId).map(row => row.activation)).toEqual(Array(3).fill("superseded"));
    expect(eligible({ id: ids.accountId, deletingAt: null, deletedAt: null, evidence: active }, event)).toBe(true);
    expect(await queryable(db).query("select id from audit where action='evidence_recovered'")).toHaveLength(mode === "recovery" ? 1 : 0);
  });
  it("promotion grants the first eligible FIFO candidate, orders ties by id, and hands off transactional grant effects", async () => {
    const ids = await seed(db), date = new Date("2026-09-29T10:00:00Z");
    // Reverse insertion order; the earliest timestamp has the largest id.
    const later = await waitlist(db, ids.eventId, "00000000-0000-4000-8000-000000000001", new Date(+date + 1));
    const tieLast = await waitlist(db, ids.eventId, "00000000-0000-4000-8000-000000000003", date);
    const tieFirst = await waitlist(db, ids.eventId, "00000000-0000-4000-8000-000000000002", date);
    const first = await waitlist(db, ids.eventId, "00000000-0000-4000-8000-000000000004", new Date(+date - 1));
    const grant = vi.fn(approve), eligible = vi.fn(async () => true);
    for (const candidate of [first, tieFirst, tieLast, later]) {
      expect(await promoteOne(ids.eventId, { eligible, grant }, db)).toEqual({ granted: candidate.id, skipped: [], stopped: "granted" });
    }
    expect(grant.mock.calls.map(([, candidate]) => candidate.id)).toEqual([first.id, tieFirst.id, tieLast.id, later.id]);
    expect(eligible).toHaveBeenCalledTimes(4);
    expect(await queryable(db).query("select id from admission_history where actor='promotion'")).toHaveLength(4);
    expect(await queryable(db).query("select id from registrations where event_id=$1 and admission='approved'", [ids.eventId])).toHaveLength(5);
    expect(await promoteOne(ids.eventId, { eligible, grant }, db)).toEqual({ granted: null, skipped: [], stopped: "empty" });
    expect(grant).toHaveBeenCalledTimes(4);
  });
  it("promotion skips an ineligible head and deleting accounts, then grants the next eligible candidate", async () => {
    const ids = await seed(db), date = new Date();
    const head = await waitlist(db, ids.eventId, randomUUID(), date);
    const deleting = await waitlist(db, ids.eventId, randomUUID(), new Date(+date + 1));
    const next = await waitlist(db, ids.eventId, randomUUID(), new Date(+date + 2));
    await queryable(db).query("update accounts set deleting_at=clock_timestamp() where id=$1", [deleting.account_id]);
    const grant = vi.fn(approve), eligible = vi.fn(async (_: Tx, candidate: { id: string }) => candidate.id !== head.id);
    expect(await promoteOne(ids.eventId, { eligible, grant }, db)).toEqual({ granted: next.id, stopped: "granted", skipped: [
      { candidate: head, reason: "ineligible" }, { candidate: deleting, reason: "account_deleting_or_missing" },
    ] });
    expect(grant).toHaveBeenCalledExactlyOnceWith(expect.anything(), next);
    expect(eligible.mock.calls.map(([, candidate]) => candidate.id)).toEqual([head.id, next.id]);
    expect(await queryable(db).query("select id from registrations where admission='waitlisted' order by applied_at,id")).toEqual([{ id: head.id }, { id: deleting.id }]);
  });
  it("promotion bounds a scan at 50 and reports every skipped reason", async () => {
    const ids = await seed(db), candidates: Awaited<ReturnType<typeof waitlist>>[] = [], date = new Date();
    for (let i = 0; i < 51; i++) candidates.push(await waitlist(db, ids.eventId, randomUUID(), new Date(+date + i)));
    const grant = vi.fn(approve), eligible = vi.fn(async (_: Tx, candidate: { id: string }) => candidate.id === candidates[50]!.id);
    expect(await promoteOne(ids.eventId, { eligible, grant }, db)).toEqual({ granted: null, stopped: "scan_limit", skipped: candidates.slice(0, 50).map(candidate => ({ candidate, reason: "ineligible" })) });
    expect(eligible).toHaveBeenCalledTimes(50);
    expect(grant).not.toHaveBeenCalled();
  });
  it.each([false, true])("promotion discards a stale unlocked candidate and continues to a successor when present (%s)", async withSuccessor => {
    const ids = await seed(db), q = queryable(db), held = deferred(), release = deferred();
    await q.query("update registrations set admission='waitlisted' where id=$1", [ids.registrationId]);
    const successor = withSuccessor ? await waitlist(db, ids.eventId, randomUUID(), new Date(Date.now() + 1000)) : null;
    const grant = vi.fn(approve), eligible = vi.fn(async (_: Tx, candidate: { id: string }) => {
      expect(candidate.id).toBe(successor?.id);
      return true;
    });
    const writer = withTx(async tx => {
      await lockForDecision(tx, ids.accountId); held.resolve(); await release.promise;
      await tx.query("update registrations set admission='cancelled_by_guest' where id=$1", [ids.registrationId]);
    }, db);
    await held.promise;
    const promotion = promoteOne(ids.eventId, { eligible, grant }, db);
    try {
      await expect.poll(async () => {
        const [row] = await q.query<{ count: number }>("select count(*)::int from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.datname=current_database() and l.locktype='advisory' and not l.granted");
        return row!.count;
      }, { timeout: 2000, interval: 10 }).toBe(1);
    } finally { release.resolve(); await writer; }
    expect(await promotion).toEqual({ granted: successor?.id ?? null, stopped: successor ? "granted" : "empty", skipped: [{ candidate: { id: ids.registrationId, account_id: ids.accountId }, reason: "stale" }] });
    expect(eligible).toHaveBeenCalledTimes(successor ? 1 : 0);
    expect(grant).toHaveBeenCalledTimes(successor ? 1 : 0);
    if (successor) expect(grant).toHaveBeenCalledExactlyOnceWith(expect.anything(), successor);
  });
  it("promotion skips ineligible candidates, full events and deleting accounts without invoking grant", async () => {
    const ids = await seed(db), q = queryable(db);
    await q.query("update registrations set admission='waitlisted' where id=$1", [ids.registrationId]);
    const grant = async () => { throw new Error("MustNotGrant"); };
    expect(await promoteOne(ids.eventId, { eligible: async () => false, grant }, db)).toEqual({ granted: null, stopped: "empty", skipped: [{ candidate: { id: ids.registrationId, account_id: ids.accountId }, reason: "ineligible" }] });
    const admitted = randomUUID();
    await q.query("insert into accounts(id,email) values($1,$2)", [admitted, `${admitted}@example.test`]);
    await q.query("update events set capacity=1 where id=$1", [ids.eventId]);
    await q.query("insert into registrations(legacy_imported,policy_version,form_version,account_id,event_id,admission) values(true,1,1,$1,$2,'approved')", [admitted, ids.eventId]);
    expect(await promoteOne(ids.eventId, { eligible: async () => true, grant }, db)).toEqual({ granted: null, stopped: "capacity", skipped: [] });
    await q.query("update registrations set admission='pending' where account_id=$1", [admitted]);
    await q.query("update accounts set deleting_at=clock_timestamp() where id=$1", [ids.accountId]);
    expect(await promoteOne(ids.eventId, { eligible: async () => true, grant }, db)).toEqual({ granted: null, stopped: "empty", skipped: [{ candidate: { id: ids.registrationId, account_id: ids.accountId }, reason: "account_deleting_or_missing" }] });
  });
});
