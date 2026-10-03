import { admissionService,eventService,type GuestPrincipal,type StaffPrincipal } from "@didit-events/core";
import type { Db } from "@didit-events/core/db";
import { queryable } from "@didit-events/core/db/tx";
import { fakeDiditServer } from "@didit-events/core/didit/fake-server";
import { jobHandlers } from "@didit-events/core/jobs";
import { LIFECYCLE_JOBS,OUTBOX_RETENTION_JOB,PROFILE_REMINDER_JOB } from "@didit-events/core/notifications";
import type * as Workers from "@didit-events/core/workers";
import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,expect,it,vi } from "vitest";
import { testDatabase } from "../../../../packages/core/src/testing/database.ts";
import { emptyForm,guestFixture,requestFixture,staffFixture } from "../../../../packages/core/src/testing/model.ts";
import { startWorkers,stopWorkers } from "./workers";

// Keep real registrations and dispatchers; the test advances each worker clock explicitly.
const clock = vi.hoisted(() => ({ ticks: [] as Array<() => Promise<unknown>> }));
vi.mock("@didit-events/core/workers", async importOriginal => ({
  ...await importOriginal<typeof Workers>(),
  workerLoop: (tick: () => Promise<unknown>, { signal }: { signal: AbortSignal }) => {
    clock.ticks.push(tick);
    return new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
  },
}));
let database: Awaited<ReturnType<typeof testDatabase>>, fake: Awaited<ReturnType<typeof fakeDiditServer>>;
const state = globalThis as typeof globalThis & { __diditEventsDb?: Db; __eventsWorkerState?: unknown };
const owner: StaffPrincipal = { principal: "staff", email: "owner@didit.me", role: "owner", sessionId: randomUUID() };
const workflow = randomUUID();
const term = new Set(process.listeners("SIGTERM")), interrupt = new Set(process.listeners("SIGINT"));
beforeAll(async () => {
  database = await testDatabase(process.env.TEST_DATABASE_URL ? "postgres" : "pglite");
  state.__diditEventsDb = database.db;
  fake = await fakeDiditServer();
  for (const [key, value] of Object.entries({ WORKERS: "1", VERIFICATION_WORKERS: "1", DIDIT_API_KEY: "fixture-key",
    DIDIT_API_URL: fake.url, DIDIT_WORKFLOW_ID: workflow, DIDIT_RENEWAL_WORKFLOW_ID: "", DIDIT_AGE_WORKFLOW_ID: "",
    SESSION_SECRET: "i1-worker-fixture-secret-over-thirty-two-characters", RESEND_API_KEY: "fixture-key", APP_URL: "https://events.example.test" })) vi.stubEnv(key, value);
  await staffFixture(database.db,owner);
}, 60_000);
afterAll(async () => {
  await stopWorkers();
  delete state.__eventsWorkerState; delete state.__diditEventsDb;
  for (const fn of process.listeners("SIGTERM")) if (!term.has(fn)) process.removeListener("SIGTERM", fn);
  for (const fn of process.listeners("SIGINT")) if (!interrupt.has(fn)) process.removeListener("SIGINT", fn);
  vi.unstubAllEnvs();
  await fake?.close(); await database?.close();
});

it("one shared worker tick promotes after cancellation, runs every family and leaves unknown jobs untouched", async () => {
  await Promise.all([startWorkers(), startWorkers()]);
  expect(clock.ticks).toHaveLength(3);
  const q = queryable(database.db);
  const event = await eventService.create(owner, { slug: randomUUID(), name: "Shared scheduler", capacity: 1, venue:"HQ",address:"One Street",form:{...emptyForm,mode:"open"},
    startsAt: new Date(Date.now() + 48 * 3600_000), endsAt: new Date(Date.now() + 50 * 3600_000) });
  await eventService.publish(owner, event.id);
  const guest=()=>guestFixture(database.db);
  const apply=async(g:GuestPrincipal,eventId:string)=>admissionService.apply(g,eventId,await requestFixture(database.db,g,eventId));
  const first = await guest(), next = await guest();
  const admitted = await apply(first, event.id), waiting = await apply(next, event.id);
  expect(admitted.admission).toBe("approved"); expect(waiting.admission).toBe("waitlisted");
  await admissionService.transition(first, admitted.id, "cancelled_by_guest", "Cannot attend");
  // This job did not exist at bootstrap; discovery must happen before the very next claim.
  expect(jobHandlers.get(`waitlist:${event.id}`)).toBeUndefined();
  const cancelled = await eventService.create(owner, { slug: randomUUID(), name: "Interrupted cancellation", capacity: 2,venue:"HQ",address:"One Street",
    startsAt: event.startsAt, endsAt: event.endsAt });
  await eventService.publish(owner, cancelled.id);
  const cancelledGuest = await apply(await guest(), cancelled.id);
  await q.query("update events set status='cancelled' where id=$1", [cancelled.id]);
  await q.query("insert into jobs(name,interval_sec,payload) values($1,15,$2::jsonb)",
    [`cancel-event:${cancelled.id}`, JSON.stringify({ eventId: cancelled.id, actor: owner, reason: "Venue closed" })]);
  await q.query("insert into sessions(token_hash,principal,auth_method,staff_email,expires_at) values('expired','staff','oidc_google',$1,clock_timestamp()-interval '2 days')", [owner.email]);
  const kioskId = randomUUID();
  await q.query("insert into kiosks(id,event_id,name) values($1,$2,'Door')", [kioskId, event.id]);
  // A door session that ended eight days ago is dropped; yesterday's is kept for the Door tab and audit.
  const [account] = await q.query<{ id: string }>("insert into accounts(email) values('door-worker@example.test') returning id");
  for (const [hash, ended] of [["old-door", "8 days"], ["recent-door", "1 day"]]) await q.query(`insert into door_sessions(event_id,kiosk_id,account_id,email,token_hash,expires_at,ended_at)
    values($1,$2,$3,'door-worker@example.test',$4,clock_timestamp()+interval '1 hour',clock_timestamp()-$5::interval)`, [event.id, kioskId, account!.id, hash, ended]);
  // More unknown rows than the dispatch limit must neither starve known jobs nor be rewritten.
  await q.query(`insert into jobs(name,interval_sec,attempts,error,next_run_at) select 'unknown:'||n,60,3,'unchanged',clock_timestamp()-interval '1 day' from generate_series(1,101) n`);
  const unknown = await q.query("select * from jobs where name like 'unknown:%' order by name");
  await clock.ticks[2]!();
  expect(await q.query("select admission from registrations where id=$1", [waiting.id])).toEqual([{ admission: "approved" }]);
  expect(await q.query("select admission from registrations where id=$1", [cancelledGuest.id])).toEqual([{ admission: "cancelled_by_host" }]);
  expect(await q.query("select * from jobs where name like 'unknown:%' order by name")).toEqual(unknown);
  const names = ["b1.reconcile", "b1.retention", "identity:deletions", "events:cleanup", "events:end",
    `waitlist:${event.id}`, `cancel-event:${cancelled.id}`, ...Object.values(LIFECYCLE_JOBS), OUTBOX_RETENTION_JOB, PROFILE_REMINDER_JOB];
  expect(jobHandlers.names()).toEqual(expect.arrayContaining(names));
  const completed = await q.query("select name,attempts,error,last_run_at is not null as ran from jobs where name=any($1::text[]) order by name", [names]);
  expect(completed).toEqual(names.sort().map(name => ({ name, attempts: 0, error: null, ran: true })));
  expect(await q.query("select id from sessions where token_hash='expired'")).toEqual([]);
  expect(await q.query("select token_hash from door_sessions order by token_hash")).toEqual([{ token_hash: "recent-door" }]);
});
