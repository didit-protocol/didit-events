import { initializeVerificationWorkers,log,runInbox,runOutbox } from "@didit-events/core";
import { registerAdmissionJobs } from "@didit-events/core/admission/jobs";
import { retainRequestData } from "@didit-events/core/admission/retention";
import { getDb,type Db } from "@didit-events/core/db";
import { reportUnexpected } from "@didit-events/core/error-reporting";
import { queryable } from "@didit-events/core/db/tx";
import { identity } from "@didit-events/core/identity";
import { jobHandlers,runJobs,scheduleJob } from "@didit-events/core/jobs";
import { emailConfigFromEnv,registerNotifications,scheduleLifecycleJobs } from "@didit-events/core/notifications";

type WorkerState = { starting: Promise<void>; stop: () => Promise<void> };
const state = globalThis as typeof globalThis & { __eventsWorkerState?: WorkerState };

/** A shared promise fences concurrent instrumentation calls, including initialization. */
export function startWorkers(): Promise<void> {
  if (process.env.WORKERS === "0") return Promise.resolve();
  if (state.__eventsWorkerState) return state.__eventsWorkerState.starting;
  const controller = new AbortController();
  let running: Promise<void>[] = [];
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    controller.abort();
    await holder.starting.catch(() => {});
    await Promise.allSettled(running);
    log("events.workers_stopped", {});
  })();
  let exiting = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (exiting) return;
    exiting = true;
    void stop().finally(() => {
      // The launch scripts/Docker disable Next's competing process.exit handler.
      // Keep the HTTP process alive until every claimed worker tick has drained.
      if (process.env.NEXT_MANUAL_SIG_HANDLE === "1") process.exit(signal === "SIGINT" ? 130 : 143);
    });
  };
  const holder: WorkerState = { starting: Promise.resolve(), stop };
  state.__eventsWorkerState = holder;
  // A launcher can forward a signal already delivered to our process group.
  // Keep handlers installed while draining so that a duplicate cannot force exit.
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  holder.starting = Promise.resolve().then(async () => {
    const verification = Boolean(process.env.DIDIT_API_KEY) && process.env.VERIFICATION_WORKERS !== "0";
    if (verification) await initializeVerificationWorkers(jobHandlers);
    if (process.env.RESEND_API_KEY) {
      registerNotifications(emailConfigFromEnv(), { jobs: jobHandlers });
      await scheduleLifecycleJobs();
    }
    if (!jobHandlers.get("identity:deletions")) jobHandlers.register("identity:deletions", () => identity.processDeletions());
    await scheduleJob("identity:deletions", 60);
    if (!jobHandlers.get("events:cleanup")) jobHandlers.register("events:cleanup", () => cleanup());
    await scheduleJob("events:cleanup", 3600);
    await registerAdmissionJobs(jobHandlers);
    if (controller.signal.aborted) return;
    const launch = (name: string, run: (options: { signal: AbortSignal; onError: (error?: unknown) => void }) => Promise<void>) => {
      log("events.worker_started", { worker: name });
      // The loop hands over the error of a failed tick (database down, a bug in the dispatcher): log and report it.
      const onError = (error?: unknown) => { log("events.worker_failed", { worker: name }); if (!controller.signal.aborted) reportUnexpected(error, { worker: name }); };
      return run({ signal: controller.signal, onError })
        .catch(() => log("events.worker_stopped", { worker: name }));
    };
    running = [
      ...(verification ? [launch("inbox", runInbox)] : []),
      launch("outbox", runOutbox),
      launch("jobs", options => runJobs({ ...options,
        // Discover jobs created by requests before the shared scheduler claims them.
        beforeTick: () => registerAdmissionJobs(jobHandlers),
      }, getDb(), jobHandlers)),
    ];
  }).catch(error => {
    controller.abort();
    process.removeListener("SIGTERM", shutdown);
    process.removeListener("SIGINT", shutdown);
    // A partial registration must fail startup, never start a subset of the workers.
    throw error;
  });
  return holder.starting;
}

export async function stopWorkers(): Promise<void> { await state.__eventsWorkerState?.stop(); }

/** Preserve attendance and dedupe history; remove only expired credentials and retained scan rows. */
export async function cleanup(db: Db = getDb()) {
  const q = queryable(db);
  // Keep revoked hashes until expiry: a retried email must not recreate a revoked bearer token.
  await q.query("delete from link_tokens where expires_at<=clock_timestamp()");
  // Door sessions are kept a week after they end or expire (the Door tab and audit read them), then dropped.
  await q.query("delete from door_sessions where coalesce(ended_at,expires_at)<clock_timestamp()-interval '7 days'");
  await q.query("delete from scans where created_at<clock_timestamp()-interval '180 days'");
  try { await retainRequestData(db); }
  catch (error) { log("events.request_retention_failed", {}); reportUnexpected(error, { worker: "jobs", job: "events:cleanup", step: "request_retention" }); }
}
