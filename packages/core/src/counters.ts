import { getDb, type Db } from "./db/index.ts";
import { queryable } from "./db/tx.ts";

export interface CounterResult { allowed: boolean; remaining: number; resetsAt: Date }
/** Fixed windows anchored in the database clock, one atomic upsert, no read-before-write. */
export async function consume(key: string, limit: number, windowSec: number, handle: Db = getDb()): Promise<CounterResult> {
  if (!key || key.startsWith("spend:") || !Number.isSafeInteger(limit) || limit < 1 || !Number.isFinite(windowSec) || windowSec <= 0) throw new Error("InvalidCounter");
  const [row] = await queryable(handle).query<{ value: string | number; expires_at: Date }>(`
    insert into counters (key,value,expires_at) values ($1,1,clock_timestamp()+$3 * interval '1 second')
    on conflict (key) do update set
      value = case when counters.expires_at <= clock_timestamp() then 1 else counters.value+1 end,
      expires_at = case when counters.expires_at <= clock_timestamp() then clock_timestamp()+$3 * interval '1 second' else counters.expires_at end
    where counters.expires_at <= clock_timestamp() or counters.value < $2 returning value,expires_at`, [key, limit, windowSec]);
  if (row) return { allowed: true, remaining: limit - Number(row.value), resetsAt: row.expires_at };
  const [current] = await queryable(handle).query<{ expires_at: Date }>("select expires_at from counters where key=$1", [key]);
  return { allowed: false, remaining: 0, resetsAt: current?.expires_at ?? new Date() };
}
