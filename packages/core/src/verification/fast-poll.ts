import { consume } from "../counters.ts";
import type { Db } from "../db/index.ts";
import { queryable,withTx,type Tx } from "../db/tx.ts";
import type { DiditClient } from "../didit/client.ts";
import { VerificationIgnored } from "./shared.ts";

/**
 * Webhook-free fallback for a guest who is watching their verification (localhost, a delayed or lost webhook): while
 * the account has an active verification operation with a Didit session, read the Didit decision directly and, when
 * the provider status moved, apply it through the SAME decision path the webhook inbox uses (`applyDecision` under the
 * account lock, which then NOTIFYs `account_<id>`).
 *
 * Bounded and deduped with database counters, so any number of tabs or app instances share one budget:
 * - at most one decision read per account every 2 s (`dedupe`),
 * - at most 60 reads per account per 15 minutes (`budget`),
 * - at most 300 reads per minute for the whole app (`global`).
 * Decision reads are free (no session is created, nothing is reserved against the spend caps); a read never happens
 * without an active operation, and a status that did not change is never re-applied.
 */
export const FAST_POLL_LIMITS = {
  dedupe: { limit: 1, windowSec: 2 },
  budget: { limit: 60, windowSec: 900 },
  global: { limit: 300, windowSec: 60 },
} as const;

export type FastPollResult =
  | { state: "idle" }
  | { state: "limited"; scope: "dedupe" | "budget" | "global" }
  | { state: "unchanged"; status: string }
  | { state: "applied"; status: string }
  | { state: "ignored" };

export interface FastPollOptions {
  db: Db;
  client: Pick<DiditClient, "getDecision">;
  /** The webhook's decision path (EvidenceLifecycle.applyDecision). */
  applyDecision: (tx: Tx, accountId: string, sessionId: string) => Promise<unknown>;
  /** Tests shorten the windows; production uses FAST_POLL_LIMITS. */
  limits?: { [K in keyof typeof FAST_POLL_LIMITS]: { limit: number; windowSec: number } };
}

export async function pollActiveDecision(options: FastPollOptions, accountId: string): Promise<FastPollResult> {
  const q = queryable(options.db);
  const [active] = await q.query<{ session_id: string; provider_status: string | null }>(
    `select op.didit_session_id as session_id,v.provider_status from verification_ops op join verifications v on v.id=op.verification_id
     where op.account_id=$1 and op.purpose<>'legacy' and op.state='active' and op.expires_at>clock_timestamp() and op.didit_session_id is not null
       and v.reconcile_state<>'ignored' and (v.provider_status is null or v.provider_status not in ('Approved','Declined','Expired','Kyc Expired','Abandoned'))
     order by op.created_at desc limit 1`, [accountId]);
  if (!active) return { state: "idle" };
  for (const scope of ["dedupe", "budget", "global"] as const) {
    const { limit, windowSec } = (options.limits ?? FAST_POLL_LIMITS)[scope];
    const key = scope === "global" ? "verification:fastpoll" : `verification:fastpoll:${scope}:${accountId}`;
    if (!(await consume(key, limit, windowSec, options.db)).allowed) return { state: "limited", scope };
  }
  const decision = await options.client.getDecision(active.session_id);
  if (decision.session_id !== active.session_id) return { state: "ignored" };
  // Only operations whose stored status is not terminal are selected, so an equal status is still in progress.
  if (decision.status === active.provider_status) return { state: "unchanged", status: decision.status };
  try {
    await withTx(tx => options.applyDecision(tx, accountId, active.session_id), options.db);
  } catch (error) {
    if (error instanceof VerificationIgnored) return { state: "ignored" };
    throw error;
  }
  return { state: "applied", status: decision.status };
}
