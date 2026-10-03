import { sessionLiveSql } from "../identity/shared.ts";
import { createHash } from "node:crypto";
import type { Db } from "../db/index.ts";
import type { Queryable, Tx } from "../db/tx.ts";
import type { DiditClient } from "../didit/client.ts";
import type { Account, SessionService } from "../domain/services.ts";

export type WorkflowKind = "full" | "renewal" | "age";
export interface WorkflowConfig { kind: WorkflowKind; maxPriceUsd: number }
export interface VerificationOptions {
  db: Db;
  client: Pick<DiditClient, "createSession" | "listSessions" | "getDecision">;
  workflows: Readonly<Record<string, WorkflowConfig>>;
  appUrl: string;
  sessions: Pick<SessionService, "resolve">;
  appDailyCapUsd: number;
  eventDailyCapUsd: number;
  totalCapUsd: number;
  log?: (event: string, fields: Record<string, unknown>) => void;
}
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const hashToken = (value: string): string => createHash("sha256").update(value).digest("hex");
export const accountFromVendor = (vendor: unknown): string | null => typeof vendor === "string" && vendor.startsWith("acct_") && uuidPattern.test(vendor.slice(5)) ? vendor.slice(5).toLowerCase() : null;
/** SQL rows use snake_case; JSON values retain their provider/domain keys. */
export async function rows<T>(q: Queryable, text: string, params: unknown[] = []): Promise<T[]> {
  return (await q.query(text, params)).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value])) as T);
}
export async function dbNow(q: Queryable): Promise<Date> {
  return (await q.query<{ now: Date }>("select clock_timestamp() as now"))[0]!.now;
}
export class VerificationIgnored extends Error { constructor() { super("VerificationIgnored"); } }
export async function liveAccount(q: Queryable, accountId: string, sessionId?: string): Promise<Account> {
  const [account] = await rows<Account>(q, "select * from accounts where id=$1 and deleting_at is null and deleted_at is null", [accountId]);
  if (!account || (await q.query(`select id from deletions where account_id=$1 or original_account_id=$1 or (email_hash=$2 and state<>'complete')
    or ($3::text is not null and didit_session_ids ? $3) limit 1`, [accountId, hashToken(account.email), sessionId ?? null])).length) throw new VerificationIgnored();
  return account;
}
export async function isTombstoned(q: Queryable, sessionId: string): Promise<boolean> {
  return (await q.query("select id from deletions where didit_session_ids ? $1 limit 1", [sessionId])).length > 0;
}
export async function guestSession(tx: Tx, accountId: string, sessionId: string, fresh = false): Promise<void> {
  const [session] = await tx.query(`select s.id from sessions s where s.id=$1 and account_id=$2 and principal='guest'
    and (${sessionLiveSql()})
    and authenticated_at<=clock_timestamp()
    and (not $3::boolean or authenticated_at>clock_timestamp()-interval '15 minutes')`, [sessionId, accountId, fresh]);
  if (!session) throw new Error("GuestAuthenticationRequired");
}
