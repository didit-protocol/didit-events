import { getDb } from "../db/index.ts";
import { DiditClient } from "../didit/client.ts";
import { serverEnv } from "../env.ts";
import { sessionService } from "../domain/services.ts";
import { log } from "../log.ts";
import { jobHandlers, type JobRegistry } from "../jobs.ts";
import type { WorkflowConfig } from "./shared.ts";
import { VerificationLifecycle } from "./verification-service.ts";
import { registerVerificationHandlers, scheduleVerificationJobs } from "./workers.ts";

let runtime: VerificationLifecycle | undefined;
export function getVerificationRuntime(): VerificationLifecycle {
  if (runtime) return runtime;
  const env = serverEnv();
  const workflows: Record<string, WorkflowConfig> = { [env.DIDIT_WORKFLOW_ID]: { kind: "full", maxPriceUsd: 0.23 } };
  if (env.DIDIT_RENEWAL_WORKFLOW_ID) workflows[env.DIDIT_RENEWAL_WORKFLOW_ID] = { kind: "renewal", maxPriceUsd: 0.10 };
  if (env.DIDIT_AGE_WORKFLOW_ID) workflows[env.DIDIT_AGE_WORKFLOW_ID] = { kind: "age", maxPriceUsd: env.DIDIT_AGE_WORKFLOW_MAX_PRICE_USD ?? 0 };
  runtime = new VerificationLifecycle({ db: getDb(), client: new DiditClient({ apiKey: env.DIDIT_API_KEY, workflows }), workflows,
    sessions: sessionService, appUrl: env.APP_URL, appDailyCapUsd: env.DIDIT_APP_DAILY_CAP_USD, eventDailyCapUsd: env.DIDIT_EVENT_DAILY_CAP_USD,
    totalCapUsd: env.DIDIT_SPEND_CAP_USD, log });
  return runtime;
}
let registered = false;
export async function initializeVerificationWorkers(jobs: JobRegistry = jobHandlers) {
  const service = getVerificationRuntime();
  if (!registered) { registerVerificationHandlers(service, { jobs }); registered = true; }
  await scheduleVerificationJobs(service);
}
