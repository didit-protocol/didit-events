import { queryable } from "@didit-events/core/db/tx";
import { testDatabase } from "@didit-events/core/testing/database";
import { afterAll,beforeAll,expect,it } from "vitest";
import { seedEvents } from "../../scripts/seed-events";
let database: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { database = await testDatabase(process.env.TEST_DATABASE_URL ? "postgres" : "pglite"); }, 60000);
afterAll(async () => { await database?.close(); });
it("rejects production before any writes unless explicitly allowed", async () => {
  const before = await queryable(database.db).query("select * from staff");
  await expect(seedEvents(database.db, { NODE_ENV: "production" })).rejects.toThrow("SEED_ALLOW");
  expect(await queryable(database.db).query("select * from staff")).toEqual(before);
});
it("seeds exact content and roles once, no guests, and preserves subsequent edits and the test date", async () => {
  const q = queryable(database.db), now = new Date("2026-09-29T12:00:00Z");
  expect(await seedEvents(database.db, { NODE_ENV: "production", SEED_ALLOW: "1" }, now)).toHaveLength(2);
  expect((await q.query<{ email: string; role: string }>("select email,role from staff")).sort((a, b) => a.email < b.email ? -1 : 1)).toEqual([{ email: "events.owner@didit.me", role: "owner" }, { email: "events.team@didit.me", role: "admin" }]);
  const [real] = await q.query("select * from events where slug='ai-era'");
  expect(real).toMatchObject({ name: "Building, Raising & Scaling in the AI Era", starts_at: new Date("2026-10-08T16:30:00Z"), ends_at: new Date("2026-10-08T19:30:00Z"), timezone: "Europe/Madrid", venue: "Didit HQ", capacity: 120, checks:{version:1,required:[],max_age:{}} });
  expect(real!.agenda).toHaveLength(6); expect(real!.speakers).toEqual([{ name: "Alberto Rosas", role: "Didit · CEO", email: "events.owner@didit.me" }, { name: "Uma Bramwell", role: "Didit" }]);
  const [test] = await q.query("select * from events where slug='e2e-test-event'");
  expect(test).toMatchObject({ name: "E2E Test Event", capacity: 10, door: { kiosk:true,mode:"supervised",match_threshold:80 }, starts_at: new Date("2026-09-30T16:30:00Z") });
  await q.query("update events set capacity=121 where slug='ai-era'");
  const before = await q.query("select * from events order by slug");
  await seedEvents(database.db, { NODE_ENV: "development" }, new Date("2026-10-02T12:00:00Z"));
  expect(await q.query("select * from events order by slug")).toEqual(before);
  for (const table of ["accounts", "registrations", "sessions", "outbox"]) expect(await q.query(`select * from ${table}`)).toEqual([]);
});


it("seeds only the configured owner for forks, preserving an existing role", async () => {
  const q = queryable(database.db);
  await q.query("truncate staff cascade");
  const env = { NODE_ENV: "development", STAFF_EMAIL_DOMAIN: "fork.test", SEED_OWNER_EMAIL: "Owner@Fork.Test" } as const;
  await seedEvents(database.db, env);
  expect(await q.query("select email,role from staff")).toEqual([{ email: "owner@fork.test", role: "owner" }]);
  await q.query("update staff set role='admin'");
  await seedEvents(database.db, env);
  expect(await q.query("select email,role from staff")).toEqual([{ email: "owner@fork.test", role: "admin" }]);
});
it("refuses a fork without a usable owner before inserting any staff or events", async () => {
  const q = queryable(database.db);
  const before = await q.query("select email,role from staff order by email");
  const eventsBefore = await q.query("select id from events order by id");
  await expect(seedEvents(database.db, { NODE_ENV: "development", STAFF_EMAIL_DOMAIN: "fork.test" })).rejects.toThrow("SEED_OWNER_EMAIL is required");
  expect(await q.query("select email,role from staff order by email")).toEqual(before);
  expect(await q.query("select id from events order by id")).toEqual(eventsBefore);
});
