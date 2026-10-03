import { afterAll, beforeAll, beforeEach, expect, it, vi, afterEach } from "vitest";
import { limitRequestSubmission } from "@didit-events/core/admission/request-limits";
import { testDatabase, resetDatabase } from "@didit-events/core/testing/database";
import { queryable } from "@didit-events/core/db/tx";
import { failure } from "./event-model-api";
import { sourceIpFromHeaders } from "../auth/source-ip";
let database: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { database = await testDatabase(process.env.TEST_DATABASE_URL ? "postgres" : "pglite"); });
beforeEach(async () => { await resetDatabase(database.db); });
afterAll(async () => { await database?.close(); });
afterEach(() => vi.unstubAllEnvs());
it("shares account limits across IPs and emits 429 + Retry-After; expired windows recover", async () => {
  for (let i = 0; i < 10; i++) await limitRequestSubmission("account", `ip-${i}`, database.db);
  const error = await limitRequestSubmission("account", "new-ip", database.db).catch(e => e);
  const response = failure(error);
  expect(response.status).toBe(429); expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(await response.json()).toMatchObject({ error: { code: "rate_limited" } });
  await queryable(database.db).query("update counters set expires_at=clock_timestamp()-interval '1 second'");
  await expect(limitRequestSubmission("account", "new-ip", database.db)).resolves.toBeUndefined();
});
it("shares IP limits across accounts and caps concurrent attempts atomically", async () => {
  for (let i = 0; i < 60; i++) await limitRequestSubmission(`account-${i}`, "one-ip", database.db);
  await expect(limitRequestSubmission("another", "one-ip", database.db)).rejects.toMatchObject({ status: 429 });
  const results = await Promise.allSettled(Array.from({ length: 15 }, () => limitRequestSubmission("concurrent", "different-ip", database.db)));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(10);
});
it("selects the trusted proxy hop and ignores spoofed leftmost IPs", () => {
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  expect(sourceIpFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4, 192.0.2.1" }))).toBe("192.0.2.1");
  expect(sourceIpFromHeaders(new Headers())).toBe("unknown");
});
