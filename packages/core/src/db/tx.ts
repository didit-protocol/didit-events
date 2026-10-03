import { createHash } from "node:crypto";
import { getDb, type Db } from "./index.ts";

export interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>;
}
/** A pinned transaction. Never keep it, or perform external effects with it, after the callback returns. */
export interface Tx extends Queryable { readonly kind: Db["kind"] }

// Drizzle installs string timestamp codecs on the shared postgres-js client. Raw domain queries
// use the same Date contract as PGlite; decode by the column OID, never by string shape/name.
function postgresRows<T extends Record<string, unknown>>(rows: readonly T[] & { columns: readonly { name: string; type: number }[] }): T[] {
  const timestamps = (rows.columns ?? []).filter(column => column.type === 1184).map(column => column.name);
  return rows.map(row => {
    const decoded: Record<string, unknown> = { ...row };
    for (const name of timestamps) if (typeof decoded[name] === "string") decoded[name] = new Date(decoded[name]);
    return decoded as T;
  });
}
const postgresParams = (params: unknown[]): never[] => params.map(value => value instanceof Date ? value.toISOString() : value) as never[];

export function queryable(handle: Db): Queryable {
  return {
    async query<T extends Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
      if (handle.kind === "postgres") return postgresRows(await handle.client.unsafe<T[]>(query, postgresParams(params)));
      return (await handle.client.query<T>(query, params)).rows;
    },
  };
}

export async function withTx<T>(fn: (tx: Tx) => Promise<T>, handle: Db = getDb()): Promise<T> {
  if (handle.kind === "postgres") {
    // postgres-js begin pins one connection for the entire callback.
    return await handle.client.begin(async conn => fn({ kind: "postgres", async query<R extends Record<string, unknown>>(text: string, params: unknown[] = []) {
      return postgresRows(await conn.unsafe<R[]>(text, postgresParams(params)));
    } })) as T;
  }
  return handle.client.transaction(async conn => fn({ kind: "pglite", async query<R extends Record<string, unknown>>(text: string, params: unknown[] = []) {
    return (await conn.query<R>(text, params)).rows;
  } }));
}

/** Signed 64-bit, domain-separated SHA-256 key. Never JS number: that loses lock-key bits. */
export function advisoryKey(namespace: "account" | "session" | "job" | "spend", id: string): string {
  return createHash("sha256").update(`didit-events:v1:${namespace}\0${id}`).digest().readBigInt64BE().toString();
}
export async function lockAccount(tx: Tx, accountId: string): Promise<void> {
  // PGlite serializes transactions on its single connection; real PG supplies concurrency guarantees.
  if (tx.kind === "postgres") await tx.query("select pg_advisory_xact_lock($1::bigint)", [advisoryKey("account", accountId)]);
}
/** C22: the account lock alone serializes authoritative decision application. */
export const lockForDecision = lockAccount;
export interface LockTargets { accountId: string; registrationId: string; eventId: string; kioskId?: string }
/** C22: account -> registration UPDATE -> event SHARE -> kiosk SHARE. */
export async function lockForCheckin(tx: Tx, ids: LockTargets & { kioskId: string }): Promise<void> {
  await lockAccount(tx, ids.accountId);
  const [registration] = await tx.query("select id from registrations where id=$1 and account_id=$2 and event_id=$3 for update", [ids.registrationId, ids.accountId, ids.eventId]);
  if (!registration) throw new Error("RegistrationNotFound");
  const [event] = await tx.query("select id from events where id=$1 for share", [ids.eventId]);
  if (!event) throw new Error("EventNotFound");
  const [kiosk] = await tx.query("select id from kiosks where id=$1 and event_id=$2 for share", [ids.kioskId, ids.eventId]);
  if (!kiosk) throw new Error("KioskNotFound");
}
/** Take ALL accounts first, then event UPDATE directly, BEFORE registration locks/inserts (including FK locks).
 * Never upgrade SHARE or acquire another account after the event. Count and write only after this returns.
 */
export async function lockForSeatGrant(tx: Tx, accountIds: readonly string[], eventId: string): Promise<void> {
  if (!accountIds.length) throw new Error("AccountLockRequired");
  for (const id of [...new Set(accountIds)].sort()) await lockAccount(tx, id);
  const [event] = await tx.query("select id from events where id=$1 for update", [eventId]);
  if (!event) throw new Error("EventNotFound");
}
/** C22: account -> its registrations ascending. Deletion never locks events. */
export async function lockForDeletion(tx: Tx, accountId: string): Promise<void> {
  await lockAccount(tx, accountId);
  await tx.query("select id from registrations where account_id=$1 order by id for update", [accountId]);
}
/** Compatibility names use C22 modes; callers must not acquire registration/FK locks first. */
export async function lockForAdmission(tx: Tx, ids: LockTargets): Promise<void> {
  await lockForSeatGrant(tx, [ids.accountId], ids.eventId);
  const [row] = await tx.query("select id from registrations where id=$1 and account_id=$2 and event_id=$3 for update", [ids.registrationId, ids.accountId, ids.eventId]);
  if (!row) throw new Error("RegistrationNotFound");
}
export const lockForAccountWrite = lockForDeletion;
export const lockForRenewal = lockForDecision;
export async function lockForNewRegistration(tx: Tx, accountId: string, eventId: string): Promise<string> {
  await lockForSeatGrant(tx, [accountId], eventId);
  await tx.query("insert into registrations (event_id,account_id) values ($1,$2) on conflict (event_id,account_id) do nothing", [eventId, accountId]);
  const [row] = await tx.query<{ id: string }>("select id from registrations where event_id=$1 and account_id=$2 for update", [eventId, accountId]);
  if (!row) throw new Error("RegistrationNotFound");
  return row.id;
}
export interface PromotionCandidate { id: string; account_id: string }
export interface PromotionSkip {
  candidate: PromotionCandidate;
  reason: "stale" | "account_deleting_or_missing" | "ineligible";
}
export interface PromotionResult<T> {
  granted: T | null;
  skipped: PromotionSkip[];
  stopped: "granted" | "empty" | "capacity" | "scan_limit";
}
/** One transaction per candidate. Selection is an unlocked hint; revalidate FIFO, capacity and eligibility
 * under account -> event UPDATE. B4 supplies the eligibility/cutoff policy and transactional grant effects.
 * Skip at most 50 candidates per call. Release ALL locks before selecting the next account.
 */
export async function promoteOne<T>(eventId: string, policy: {
  eligible(tx: Tx, candidate: PromotionCandidate): Promise<boolean>;
  grant(tx: Tx, candidate: PromotionCandidate): Promise<T>;
}, handle: Db = getDb()): Promise<PromotionResult<T>> {
  const skipped: PromotionSkip[] = [], attempted: string[] = [];
  const select = "select id,account_id from registrations where event_id=$1 and admission='waitlisted' and not (id=any($2::uuid[])) order by applied_at,id limit 1";
  for (let scan = 0; scan < 50; scan++) {
    const [candidate] = await queryable(handle).query<PromotionCandidate & Record<string, unknown>>(select, [eventId, attempted]);
    if (!candidate) return { granted: null, skipped, stopped: "empty" };
    const outcome = await withTx<{ granted: T } | { skip: PromotionSkip["reason"] } | { stopped: "capacity" }>(async tx => {
      await lockForSeatGrant(tx, [candidate.account_id], eventId);
      const [current] = await tx.query(select, [eventId, attempted]);
      if (current?.id !== candidate.id || current.account_id !== candidate.account_id) return { skip: "stale" } as const;
      const [seat] = await tx.query<{ available: boolean }>(`select capacity > (select count(*) from registrations where event_id=$1 and admission='approved') as available from events where id=$1`, [eventId]);
      if (!seat?.available) return { stopped: "capacity" } as const;
      const [account] = await tx.query("select id from accounts where id=$1 and deleting_at is null and deleted_at is null", [candidate.account_id]);
      if (!account) return { skip: "account_deleting_or_missing" } as const;
      if (!await policy.eligible(tx, candidate)) return { skip: "ineligible" } as const;
      return { granted: await policy.grant(tx, candidate) };
    }, handle);
    if ("granted" in outcome) return { granted: outcome.granted, skipped, stopped: "granted" };
    if ("stopped" in outcome) return { granted: null, skipped, stopped: outcome.stopped };
    skipped.push({ candidate, reason: outcome.skip });
    attempted.push(candidate.id);
  }
  return { granted: null, skipped, stopped: "scan_limit" };
}
