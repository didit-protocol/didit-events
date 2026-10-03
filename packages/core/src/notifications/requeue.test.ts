// Recovery of emails the provider refused (v8): which failed rows go back in the queue, and which never do.
import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
import type { Db } from "../db/index.ts";
import { queryable } from "../db/tx.ts";
import { dispatchOutbox,OutboxRegistry } from "../outbox.ts";
import { resetDatabase,testDatabase } from "../testing/database.ts";
import { requeueFailedEmails } from "./requeue.ts";

describe("requeue failed emails (pglite)", () => {
  let db: Db, close: () => Promise<void>;
  beforeAll(async () => { ({ db, close } = await testDatabase("pglite")); }, 60_000);
  beforeEach(async () => { await resetDatabase(db); });
  afterAll(async () => { await close?.(); });
  const q = () => queryable(db), owner = { email: "owner@didit.me" };
  /** An outbox row `ageHours` old; failed rows failed one hour after they were created. */
  const row = (key: string, o: { kind?: string; status?: string; error?: string | null; ageHours?: number; payload?: null } = {}) => q().query(
    `insert into outbox(kind,dedupe_key,payload,status,attempts,error,created_at,failed_at,sent_at,provider_id,next_attempt_at)
     values($1,$2,$3::jsonb,$4,12,$5,clock_timestamp()-$6::int * interval '1 hour',case when $4='failed' then clock_timestamp()-($6::int-1) * interval '1 hour' end,
       case when $4='sent' then clock_timestamp() end,case when $4='sent' then 're_sent' end,clock_timestamp()-$6::int * interval '1 hour')`,
    [o.kind ?? "email:M-02", key, o.payload === null ? null : JSON.stringify({ code: "M-02", accountId: "a" }), o.status ?? "failed", o.error === undefined ? "provider_quota" : o.error, o.ageHours ?? 3]);
  const state = () => q().query<{ dedupe_key: string; status: string; attempts: number; error: string | null; due: boolean; failed: boolean }>(
    "select dedupe_key,status,attempts,error,next_attempt_at<=clock_timestamp() due,failed_at is not null failed from outbox order by dedupe_key");
  const pending = async () => (await state()).filter(r => r.status === "pending").map(r => r.dedupe_key);

  it("re-queues only failed emails with a retryable provider error; sent, suppressed and rejected rows are never touched", async () => {
    await row("quota"); await row("exhausted", { error: "retries_exhausted", kind: "email:M-06" }); await row("rate", { error: "resend_429" });
    await row("outage", { error: "resend_503" }); await row("network", { error: "resend_network" });
    await row("suppressed", { error: "suppressed_staff" }); await row("preference", { error: "suppressed_preference" }); await row("rejected", { error: "resend_422" });
    await row("render", { error: "render_failed" }); await row("sent", { status: "sent", error: null }); await row("sent-odd", { status: "sent", error: "provider_quota" });
    await row("cancelled", { status: "failed", payload: null }); await row("old", { ageHours: 60 }); await row("verification", { kind: "verification.create", error: "retries_exhausted" });
    const before = await state();
    const result = await requeueFailedEmails(owner, {}, db);
    expect(result).toEqual({ dryRun: false, hours: 48, total: 5, counts: { provider_quota: 1, resend_429: 1, resend_503: 1, resend_network: 1, retries_exhausted: 1 }, kinds: { "email:M-02": 4, "email:M-06": 1 } });
    const after = await state(), moved = ["exhausted", "network", "outage", "quota", "rate"];
    expect(after.filter(r => moved.includes(r.dedupe_key))).toEqual(moved.map(dedupe_key => ({ dedupe_key, status: "pending", attempts: 0, error: null, due: true, failed: false })));
    expect(after.filter(r => !moved.includes(r.dedupe_key))).toEqual(before.filter(r => !moved.includes(r.dedupe_key)));
    expect(await q().query("select actor,action,target,data from audit")).toEqual([{ actor: "owner@didit.me", action: "outbox.requeue", target: "outbox",
      data: { hours: 48, codes: ["provider_quota", "retries_exhausted", "resend_429", "resend_5xx", "resend_network"], total: 5, counts: result.counts } }]);
    // Idempotent: nothing is left to re-queue, and nothing more is recorded.
    expect(await requeueFailedEmails(owner, {}, db)).toMatchObject({ total: 0, counts: {}, kinds: {} });
    expect(await q().query("select id from audit")).toHaveLength(1);
    // A re-queued row is dispatched like any other, under its original dedupe key (the provider's Idempotency-Key).
    const registry = new OutboxRegistry(), keys: string[] = [];
    for (const kind of ["email:M-02", "email:M-06"]) registry.register(kind, async message => { keys.push(message.dedupe_key); return { providerId: `re_${message.dedupe_key}` }; });
    while (await dispatchOutbox(db, registry)) { /* until idle */ }
    expect(keys.sort()).toEqual(moved);
    expect((await state()).filter(r => moved.includes(r.dedupe_key)).every(r => r.status === "sent" && r.attempts === 1)).toBe(true);
    expect(await requeueFailedEmails(owner, {}, db)).toMatchObject({ total: 0 });
  });

  it("dry run only counts", async () => {
    await row("quota"); await row("exhausted", { error: "retries_exhausted" }); await row("suppressed", { error: "suppressed_staff" });
    const before = await state();
    expect(await requeueFailedEmails(owner, { dryRun: true }, db)).toEqual({ dryRun: true, hours: 48, total: 2, counts: { provider_quota: 1, retries_exhausted: 1 }, kinds: { "email:M-02": 2 } });
    expect(await state()).toEqual(before);
    expect(await q().query("select id from audit")).toEqual([]);
  });

  it("filters by error code and by how long ago the email failed (default 48 h, at most 168 h)", async () => {
    await row("quota"); await row("exhausted", { error: "retries_exhausted" }); await row("outage", { error: "resend_500" });
    await row("day-old", { ageHours: 30 }); await row("days-old", { ageHours: 100 }); await row("ancient", { ageHours: 200 });
    expect(await requeueFailedEmails(owner, { codes: ["resend_5xx"], dryRun: true }, db)).toMatchObject({ total: 1, counts: { resend_500: 1 } });
    expect(await requeueFailedEmails(owner, { codes: ["provider_quota"], hours: 24 }, db)).toMatchObject({ total: 1, counts: { provider_quota: 1 } });
    expect(await pending()).toEqual(["quota"]);
    expect(await requeueFailedEmails(owner, { codes: ["provider_quota", "provider_quota"] }, db)).toMatchObject({ total: 1 });
    expect(await pending()).toEqual(["day-old", "quota"]);
    expect(await requeueFailedEmails(owner, { hours: 10_000 }, db)).toMatchObject({ hours: 168, total: 3, counts: { provider_quota: 1, resend_500: 1, retries_exhausted: 1 } });
    expect(await pending()).toEqual(["day-old", "days-old", "exhausted", "outage", "quota"]);
  });
});
