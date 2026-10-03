import { randomUUID } from "node:crypto";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb,type Db } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { queryable } from "../db/tx.ts";
export async function testDatabase(kind: "pglite" | "postgres", migrationsDir?: string): Promise<{ db: Db; close: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "events-f1-"));
  if (kind === "postgres") {
    // Each test file gets a real, isolated database; parallel suites must never truncate each other's rows.
    const url = new URL(process.env.TEST_DATABASE_URL!);
    const admin = createDb({ url: url.href });
    const name = `f1_test_${randomUUID().replaceAll("-", "")}`;
    await queryable(admin).query(`create database ${name}`);
    url.pathname = `/${name}`;
    const db = createDb({ url: url.href });
    try { await migrate(db, migrationsDir); } catch (error) { await db.close(); await queryable(admin).query(`drop database ${name}`); await admin.close(); throw error; }
    return { db, close: async () => { await db.close(); await queryable(admin).query(`drop database ${name}`); await admin.close(); await rm(dir, { recursive: true, force: true }); } };
  }
  const db = createDb({ url: "", pgliteDir: dir });
  await migrate(db, migrationsDir);
  return { db, close: async () => { await db.close(); await rm(dir, { recursive: true, force: true }); } };
}
export async function resetDatabase(db: Db): Promise<void> {
  await queryable(db).query("truncate accounts,events,staff,inbox,outbox,jobs,counters,spend,deletions,audit,calendar_profiles cascade");
}
export async function seed(db: Db) {
  const q = queryable(db);
  const accountId = randomUUID(), eventId = randomUUID(), registrationId = randomUUID(), kioskId = randomUUID();
  await q.query("insert into accounts (id,email,email_verified_at,email_proof_method,email_proof_ref) values ($1,$2,clock_timestamp(),'legacy_verified','fixture')", [accountId, `${accountId}@example.test`]);
  await q.query("insert into events (id,slug,name,starts_at,ends_at,capacity,status,door) values ($1,$2,'Fixture',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',10,'live','{\"kiosk\":true,\"mode\":\"supervised\",\"match_threshold\":80}')", [eventId, eventId]);
  await q.query("insert into registrations(legacy_imported,policy_version,form_version,id,account_id,event_id,admission) values(true,1,1,$1,$2,$3,'approved')", [registrationId, accountId, eventId]);
  await q.query("insert into kiosks (id,event_id,name) values ($1,$2,'Door')", [kioskId, eventId]);
  return { accountId, eventId, registrationId, kioskId };
}
export function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
