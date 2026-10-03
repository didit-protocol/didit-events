import { consume } from "../counters.ts";
import { getDb, type Db } from "../db/index.ts";
import { ModelError } from "../domain/model-error.ts";
import { hash } from "../identity/shared.ts";

/** Across events and sessions. Charge attempts before request processing, including rejected submissions. */
export async function limitRequestSubmission(accountId: string, ip: string, db: Db = getDb()) {
  for (const [key, limit] of [[`request:ip:${hash(ip)}`, 60], [`request:account:${accountId}`, 10]] as const) {
    const budget = await consume(key, limit, 600, db);
    if (!budget.allowed) throw new ModelError("rate_limited", "Please wait before submitting another request.", undefined, undefined, Math.max(1000, budget.resetsAt.getTime() - Date.now()));
  }
}
