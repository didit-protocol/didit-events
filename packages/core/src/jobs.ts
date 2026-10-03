import { getDb, type Db } from "./db/index.ts";
import { advisoryKey, queryable, type Queryable } from "./db/tx.ts";
import { reportUnexpected } from "./error-reporting.ts";
import { retryDelaySec, workerLoop } from "./workers.ts";
export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;
export class JobRegistry {
  private handlers = new Map<string, JobHandler>();
  register(name: string, handler: JobHandler): void {
    if (this.handlers.has(name)) throw new Error("DuplicateJobHandler");
    this.handlers.set(name, handler);
  }
  get(name: string): JobHandler | undefined { return this.handlers.get(name); }
  names(): string[] { return [...this.handlers.keys()]; }
}
export const jobHandlers = new JobRegistry();
const localLocks = new WeakMap<Db, Set<string>>();
/** Session advisory lock on a RESERVED connection. Unlock is on that same connection in finally. */
export async function withJobLock<T>(name: string, fn: (connection: Queryable) => Promise<T>, handle: Db = getDb()): Promise<{ acquired: false } | { acquired: true; value: T }> {
  if (handle.kind === "pglite") {
    const locks = localLocks.get(handle) ?? new Set<string>(); localLocks.set(handle, locks);
    if (locks.has(name)) return { acquired: false };
    locks.add(name);
    try { return { acquired: true, value: await fn(queryable(handle)) }; } finally { locks.delete(name); }
  }
  // Job handlers need the ordinary pool for their own transactions. Holding its
  // last connection while waiting for a handler would deadlock the scheduler.
  const dedicated = handle.createDedicatedClient();
  const conn = await dedicated.reserve().catch(async error => { await dedicated.end(); throw error; });
  const pinned: Queryable = { async query<R extends Record<string, unknown>>(text: string, params: unknown[] = []) { return [...await conn.unsafe<R[]>(text, params as never[])]; } };
  let acquired = false;
  try {
    const [lock] = await pinned.query<{ locked: boolean }>("select pg_try_advisory_lock($1::bigint) as locked", [advisoryKey("job", name)]);
    acquired = lock?.locked === true;
    if (!acquired) return { acquired: false };
    return { acquired: true, value: await fn(pinned) };
  } finally {
    try {
      if (acquired) await pinned.query("select pg_advisory_unlock($1::bigint)", [advisoryKey("job", name)]);
    } finally {
      // Even an unlock failure must destroy the session, never return a possibly
      // locked connection to the application pool.
      conn.release();
      await dedicated.end({ timeout: 5 });
    }
  }
}
export async function scheduleJob(name: string, intervalSec: number, payload: Record<string, unknown> = {}, handle: Db = getDb()): Promise<void> {
  await queryable(handle).query("insert into jobs (name,interval_sec,payload) values ($1,$2,$3::jsonb) on conflict (name) do update set interval_sec=excluded.interval_sec,payload=excluded.payload", [name, intervalSec, JSON.stringify(payload)]);
}
/** Handlers are idempotent: a crash before the checkpoint intentionally causes a retry. */
export async function dispatchJobs(handle: Db = getDb(), registry = jobHandlers): Promise<number> {
  const due = await queryable(handle).query<{ name: string }>("select name from jobs where name=any($1::text[]) and next_run_at<=clock_timestamp() order by next_run_at limit 100", [registry.names()]);
  let ran = 0;
  for (const job of due) {
    const handler = registry.get(job.name);
    if (!handler) continue;
    const result = await withJobLock(job.name, async conn => {
      const [row] = await conn.query<{ interval_sec: number; payload: Record<string, unknown>; attempts: number }>("select * from jobs where name=$1 and next_run_at<=clock_timestamp()", [job.name]);
      if (!row) return false;
      try {
        await handler(row.payload);
        await conn.query("update jobs set last_run_at=clock_timestamp(),next_run_at=clock_timestamp()+$2 * interval '1 second',attempts=0,error=null where name=$1", [job.name, row.interval_sec]);
      } catch (error) {
        // Ids inside a per-entity job name are not tags.
        reportUnexpected(error, { worker: "jobs", job: job.name.replace(/[0-9a-f]{8}-[0-9a-f-]{27}|\d{4,}/gi, "*").slice(0, 80) });
        await conn.query("update jobs set attempts=attempts+1,error='job_failed',next_run_at=clock_timestamp()+$2 * interval '1 second' where name=$1", [job.name, retryDelaySec(row.attempts + 1)]);
      }
      return true;
    }, handle);
    if (result.acquired && result.value) ran++;
  }
  return ran;
}
export const runJobs = (options: { signal: AbortSignal; intervalMs?: number; onError?: () => void; beforeTick?: () => Promise<void> }, handle: Db = getDb(), registry = jobHandlers): Promise<void> => workerLoop(async () => {
  await options.beforeTick?.();
  await dispatchJobs(handle, registry);
}, options);
