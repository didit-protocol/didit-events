// Recovery for emails the provider refused for a reason that has since passed (a spent quota, the rate limit, an
// outage). Only failed `email:*` rows are touched: a sent row, a row our own rules dropped (`suppressed_*`) and a
// send the provider rejected for good (4xx) are never re-queued. Every send-time rule runs again when the row is
// dispatched, and the dedupe key (the provider's Idempotency-Key) is unchanged.
import { getDb,type Db } from "../db/index.ts";
import { withTx } from "../db/tx.ts";

export const REQUEUE_DEFAULT_HOURS = 48, REQUEUE_MAX_HOURS = 168;
/**
 * Stored failure codes a re-queue accepts. `retries_exhausted` is what a retryable provider error (429, 5xx,
 * network) becomes once the attempts run out; `resend_5xx` stands for every `resend_5nn`.
 */
export const REQUEUE_CODES = ["provider_quota", "retries_exhausted", "resend_429", "resend_5xx", "resend_network"] as const;
export type RequeueCode = (typeof REQUEUE_CODES)[number];
export interface RequeueResult { dryRun: boolean; hours: number; total: number; counts: Record<string, number>; kinds: Record<string, number> }

/**
 * Puts failed emails of the last `hours` back in the queue (attempts 0, due now) and returns how many per stored
 * error code and per email kind. `dryRun` only counts. A second call finds nothing left to re-queue.
 */
export async function requeueFailedEmails(actor: { email: string }, options: { hours?: number; codes?: readonly RequeueCode[]; dryRun?: boolean } = {}, db: Db = getDb()): Promise<RequeueResult> {
  const hours = Math.min(REQUEUE_MAX_HOURS, Math.max(1, Math.floor(options.hours ?? REQUEUE_DEFAULT_HOURS)));
  const codes = options.codes?.length ? [...new Set(options.codes)] : [...REQUEUE_CODES], dryRun = options.dryRun ?? false;
  const failed = `select id,error,kind from outbox where kind like 'email:%' and status='failed' and payload is not null
    and coalesce(failed_at,created_at)>clock_timestamp()-$1 * interval '1 hour'
    and (error=any($2::text[]) or ($3::boolean and error ~ '^resend_5[0-9][0-9]$'))`;
  const params = [hours, codes.filter(code => code !== "resend_5xx"), codes.includes("resend_5xx")];
  return withTx(async tx => {
    const rows = await tx.query<{ code: string; kind: string; n: number }>(dryRun
      ? `with failed as (${failed}) select error code,kind,count(*)::int n from failed group by 1,2`
      : `with failed as (${failed} for update skip locked), queued as (
          update outbox o set status='pending',attempts=0,next_attempt_at=clock_timestamp(),failed_at=null,error=null,claim_token=null,locked_until=null
          from failed where o.id=failed.id returning failed.error,failed.kind)
        select error code,kind,count(*)::int n from queued group by 1,2`, params);
    const tally = (key: "code" | "kind") => Object.fromEntries([...new Set(rows.map(r => r[key]))].sort().map(k => [k, rows.filter(r => r[key] === k).reduce((n, r) => n + r.n, 0)]));
    const result: RequeueResult = { dryRun, hours, total: rows.reduce((n, r) => n + r.n, 0), counts: tally("code"), kinds: tally("kind") };
    if (!dryRun && result.total) await tx.query("insert into audit(actor,action,target,data) values($1,'outbox.requeue','outbox',$2::jsonb)", [actor.email, JSON.stringify({ hours, codes, total: result.total, counts: result.counts })]);
    return result;
  }, db);
}
