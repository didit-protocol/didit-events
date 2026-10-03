import type { Db } from "../db/index.ts";
import { dispatchJobs, jobHandlers, runJobs, scheduleJob, type JobRegistry } from "../jobs.ts";
import { withTx } from "../db/tx.ts";
import { Admissions } from "./admission.ts";
import { Events } from "./events.ts";
import { database, read, signal } from "./shared.ts";
import type { StaffPrincipal } from "../domain/services.ts";
/** Register before each worker sweep so newly created per-event jobs are discovered by every replica. */
export async function registerAdmissionJobs(registry: JobRegistry, db?: Db): Promise<void> {
  const handle = database(db), admissions = new Admissions(handle), events = new Events(handle);
  const jobs = await read(db).query<{ name: string }>("select name from jobs where name like 'waitlist:%' or name like 'cancel-event:%'");
  for (const { name } of jobs) if (!registry.get(name)) registry.register(name, async payload => {
    if (name.startsWith("waitlist:")) { for (let i = 0; i < 50 && await admissions.promoteWaitlist(String(payload.eventId)); i++) { /* Own transaction per grant. */ } }
    else await events.finishCancellation(payload.actor as StaffPrincipal, String(payload.eventId), String(payload.reason));
  });
  if (!registry.get("events:end")) registry.register("events:end", async () => {
    // Event-only writer; it never acquires account/registration locks.
    await withTx(async tx => {
      const rows = await tx.query<{ id: string }>(`update events set status=(case when ends_at<=clock_timestamp() then 'ended' else 'live' end)::event_status,updated_at=clock_timestamp()
        where (status='published' and starts_at<=clock_timestamp()) or (status='live' and ends_at<=clock_timestamp()) returning id`);
      for (const r of rows) await signal(tx, r.id, "event");
    }, handle);
  });
  await scheduleJob("events:end", 15, {}, handle);
}

/** Compatibility entry point: admission uses the same registry and dispatcher as every other family. */
export async function dispatchAdmissionJobs(db?: Db, registry = jobHandlers): Promise<number> {
  const handle = database(db);
  await registerAdmissionJobs(registry, handle);
  return dispatchJobs(handle, registry);
}
export function runAdmissionWorker(options: { signal: AbortSignal; intervalMs?: number }, db?: Db) {
  const handle = database(db);
  return runJobs({ ...options, intervalMs: options.intervalMs ?? 5000, beforeTick: () => registerAdmissionJobs(jobHandlers, handle) }, handle, jobHandlers);
}
