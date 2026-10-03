import { skipPostgres } from "../testing/postgres.ts";
// Review follow-ups: the outbox's numeric retry contract, and the full Resend webhook caller guard.
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/index.ts";
import { queryable, withTx } from "../db/tx.ts";
import { dispatchOutbox, enqueue, OUTBOX_MAX_ATTEMPTS, OutboxRegistry, RetryableOutboxError } from "../outbox.ts";
import { resetDatabase, testDatabase } from "../testing/database.ts";
import { handleResendWebhook, verifyResendSignature } from "./index.ts";

const RAW_KEY = Buffer.from("resend-test-secret");
const SECRET = `whsec_${RAW_KEY.toString("base64")}`;
function signedHeaders(raw: string, now: Date, sigs?: (v1: string) => string): Headers {
  const id = `msg_${randomUUID()}`, ts = String(Math.floor(now.getTime() / 1000));
  const v1 = createHmac("sha256", RAW_KEY).update(`${id}.${ts}.${raw}`).digest("base64");
  return new Headers({ "content-type": "application/json", "svix-id": id, "svix-timestamp": ts, "svix-signature": sigs ? sigs(v1) : `v1,${v1}` });
}

describe("Resend webhook guard (no database needed: rejected before any write)", () => {
  const now = new Date();
  const raw = JSON.stringify({ type: "email.delivered", created_at: now.toISOString(), data: { email_id: "re_x" } });
  it.each(["authorization", "origin", "cookie", "x-csrf", "x-signature", "x-signature-v2"])("rejects a request carrying %s", async (h) => {
    const headers = signedHeaders(raw, now); headers.set(h, "x");
    await expect(handleResendWebhook(new Request("https://e.test/api/webhooks/resend", { method: "POST", body: raw, headers }), SECRET, { now })).rejects.toMatchObject({ status: 401 });
  });
  it("rejects non-POST", async () => {
    await expect(handleResendWebhook(new Request("https://e.test/api/webhooks/resend", { method: "GET", headers: signedHeaders(raw, now) }), SECRET, { now })).rejects.toMatchObject({ status: 401 });
  });
  it("accepts any valid v1 entry in a multi-entry svix-signature, ignores other versions", () => {
    expect(verifyResendSignature(raw, signedHeaders(raw, now, (v1) => `v1,AAAA v1,${v1}`), SECRET, now)).toBe(true);
    expect(verifyResendSignature(raw, signedHeaders(raw, now, (v1) => `v2,${v1}`), SECRET, now)).toBe(false);
    expect(verifyResendSignature(raw, signedHeaders(raw, now, () => "v1,AAAA v1a,BBBB"), SECRET, now)).toBe(false);
  });
});

const kinds = (!skipPostgres ? ["pglite", "postgres"] : ["pglite"]) as ("pglite" | "postgres")[];
for (const kind of kinds) {
  describe(`outbox retry contract (${kind})`, () => {
    let db: Db, close: (() => Promise<void>) | undefined;
    beforeAll(async () => { ({ db, close } = await testDatabase(kind)); }, 60_000);
    beforeEach(async () => { await resetDatabase(db); });
    afterAll(async () => { await close?.(); });
    const q = () => queryable(db);
    const row = async () => (await q().query<{ status: string; attempts: number; error: string | null; delay: number }>(
      "select status, attempts, error, extract(epoch from (next_attempt_at - clock_timestamp()))::float as delay from outbox"))[0]!;
    const makeDue = () => q().query("update outbox set next_attempt_at = clock_timestamp() - interval '1 second'");

    it(`gives up after exactly ${OUTBOX_MAX_ATTEMPTS} attempts with retries_exhausted`, async () => {
      const registry = new OutboxRegistry();
      let calls = 0;
      registry.register("test:fail", async () => { calls++; throw new RetryableOutboxError("upstream_5xx"); });
      await withTx(tx => enqueue(tx, { kind: "test:fail", dedupeKey: "k1", payload: {} }), db);
      for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 3; i++) { await makeDue(); await dispatchOutbox(db, registry); }
      expect(calls).toBe(OUTBOX_MAX_ATTEMPTS);
      expect(await row()).toMatchObject({ status: "failed", error: "retries_exhausted" });
    });

    it.each([
      [7200, 3600, "a huge Retry-After is capped at one hour"],
      [0, 0, "a zero Retry-After falls back to the backoff"],
      [-5, 0, "a negative Retry-After falls back to the backoff"],
      [undefined, 0, "no Retry-After uses the backoff"],
    ] as const)("Retry-After %s → at least %s s (%s)", async (retryAfter, minDelay, _why) => {
      const registry = new OutboxRegistry();
      registry.register("test:ra", async () => { throw new RetryableOutboxError("rate_limited", retryAfter as number | undefined); });
      await withTx(tx => enqueue(tx, { kind: "test:ra", dedupeKey: `ra-${String(retryAfter)}`, payload: {} }), db);
      await dispatchOutbox(db, registry);
      const r = await row();
      expect(r.status).not.toBe("failed");
      expect(r.delay).toBeGreaterThanOrEqual(minDelay - 2);
      expect(r.delay).toBeLessThanOrEqual(3600 + 2);
    });
  });
}
