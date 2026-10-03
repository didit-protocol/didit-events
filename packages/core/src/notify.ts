import { getDb, type Db } from "./db/index.ts";
import type { Tx } from "./db/tx.ts";
export interface ChangeSignal { type: string; event_id: string }
const checkChannel = (channel: string): void => { if (!/^[a-z][a-z0-9_-]{0,62}$/.test(channel)) throw new Error("InvalidNotifyChannel"); };
function parseSignal(payload: unknown): ChangeSignal {
  if (!payload || typeof payload !== "object" || Object.keys(payload).some(k => k !== "type" && k !== "event_id") || !("type" in payload) || !("event_id" in payload) || typeof payload.type !== "string" || typeof payload.event_id !== "string" || payload.type.length > 100 || payload.event_id.length > 100) throw new Error("InvalidChangeSignal");
  return { type: payload.type, event_id: payload.event_id };
}
/** Native transactional NOTIFY: PostgreSQL publishes only on commit, never on rollback. C26 carries no cursor/data. */
export async function notifyInTx(tx: Tx, channel: string, payload: ChangeSignal): Promise<void> {
  checkChannel(channel);
  await tx.query("select pg_notify($1,$2)", [channel, JSON.stringify(parseSignal(payload))]);
}
export class ChangeBus {
  private subscribers = new Set<(signal: ChangeSignal) => void>();
  subscribe(listener: (signal: ChangeSignal) => void): () => void { this.subscribers.add(listener); return () => { this.subscribers.delete(listener); }; }
  private emit(raw: string): void {
    let signal: ChangeSignal;
    try { signal = parseSignal(JSON.parse(raw)); } catch { return; }
    for (const listener of this.subscribers) { try { listener(signal); } catch { /* A disconnected SSE consumer cannot break fan-out. */ } }
  }
  /** C26: full snapshot on connect/reconnect, every coalesced signal (250ms debounce), and every 15s while connected. No incremental watermark. */
  async listen(channel: string, handle: Db = getDb(), onReconnect?: () => void): Promise<() => Promise<void>> {
    checkChannel(channel);
    if (handle.kind === "postgres") {
      const subscription = await handle.client.listen(channel, value => this.emit(value), onReconnect);
      return async () => { await subscription.unlisten(); };
    }
    // PGlite interpolates the name into LISTEN unquoted; quote it (checkChannel already restricts the characters) so
    // channels like `event_<uuid>` with hyphens work locally exactly as on Postgres.
    const unlisten = await handle.client.listen(`"${channel}"`, value => this.emit(value));
    onReconnect?.();
    // PGlite's unlisten also drops the quotes; fall back to a quoted UNLISTEN so closing a stream never throws.
    return async () => {
      try { await unlisten(); } catch { await handle.client.query(`UNLISTEN "${channel}"`).catch(() => undefined); }
    };
  }
}
