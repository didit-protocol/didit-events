import { randomUUID } from "node:crypto";
import { getDb, type Db } from "./db/index.ts";
import { queryable, withTx, type Tx } from "./db/tx.ts";
import { log } from "./log.ts";
import { retryDelaySec, workerLoop } from "./workers.ts";

export interface OutboxMessage { id: string; kind: string; dedupe_key: string; payload: Record<string, unknown> | null; attempts: number }
/** Runs outside a DB transaction. Respect signal and use dedupe_key as the provider idempotency key. */
export type OutboxHandler = (message: OutboxMessage, context: { signal: AbortSignal }) => Promise<{ providerId?: string } | void>;
/** A handler throws this for a send that must never be retried (4xx, suppressed recipient). `code` is stored, never a body. */
export class PermanentOutboxError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "PermanentOutboxError"; this.code = code; }
}
/** A retryable failure with a short stored code and an optional provider-requested minimum delay (Retry-After). */
export class RetryableOutboxError extends Error {
  readonly code: string; readonly retryAfterSec: number | undefined;
  constructor(code: string, retryAfterSec?: number) { super(code); this.name = "RetryableOutboxError"; this.code = code; this.retryAfterSec = retryAfterSec; }
}
/**
 * The provider's sending quota (daily or monthly) is spent: nothing is wrong with the message, it only has to wait.
 * The outbox retries it every QUOTA_RETRY_SEC without counting the attempt, until QUOTA_GIVE_UP_HOURS after the row
 * was created; then it fails with `provider_quota`.
 */
export const QUOTA_ERROR = "provider_quota";
export class QuotaOutboxError extends RetryableOutboxError {
  constructor(retryAfterSec?: number) { super(QUOTA_ERROR, retryAfterSec); this.name = "QuotaOutboxError"; }
}
export const QUOTA_RETRY_SEC = 3600, QUOTA_MAX_DELAY_SEC = 6 * 3600, QUOTA_GIVE_UP_HOURS = 48;
/** Bounded retries: after this many attempts a message is marked failed (its dedupe record stays). */
export const OUTBOX_MAX_ATTEMPTS = 12;
const ERROR_CODE = /^[a-z0-9_:.-]{1,64}$/;
const safeCode = (code: string, fallback: string): string => ERROR_CODE.test(code) ? code : fallback;
export class OutboxRegistry {
  private handlers = new Map<string, OutboxHandler>();
  register(kind: string, handler: OutboxHandler): void {
    if (this.handlers.has(kind)) throw new Error("DuplicateOutboxHandler");
    this.handlers.set(kind, handler);
  }
  get(kind: string): OutboxHandler | undefined { return this.handlers.get(kind); }
  kinds(): string[] { return [...this.handlers.keys()]; }
}
export const outboxHandlers = new OutboxRegistry();
export async function enqueue(tx: Tx, message: { kind: string; dedupeKey: string; payload: Record<string, unknown>; runAt?: Date }): Promise<string | null> {
  const [row] = await tx.query<{ id: string }>("insert into outbox (kind,dedupe_key,payload,next_attempt_at) values ($1,$2,$3::jsonb,coalesce($4::timestamptz,clock_timestamp())) on conflict (dedupe_key) do nothing returning id", [message.kind, message.dedupeKey, JSON.stringify(message.payload), message.runAt?.toISOString() ?? null]);
  return row?.id ?? null;
}
/**
 * Short SKIP LOCKED claim, followed by a renewable lease. No connection is held
 * during the handler, which may open its own domain/spend transactions on PGlite
 * or Postgres. A fencing token prevents a stale worker from checkpointing a
 * reclaimed message. External effects remain at-least-once across crashes.
 */
export async function dispatchOutbox(handle: Db = getDb(), registry: OutboxRegistry = outboxHandlers): Promise<boolean> {
  const claimToken = randomUUID(), leaseSec = 60;
  const row = await withTx(async tx => {
    const [message] = await tx.query<OutboxMessage & Record<string, unknown>>(`
      select * from outbox where status='pending' and kind=any($1::text[]) and next_attempt_at <= clock_timestamp()
      and (locked_until is null or locked_until <= clock_timestamp())
      order by next_attempt_at,id for update skip locked limit 1`, [registry.kinds()]);
    if (!message) return null;
    await tx.query(`update outbox set claim_token=$2,locked_until=clock_timestamp()+$3 * interval '1 second',
      attempts=attempts+1 where id=$1`, [message.id, claimToken, leaseSec]);
    return message;
  }, handle);
  if (!row) return false;

  const q = queryable(handle), controller = new AbortController();
  let renewing = false, renewal: Promise<void> = Promise.resolve();
  const heartbeat = setInterval(() => {
    if (renewing || controller.signal.aborted) return;
    renewing = true;
    renewal = q.query(`update outbox set locked_until=clock_timestamp()+$3 * interval '1 second'
      where id=$1 and claim_token=$2 and locked_until>clock_timestamp() returning id`, [row.id, claimToken, leaseSec])
      .then(rows => { if (!rows.length) controller.abort(); })
      .catch(() => { controller.abort(); })
      .finally(() => { renewing = false; });
  }, leaseSec * 1000 / 3);
  heartbeat.unref();

  let result: { providerId?: string } | void = undefined, failure: unknown = null, failed = false;
  try {
    const handler = registry.get(row.kind);
    if (!handler) throw new Error("MissingOutboxHandler");
    result = await handler(row, { signal: controller.signal });
  } catch (error) { failed = true; failure = error; }
  finally { clearInterval(heartbeat); await renewal; }

  if (controller.signal.aborted) return true; // Lease recovery owns any later retry.
  const attempt = row.attempts + 1;
  if (failed && failure instanceof QuotaOutboxError) {
    // A quota refusal is not an attempt: the claim's increment is undone and the row waits behind everything else due,
    // never past created_at + QUOTA_GIVE_UP_HOURS (a refusal at that moment fails it).
    const asked = Math.ceil(failure.retryAfterSec ?? 0);
    const delay = Math.min(QUOTA_MAX_DELAY_SEC, Math.max(QUOTA_RETRY_SEC, Number.isFinite(asked) ? asked : 0));
    const [after] = await q.query<{ status: string }>(`with due as (select id,created_at,created_at>clock_timestamp()-$4 * interval '1 hour' as waits from outbox where id=$1)
      update outbox o set claim_token=null,locked_until=null,error=$5,
        status=case when due.waits then 'pending' else 'failed' end,
        failed_at=case when due.waits then null else clock_timestamp() end,
        attempts=case when due.waits then greatest(o.attempts-1,0) else o.attempts end,
        next_attempt_at=case when due.waits then least(clock_timestamp()+$3 * interval '1 second',due.created_at+$4 * interval '1 hour') else o.next_attempt_at end
      from due where o.id=due.id and o.claim_token=$2 returning o.status`, [row.id, claimToken, delay, QUOTA_GIVE_UP_HOURS, QUOTA_ERROR]);
    if (after) log(after.status === "pending" ? "email.quota_deferred" : "email.quota_expired", { code: QUOTA_ERROR, kind: row.kind, ...(after.status === "pending" ? { retryInSec: delay } : {}) });
  } else if (failed && (failure instanceof PermanentOutboxError || attempt >= OUTBOX_MAX_ATTEMPTS)) {
    const code = failure instanceof PermanentOutboxError ? safeCode(failure.code, "permanent_failure") : "retries_exhausted";
    await q.query(`update outbox set status='failed',failed_at=clock_timestamp(),claim_token=null,locked_until=null,error=$3
      where id=$1 and claim_token=$2`, [row.id, claimToken, code]);
  } else if (failed) {
    const code = failure instanceof RetryableOutboxError ? safeCode(failure.code, "dispatch_failed") : "dispatch_failed";
    const delay = Math.max(retryDelaySec(attempt), failure instanceof RetryableOutboxError ? Math.min(3600, Math.ceil(failure.retryAfterSec ?? 0)) : 0);
    await q.query(`update outbox set claim_token=null,locked_until=null,error=$4,
      next_attempt_at=clock_timestamp()+$3 * interval '1 second' where id=$1 and claim_token=$2`,
    [row.id, claimToken, delay, code]);
  } else {
    await q.query(`update outbox set status='sent',sent_at=clock_timestamp(),provider_id=$3,error=null,
      claim_token=null,locked_until=null where id=$1 and claim_token=$2`, [row.id, claimToken, result?.providerId ?? null]);
  }
  return true;
}
export const runOutbox = (options: { signal: AbortSignal; intervalMs?: number; onError?: () => void }, handle: Db = getDb(), registry = outboxHandlers): Promise<void> => workerLoop(() => dispatchOutbox(handle, registry), options);
