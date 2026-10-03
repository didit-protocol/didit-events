import { createHash } from "node:crypto";
import { getDb, type Db } from "./db/index.ts";
import { withTx, type Tx } from "./db/tx.ts";
import { reportUnexpected } from "./error-reporting.ts";
import { retryDelaySec, workerLoop } from "./workers.ts";

export interface InboxMessage { id: string; event_id: string; raw: string | null; headers: Record<string, string> | null; attempts: number }
/** All database work uses this tx; calling a service that opens another tx can self-deadlock. */
export type InboxHandler = (message: InboxMessage, tx: Tx) => Promise<void>;
export class InboxRegistry {
  private handlers = new Map<string, InboxHandler>();
  register(kind: string, handler: InboxHandler): void {
    if (this.handlers.has(kind)) throw new Error("DuplicateInboxHandler");
    this.handlers.set(kind, handler);
  }
  get(kind: string): InboxHandler | undefined { return this.handlers.get(kind); }
}
export const inboxHandlers = new InboxRegistry();
/** Call only after signature verification. Persist before acknowledging; event_id is provider-scoped. */
export async function store(raw: string, headers: Headers | Record<string, string>, handle: Db = getDb()): Promise<{ id: string; duplicate: boolean }> {
  const body: unknown = JSON.parse(raw);
  const eventId = body !== null && typeof body === "object" && "event_id" in body && typeof body.event_id === "string" ? body.event_id : createHash("sha256").update(raw).digest("hex");
  const source = new Headers(headers);
  const retained = Object.fromEntries(["x-signature", "x-signature-v2", "x-timestamp", "content-type"].flatMap(k => source.has(k) ? [[k, source.get(k)!]] : []));
  return withTx(async tx => {
    const [row] = await tx.query<{ id: string }>("insert into inbox (event_id,raw,headers) values ($1,$2,$3::jsonb) on conflict (event_id) do nothing returning id", [`didit:${eventId}`, raw, JSON.stringify(retained)]);
    if (row) return { id: row.id, duplicate: false };
    const [existing] = await tx.query<{ id: string }>("select id from inbox where event_id=$1", [`didit:${eventId}`]);
    return { id: existing!.id, duplicate: true };
  }, handle);
}
/** Transactional processing + checkpoint. Handler DB changes roll back before a failed attempt is scheduled. */
export async function dispatchInbox(handle: Db = getDb(), registry: InboxRegistry = inboxHandlers): Promise<boolean> {
  return withTx(async tx => {
    const [row] = await tx.query<InboxMessage & Record<string, unknown>>("select * from inbox where processed_at is null and next_attempt_at<=clock_timestamp() order by next_attempt_at,id for update skip locked limit 1");
    if (!row) return false;
    await tx.query("savepoint inbox_handler");
    try {
      if (!row.raw) throw new Error("InboxBodyMissing");
      const body: unknown = JSON.parse(row.raw);
      const kind = body !== null && typeof body === "object" && "webhook_type" in body ? body.webhook_type : undefined;
      const handler = typeof kind === "string" ? registry.get(kind) : undefined;
      if (!handler) throw new Error("MissingInboxHandler");
      await handler(row, tx);
      await tx.query("update inbox set processed_at=clock_timestamp(),attempts=attempts+1,error=null where id=$1", [row.id]);
      await tx.query("release savepoint inbox_handler");
    } catch (error) {
      reportUnexpected(error, { worker: "inbox" });
      await tx.query("rollback to savepoint inbox_handler");
      await tx.query("release savepoint inbox_handler");
      await tx.query("update inbox set attempts=attempts+1,error='processing_failed',next_attempt_at=clock_timestamp()+$2 * interval '1 second' where id=$1", [row.id, retryDelaySec(row.attempts + 1)]);
    }
    return true;
  }, handle);
}
export const runInbox = (options: { signal: AbortSignal; intervalMs?: number; onError?: () => void }, handle: Db = getDb(), registry = inboxHandlers): Promise<void> => workerLoop(() => dispatchInbox(handle, registry), options);
