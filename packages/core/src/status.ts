import { getDb, type Db } from "./db/index.ts";
import { queryable } from "./db/tx.ts";
import { recentServerErrors } from "./recent-errors.ts";
/**
 * A verification send counts while it is still pending and retrying or late, or failed in the last 30 minutes. A send
 * that failed for good earlier is history (the guest retried or support handles it), not a live outage.
 */
const STUCK_SEND = `((status='pending' and (attempts>0 or created_at<clock_timestamp()-interval '5 minutes'))
  or (status='failed' and coalesce(failed_at,created_at)>clock_timestamp()-interval '30 minutes'))`;
/** Stored provider failures/backlog, never a paid probe or a hard-coded health claim. */
export async function operationalStatus(db: Db = getDb()): Promise<{ diditApi: "ok" | "degraded" }> {
  const [row] = await queryable(db).query<{ degraded: boolean }>(`select
    exists(select 1 from inbox where processed_at is null and (attempts>0 or created_at<clock_timestamp()-interval '5 minutes'))
    or exists(select 1 from jobs where name='b1.reconcile' and (error is not null or next_run_at<clock_timestamp()-interval '5 minutes'))
    or exists(select 1 from outbox where (kind like 'verification.%' or kind='verify_invite') and ${STUCK_SEND}) as degraded`);
  return { diditApi: !process.env.DIDIT_API_KEY || row?.degraded ? "degraded" : "ok" };
}

/**
 * What makes `operationalStatus` report "degraded", for staff diagnosis: counts, kinds, error codes and ages only
 * (no payloads, emails or session ids). `emails` is separate from the banner: pending/failed email sends by error code.
 */
export async function operationalDetail(db: Db = getDb()) {
  const q = queryable(db);
  const inbox = await q.query<{ kind: string; error: string | null; n: number; attempts: number; oldest: Date }>(`select coalesce(substring(raw from '"webhook_type"\\s*:\\s*"([A-Za-z0-9_.]+)"'),case when raw is null then 'no_body' else 'unknown' end) kind,
      error,count(*)::int n,max(attempts)::int attempts,min(created_at) oldest
    from inbox where processed_at is null and (attempts>0 or created_at<clock_timestamp()-interval '5 minutes') group by 1,2 order by n desc limit 20`);
  const jobs = await q.query<{ name: string; error: string | null; next_run_at: Date }>("select name,left(error,200) error,next_run_at from jobs where name='b1.reconcile'");
  const outbox = await q.query<{ kind: string; status: string; error: string | null; n: number; attempts: number; oldest: Date }>(`select kind,status,left(error,200) error,count(*)::int n,max(attempts)::int attempts,min(created_at) oldest
    from outbox where (kind like 'verification.%' or kind='verify_invite') and ${STUCK_SEND} group by kind,status,left(error,200) order by n desc limit 20`);
  // Emails waiting on a retry (a spent provider quota shows as pending `provider_quota`) or due now, and those that failed in the last 24 hours.
  const emails = await q.query<{ status: "pending" | "failed"; error: string | null; n: number; oldest: Date }>(`select status,left(error,200) error,count(*)::int n,min(created_at) oldest
    from outbox where kind like 'email:%' and ((status='pending' and (error is not null or next_attempt_at<=clock_timestamp()))
      or (status='failed' and coalesce(failed_at,created_at)>clock_timestamp()-interval '24 hours'))
    group by status,left(error,200) order by n desc,error limit 50`);
  const emailRows = (status: string) => emails.filter(e => e.status === status).map(({ error, n, oldest }) => ({ error, n, oldest }));
  return { ...(await operationalStatus(db)), apiKeySet: !!process.env.DIDIT_API_KEY, stuckWebhooks: inbox, reconcileJob: jobs[0] ?? null,
    reconcileOverdue: !!jobs[0] && (jobs[0].error !== null || jobs[0].next_run_at.getTime() < Date.now() - 300_000), stuckVerificationSends: outbox,
    emails: { pending: emailRows("pending"), failed: emailRows("failed") },
    /** This server process only (call again to reach another task). */ recentErrors: recentServerErrors().slice(0, 20) };
}
