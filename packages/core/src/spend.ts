import { getDb,type Db } from "./db/index.ts";
import { withTx } from "./db/tx.ts";
import { log } from "./log.ts";
import { parseSpendCapUsd } from "./env.ts";

export class BudgetExceeded extends Error { constructor() { super("Didit budget exceeded"); this.name = "BudgetExceeded"; } }
export type BillableOp = "session_full" | "session_renewal" | "session_age" | "session_extras" | "email_send" | "face_search" | "passive_liveness";
export const MAX_PRICE_USD = { session_full: 0.23, session_renewal: 0.10, email_send: 0.03, face_search: 0.05, passive_liveness: 0.05 } as const;
export type SpendScope = { kind: "app/day"; id: string; usdCap: number } | { kind: "event/day"; id: string; usdCap: number } | { kind: "total"; id: string; usdCap: number };
const reservationBrand: unique symbol = Symbol("SpendReservation");
export interface SpendReservation { readonly id: string; readonly op: BillableOp; readonly usdMax: number; readonly [reservationBrand]: true }
const handles = new WeakMap<SpendReservation, Db>();
const micros = (amount: number): number => {
  const n = Math.round(amount * 1e6);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(n) || Math.abs(n / 1e6 - amount) > 1e-9) throw new Error("InvalidUsdAmount");
  return n;
};
export interface ReservationInput { op: BillableOp; usdMax: number; scopes: SpendScope[] }
/** Reserve a whole scan before dispatch: either BOTH strict-mode calls fit, or neither is reserved. */
export async function reserveBatch(inputs: readonly ReservationInput[], handle: Db = getDb()): Promise<SpendReservation[]> {
  const environmentCap = parseSpendCapUsd(process.env.DIDIT_SPEND_CAP_USD);
  if (!inputs.length) throw new Error("EmptyReservationBatch");
  for (const input of inputs) {
    if (!micros(input.usdMax) || (input.op !== "session_age" && input.op !== "session_extras" && input.usdMax < MAX_PRICE_USD[input.op])) throw new Error("InsufficientReservationMaximum");
    if (!input.scopes.some(s => s.kind === "app/day") || !input.scopes.some(s => s.kind === "total")) throw new Error("AppAndTotalScopesRequired");
  }
  const ids = await withTx(async tx => {
    const [date] = await tx.query<{ day: string }>("select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD') as day");
    const entries = inputs.map(input => {
      const scopes = input.scopes.map(s => ({ key: `spend:${s.kind}:${s.id}${s.kind === "total" ? "" : `:${date!.day}`}`, limitMicros: micros(s.usdCap) }));
      scopes.push({ key: "spend:environment:total", limitMicros: micros(environmentCap) });
      scopes.sort((a, b) => a.key.localeCompare(b.key));
      if (new Set(scopes.map(s => s.key)).size !== scopes.length) throw new Error("DuplicateSpendScope");
      return { input, scopes };
    });
    // Aggregate first, then acquire all scope locks in lexical order across the entire batch.
    const totals = new Map<string, { amount: number; limit: number }>();
    for (const { input, scopes } of entries) for (const s of scopes) {
      const prev = totals.get(s.key);
      totals.set(s.key, { amount: (prev?.amount ?? 0) + micros(input.usdMax), limit: Math.min(prev?.limit ?? s.limitMicros, s.limitMicros) });
    }
    for (const [key, scope] of [...totals].sort(([a], [b]) => a.localeCompare(b))) {
      const [row] = await tx.query(`insert into counters (key,value,expires_at)
        select $1,$2,'infinity'::timestamptz where $2::bigint <= $3::bigint
        on conflict (key) do update set value=counters.value+excluded.value
        where counters.value+excluded.value <= $3::bigint returning key`, [key, scope.amount, scope.limit]);
      if (!row) {
        log("spend.cap_reached", { scope: key, capUsd: scope.limit / 1e6, requestedUsd: scope.amount / 1e6 });
        throw new BudgetExceeded();
      }
    }
    const ids: string[] = [];
    for (const { input, scopes } of entries) {
      const [row] = await tx.query<{ id: string }>("insert into spend (op,usd_max_micros,scopes) values ($1,$2,$3::jsonb) returning id", [input.op, micros(input.usdMax), JSON.stringify(scopes)]);
      ids.push(row!.id);
    }
    return ids;
  }, handle);
  return inputs.map((input, i) => {
    const reservation: SpendReservation = Object.freeze({ id: ids[i]!, op: input.op, usdMax: input.usdMax, [reservationBrand]: true as const });
    handles.set(reservation, handle);
    return reservation;
  });
}
/** Single-call compatibility entry point, using the same atomic ledger. */
export async function reserve(input: ReservationInput, handle: Db = getDb()): Promise<SpendReservation> {
  return (await reserveBatch([input], handle))[0]!;
}
/** Called by the Didit client immediately before network dispatch. Durable single-use capability. */
export async function claimReservation(reservation: SpendReservation, op: BillableOp, minimum: number): Promise<void> {
  const handle = handles.get(reservation);
  if (!handle || reservation.op !== op || reservation.usdMax < minimum) throw new Error("InvalidSpendReservation");
  await withTx(async tx => {
    const [row] = await tx.query("update spend set dispatched_at=clock_timestamp() where id=$1 and op=$2 and state='reserved' and dispatched_at is null and usd_max_micros >= $3 returning id", [reservation.id, op, micros(minimum)]);
    if (!row) throw new Error("ReservationAlreadyUsed");
  }, handle);
}
/** Idempotent settlement. Uncertain calls retain the full amount. Only a known final cost releases funds. */
export async function settle(id: string, actual: number | "uncertain", handle: Db = getDb()): Promise<void> {
  await withTx(async tx => {
    const [row] = await tx.query<{ state: string; usd_max_micros: number; actual_micros: number | null; scopes: Array<{ key: string }> }>("select * from spend where id=$1 for update", [id]);
    if (!row) throw new Error("ReservationNotFound");
    if (row.state === "settled") {
      if (actual !== "uncertain" && Number(row.actual_micros) !== micros(actual)) throw new Error("ConflictingSettlement");
      return;
    }
    if (actual === "uncertain") {
      await tx.query("update spend set state='uncertain' where id=$1", [id]);
      return;
    }
    const cost = micros(actual), maximum = Number(row.usd_max_micros);
    if (cost > maximum) throw new Error("ActualExceedsReservation");
    for (const scope of [...row.scopes].sort((a, b) => a.key.localeCompare(b.key))) {
      const [counter] = await tx.query("update counters set value=value-$2 where key=$1 returning key", [scope.key, maximum - cost]);
      if (!counter) throw new Error("SpendLedgerScopeMissing");
    }
    await tx.query("update spend set state='settled',actual_micros=$2,settled_at=clock_timestamp() where id=$1", [id, cost]);
  }, handle);
}
export const spend = { reserve, settle };
