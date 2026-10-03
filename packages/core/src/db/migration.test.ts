import { randomUUID } from "node:crypto";
import { cp,mkdir,mkdtemp,readFile,rm,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect,it } from "vitest";
import { tombstoned } from "../identity/shared.ts";
import { createDb } from "./index.ts";
import { migrate,MIGRATIONS_DIR } from "./migrate.ts";
import { queryable } from "./tx.ts";

it("C25 migration expands existing F1 data, preserves active evidence and fails closed for revoked history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "f1b-migration-")), legacy = join(dir, "legacy");
  await mkdir(join(legacy, "meta"), { recursive: true });
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
  journal.entries = journal.entries.filter(entry => entry.idx <= 5);
  for (const entry of journal.entries) await cp(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(legacy, `${entry.tag}.sql`));
  await writeFile(join(legacy, "meta/_journal.json"), JSON.stringify(journal));
  const db = createDb({ url: "", pgliteDir: join(dir, "database") });
  try {
    await migrate(db, legacy);
    const q = queryable(db), accountId = randomUUID(), verifications: string[] = [];
    await q.query("insert into accounts(id,email) values($1,'migration@example.test')", [accountId]);
    for (const state of ["active", "pending_continuity", "superseded", "invalidated"]) {
      const verificationId = randomUUID(); verifications.push(verificationId);
      await q.query("insert into verifications(id,account_id,didit_session_id,workflow_id,vendor_data) values($1,$2,$3,$4,'fixture')", [verificationId, accountId, randomUUID(), randomUUID()]);
      await q.query("insert into evidence(account_id,verification_id,kind,state,established_at,valid_until) values($1,$2,'face',$3,clock_timestamp(),clock_timestamp()+interval '1 day')", [accountId, verificationId, state]);
    }
    await q.query("insert into evidence(account_id,verification_id,kind,value,state,established_at,valid_until) values($1,$2,'age','25'::jsonb,'active',clock_timestamp(),clock_timestamp()+interval '1 day')", [accountId, verifications[1]]);
    await migrate(db); await migrate(db);
    expect(await q.query("select state,activation,provider_status from evidence where kind='face' order by state::text")).toEqual([
      { state: "active", activation: "active", provider_status: "approved" },
      { state: "invalidated", activation: "revoked", provider_status: "withdrawn" },
      { state: "pending_continuity", activation: "pending_continuity", provider_status: "approved" },
      { state: "superseded", activation: "superseded", provider_status: "approved" },
    ]);
    expect(await q.query("select state,activation,continuity_of from evidence where kind='age'")).toEqual([{ state: "pending_continuity", activation: "pending_continuity", continuity_of: null }]);
    expect(await q.query("select id from evidence where continuity_of is not null")).toEqual([]);
    await expect(q.query("update evidence set continuity_of=verification_id")).rejects.toThrow("evidence_continuity_cycle");
    const foreignAccount = randomUUID(), foreignVerification = randomUUID();
    await q.query("insert into accounts(id,email) values($1,'foreign@example.test')", [foreignAccount]);
    await q.query("insert into verifications(id,account_id,didit_session_id,workflow_id,vendor_data) values($1,$2,$3,$4,'fixture')", [foreignVerification, foreignAccount, randomUUID(), randomUUID()]);
    await expect(q.query("update evidence set continuity_of=$1", [foreignVerification])).rejects.toThrow("evidence_continuity_account_fk");
    await q.query("update evidence set continuity_of=$1 where verification_id=$2", [verifications[0], verifications[2]]);
    expect(await q.query("select continuity_of from evidence where verification_id=$1", [verifications[2]])).toEqual([{ continuity_of: verifications[0] }]);
    expect(await q.query("insert into evidence(account_id,verification_id,kind,value,established_at,valid_until) values($1,$2,'identity','{}'::jsonb,clock_timestamp(),clock_timestamp()+interval '1 day') returning activation,provider_status", [accountId, verifications[0]])).toEqual([{ activation: "pending_continuity", provider_status: "in_review" }]);
    await expect(q.query("update evidence set recovered_by='owner@example.test'")).rejects.toThrow("evidence_recovery_pair");
    await expect(q.query("update evidence set provider_status='bogus'")).rejects.toThrow("evidence_provider_status");
    await expect(q.query("update evidence set activation='bogus'")).rejects.toThrow("evidence_activation");
    expect(await q.query("select 'liveness_failed'::scan_result as result")).toEqual([{ result: "liveness_failed" }]);
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
}, 30_000);

it("0009 backfills face history from pre-B1 evidence and retained liveness, including inactive history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "b1-migration-0008-")), legacy = join(dir, "legacy");
  await mkdir(join(legacy, "meta"), { recursive: true });
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
  journal.entries = journal.entries.filter(entry => entry.idx <= 7);
  for (const entry of journal.entries) await cp(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(legacy, `${entry.tag}.sql`));
  await writeFile(join(legacy, "meta/_journal.json"), JSON.stringify(journal));
  const db = createDb({ url: "", pgliteDir: join(dir, "database") });
  try {
    await migrate(db, legacy);
    const q = queryable(db);
    expect(await q.query("select column_name from information_schema.columns where table_name='accounts' and column_name='has_face_history'")).toEqual([]);
    const cases = ["active", "pending_continuity", "superseded", "revoked", "liveness_only", "identity_only", "no_history"];
    const accounts = new Map<string, string>();
    const established = new Date("2025-01-01T00:00:00Z"), until = new Date("2025-06-30T00:00:00Z");
    for (const history of cases) {
      const accountId = randomUUID(), verificationId = randomUUID(); accounts.set(history, accountId);
      await q.query("insert into accounts(id,email) values($1,$2)", [accountId, `${history}@example.test`]);
      await q.query("insert into verifications(id,account_id,didit_session_id,workflow_id,vendor_data,liveness_at) values($1,$2,$3,$4,$5,$6)",
        [verificationId, accountId, randomUUID(), randomUUID(), `acct_${accountId}`, history === "liveness_only" ? established : null]);
      if (["liveness_only", "no_history"].includes(history)) continue;
      await q.query(`insert into evidence(account_id,verification_id,kind,value,activation,state,provider_status,established_at,valid_until)
        values($1,$2,$3::evidence_kind,case when $3::text='identity' then '{}'::jsonb else null end,$4,$5,$6,$7,$8)`, [accountId, verificationId, history === "identity_only" ? "identity" : "face",
        history === "identity_only" ? "active" : history, history === "revoked" ? "invalidated" : history === "identity_only" ? "active" : history,
        history === "revoked" ? "withdrawn" : "approved", established, until]);
    }
    await migrate(db); await migrate(db);
    for (const [history, accountId] of accounts) {
      expect(await q.query("select has_face_history from accounts where id=$1", [accountId])).toEqual([{ has_face_history: !["identity_only", "no_history"].includes(history) }]);
      expect(await q.query("select first_approved_at from verifications where account_id=$1", [accountId])).toEqual([{ first_approved_at: history === "no_history" ? null : established }]);
    }
    // Purging old evidence cannot erase the migrated continuity obligation.
    await q.query("delete from evidence");
    expect(await q.query("select count(*)::int as n from accounts where has_face_history")).toEqual([{ n: 5 }]);
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
}, 30_000);

it("0013 releases completed email tombstones while retaining old account/session and pending deletion barriers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "b2-migration-reuse-")), legacy = join(dir, "legacy");
  await mkdir(join(legacy, "meta"), { recursive: true });
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
  journal.entries = journal.entries.filter(entry => entry.idx <= 12);
  for (const entry of journal.entries) await cp(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(legacy, `${entry.tag}.sql`));
  await writeFile(join(legacy, "meta/_journal.json"), JSON.stringify(journal));
  const db = createDb({ url: "", pgliteDir: join(dir, "database") });
  try {
    await migrate(db, legacy);
    const q = queryable(db), old = randomUUID(), remote = randomUUID();
    await q.query("insert into deletions(email_hash,original_account_id,didit_session_ids,state,completed_at) values('completed-hash',$1,$2::jsonb,'complete',clock_timestamp())", [old, JSON.stringify([remote])]);
    await q.query("insert into deletions(email_hash,didit_session_ids,state) values('pending-hash','[]'::jsonb,'remote_pending')");
    await migrate(db); await migrate(db);
    expect(await q.query("select email_hash,original_account_id,didit_session_ids from deletions where state='complete'")).toEqual([{ email_hash: null, original_account_id: old, didit_session_ids: [remote] }]);
    expect(await q.query("select email_hash from deletions where state='remote_pending'")).toEqual([{ email_hash: "pending-hash" }]);
    expect(await tombstoned(q, { accountId: old })).toBe(true);
    expect(await tombstoned(q, { diditSessionId: remote })).toBe(true);
    // The former hash can represent a later account's deletion independently of the old tombstone.
    await q.query("insert into deletions(email_hash,didit_session_ids) values('completed-hash','[]'::jsonb)");
    expect(await q.query("select id from deletions")).toHaveLength(3);
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
}, 30_000);

it("0018 adds the calendar profile and nullable event place columns on top of an existing database", async () => {
  const dir = await mkdtemp(join(tmpdir(), "calendar-profile-migration-")), legacy = join(dir, "legacy");
  await mkdir(join(legacy, "meta"), { recursive: true });
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
  // Every migration before the calendar profile one (it ships as 0018; later lanes append after it).
  const at = journal.entries.findIndex(entry => entry.tag === "0018_calendar_profile");
  journal.entries = journal.entries.slice(0, at);
  for (const entry of journal.entries) await cp(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(legacy, `${entry.tag}.sql`));
  await writeFile(join(legacy, "meta/_journal.json"), JSON.stringify(journal));
  const db = createDb({ url: "", pgliteDir: join(dir, "database") });
  try {
    await migrate(db, legacy);
    const q = queryable(db);
    await q.query("insert into events(slug,name,starts_at,ends_at,capacity,venue,address) values('old-event','Old event','2026-10-23T17:00:00Z','2026-10-23T21:00:00Z',50,'Didit HQ','Carrer de Pallars 99, Barcelona')");
    await migrate(db); await migrate(db);
    expect(await q.query("select venue,address,place_id,lat,lng,maps_url from events")).toEqual([{ venue: "Didit HQ", address: "Carrer de Pallars 99, Barcelona", place_id: null, lat: null, lng: null, maps_url: null }]);
    expect(await q.query("select key from calendar_profiles")).toEqual([]);
    await q.query("update events set place_id='ChIJ5TCOcRaYpBIRCmZHTz37sEQ',lat=41.4,lng=2.19,maps_url='https://maps.google.com/?cid=1'");
    await expect(q.query("update events set lat=null")).rejects.toThrow();
    await expect(q.query("update events set maps_url='javascript:alert(1)'")).rejects.toThrow();
    await q.query("insert into calendar_profiles(key,name) values('default','Didit Events')");
    await expect(q.query("insert into calendar_profiles(key,name) values('other','Other')")).rejects.toThrow();
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
}, 30_000);
