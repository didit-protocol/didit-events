import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import * as retention from "@didit-events/core/admission/retention";
import { queryable } from "@didit-events/core/db/tx";
import { seed, testDatabase } from "@didit-events/core/testing/database";
import { cleanup } from "./workers";

let database: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { database = await testDatabase(process.env.TEST_DATABASE_URL ? "postgres" : "pglite"); }, 60000);
afterAll(async () => { await database?.close(); });
it("cleans expired links while retaining active and revoked hashes until expiry", async () => {
  const { registrationId } = await seed(database.db), q = queryable(database.db);
  const active = randomUUID(), revoked = randomUUID(), expired = randomUUID();
  await q.query(`insert into link_tokens(hash,registration_id,expires_at,revoked_at) values
    ($1,$4,clock_timestamp()+interval '1 day',null),
    ($2,$4,clock_timestamp()+interval '1 day',clock_timestamp()),
    ($3,$4,clock_timestamp()-interval '1 day',null)`, [active, revoked, expired, registrationId]);
  await cleanup(database.db);
  expect((await q.query<{ hash: string }>("select hash from link_tokens")).map(r => r.hash).sort()).toEqual([active, revoked].sort());
  expect(await q.query("select id from registrations where id=$1", [registrationId])).toHaveLength(1);
});
it("prunes expired credentials before request retention and contains retention failures", async () => {
  const { registrationId } = await seed(database.db), q = queryable(database.db), expired=randomUUID();
  await q.query("insert into link_tokens(hash,registration_id,expires_at) values($1,$2,clock_timestamp()-interval '1 day')",[expired,registrationId]);
  let expiredAtRetention:unknown;
  const retain=vi.spyOn(retention,"retainRequestData").mockImplementationOnce(async () => {
    expiredAtRetention=await q.query("select hash from link_tokens where hash=$1",[expired]);
    throw new Error("Retention unavailable");
  });
  const logged=vi.spyOn(console,"info").mockImplementation(()=>{});
  try {
    await expect(cleanup(database.db)).resolves.toBeUndefined();
    expect(retain).toHaveBeenCalledOnce();
    expect(expiredAtRetention).toEqual([]);
    expect(await q.query("select id from registrations where id=$1",[registrationId])).toHaveLength(1);
  } finally {retain.mockRestore();logged.mockRestore();}
});
