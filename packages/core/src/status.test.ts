import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { queryable } from "./db/tx.ts";
import { operationalDetail, operationalStatus } from "./status.ts";
import { resetDatabase, testDatabase } from "./testing/database.ts";

describe("operational status (the admin 'Didit is not responding' banner)", () => {
  let database: Awaited<ReturnType<typeof testDatabase>>; const key = process.env.DIDIT_API_KEY;
  const q = () => queryable(database.db);
  const send = (dedupe: string, status: string, ageMin: number, attempts = 12) => q().query(
    `insert into outbox(kind,dedupe_key,payload,status,attempts,created_at,failed_at,error) values('verification.create',$1,'{}'::jsonb,$2,$3,clock_timestamp()-$4*interval '1 minute',case when $2='failed' then clock_timestamp()-$4*interval '1 minute' end,case when $2='failed' then 'retries_exhausted' end)`,
    [dedupe, status, attempts, ageMin]);
  beforeAll(async () => { database = await testDatabase("pglite"); process.env.DIDIT_API_KEY = "test"; });
  afterAll(async () => { process.env.DIDIT_API_KEY = key; await database?.close(); });
  beforeEach(async () => { await resetDatabase(database.db); });

  it("a send that failed for good hours ago is history, not an outage", async () => {
    await send("old", "failed", 14 * 60);
    expect(await operationalStatus(database.db)).toEqual({ diditApi: "ok" });
    expect((await operationalDetail(database.db)).stuckVerificationSends).toEqual([]);
  });
  it("a recent failure or a pending send that keeps retrying shows the banner and is named", async () => {
    await send("recent", "failed", 10);
    expect(await operationalStatus(database.db)).toEqual({ diditApi: "degraded" });
    await resetDatabase(database.db);
    await send("retrying", "pending", 1, 2);
    expect(await operationalStatus(database.db)).toEqual({ diditApi: "degraded" });
    expect((await operationalDetail(database.db)).stuckVerificationSends).toMatchObject([{ kind: "verification.create", status: "pending", n: 1, attempts: 2 }]);
  });
  it("emails: pending (retrying or due) and failed (last 24 h) email sends by error code, without touching the banner", async () => {
    const email = (dedupe: string, status: string, error: string | null, o: { failedHoursAgo?: number; dueInMin?: number } = {}) => q().query(
      `insert into outbox(kind,dedupe_key,payload,status,error,created_at,failed_at,next_attempt_at) values('email:M-02',$1,'{"to":"guest@example.test"}'::jsonb,$2,$3,
        clock_timestamp()-interval '30 hours',case when $2='failed' then clock_timestamp()-$4 * interval '1 hour' end,clock_timestamp()+$5 * interval '1 minute')`,
      [dedupe, status, error, o.failedHoursAgo ?? 1, o.dueInMin ?? 60]);
    expect((await operationalDetail(database.db)).emails).toEqual({ pending: [], failed: [] });
    await email("q1", "pending", "provider_quota"); await email("q2", "pending", "provider_quota"); await email("rate", "pending", "resend_429");
    await email("scheduled", "pending", null); await email("overdue", "pending", null, { dueInMin: -10 });
    await email("lost", "failed", "retries_exhausted"); await email("quota-gone", "failed", "provider_quota", { failedHoursAgo: 23 });
    await email("suppressed", "failed", "suppressed_staff"); await email("history", "failed", "provider_quota", { failedHoursAgo: 25 });
    await q().query("insert into outbox(kind,dedupe_key,payload,status,error) values('email:M-02','sent','{}'::jsonb,'sent',null),('webhook:x','other','{}'::jsonb,'pending','provider_quota')");
    const { emails } = await operationalDetail(database.db);
    expect(emails.pending.map(({ error, n }) => ({ error, n }))).toEqual([{ error: "provider_quota", n: 2 }, { error: "resend_429", n: 1 }, { error: null, n: 1 }]);
    expect(emails.failed.map(({ error, n }) => ({ error, n }))).toEqual([{ error: "provider_quota", n: 1 }, { error: "retries_exhausted", n: 1 }, { error: "suppressed_staff", n: 1 }]);
    expect(emails.pending[0]!.oldest).toBeInstanceOf(Date);
    expect(JSON.stringify(emails)).not.toContain("guest@example.test");
    expect(await operationalStatus(database.db)).toEqual({ diditApi: "ok" });
  });
});
