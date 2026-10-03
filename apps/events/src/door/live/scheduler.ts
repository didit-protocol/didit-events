// Who gets recognised next. One request per tracked face; at most `maxInFlight` at once and one dispatch per
// `minGapMs` (the scan API allows 4 per 1.2 s per door); a failed face is retried after `retryMs`; a recognised face
// is never sent again while it stays tracked (it is re-identified only when it is lost and comes back as a new
// track). A transient result (no face found, inconclusive…) is retried after `retryMs` up to `maxAttempts` times;
// `next` enforces that cap for every way back in (a retry and a strict door's `again`). A mode change (Test ↔ live)
// voids every result so far (`setMode` → `invalidate`). Pure: time is passed in.

export type Recognition<R> =
  | { state: "waiting" }
  | { state: "pending"; since: number; epoch: number }
  | { state: "retry"; at: number }
  | { state: "done"; result: R; at: number };

export interface SchedulerConfig {
  maxInFlight: number;
  retryMs: number;
  minGapMs: number;
  /** Sends per track that may end in a transient result before that result stands. */
  maxAttempts: number;
}

export const DEFAULT_SCHEDULER: Readonly<SchedulerConfig> = Object.freeze({ maxInFlight: 3, retryMs: 2000, minGapMs: 400, maxAttempts: 3 });

export interface Candidate {
  id: number;
  /** Stable, big, frontal and sharp enough to send. */
  ready: boolean;
  /** Higher goes first (the face's width: the person nearest the door). */
  priority: number;
  /** A finished face asks to be sent again (strict door: it came close enough for the face check). */
  again?: boolean;
}

const WAITING = { state: "waiting" } as const;

export class RecognitionScheduler<R> {
  private readonly faces = new Map<number, Recognition<R>>();
  private readonly attempts = new Map<number, number>();
  private lastDispatch = -Infinity;
  /** Bumped by `invalidate` (the mode generation); a request dispatched in an older epoch is stale when it settles. */
  epoch = 0;
  private mode: boolean | undefined;
  readonly config: SchedulerConfig;

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_SCHEDULER, ...config };
  }

  status(id: number): Recognition<R> {
    return this.faces.get(id) ?? WAITING;
  }

  get inFlight(): number {
    let n = 0;
    for (const r of this.faces.values()) if (r.state === "pending") n++;
    return n;
  }

  /**
   * Forgets faces that are no longer tracked. A pending request of a forgotten face still counts until it settles
   * (`settle` drops it then), so a lost face can't push the door over its concurrency.
   */
  sync(live: ReadonlySet<number>): void {
    for (const [id, r] of this.faces) if (!live.has(id) && r.state !== "pending") this.faces.delete(id);
    for (const id of this.attempts.keys()) if (!live.has(id)) this.attempts.delete(id);
  }

  /**
   * The current mode (Test ↔ live), read as late as possible: before a send and before an answer is consumed, not only
   * once per frame. A change advances the generation (`invalidate`); returns true when it did.
   */
  setMode(mode: boolean): boolean {
    if (this.mode === undefined) this.mode = mode;
    if (mode === this.mode) return false;
    this.mode = mode;
    this.invalidate();
    return true;
  }

  /** True when `id`'s settled request was dispatched before the last `invalidate` (its answer must be ignored). */
  stale(id: number): boolean {
    const r = this.faces.get(id);
    return r?.state === "pending" && r.epoch !== this.epoch;
  }

  /** Drops a stale request when it settles: the face counts as never sent and goes again in the current epoch. */
  drop(id: number): void {
    if (this.faces.get(id)?.state === "pending") this.faces.delete(id);
  }

  /**
   * The mode changed (Test ↔ live): every result and retry so far is void, so faces already in frame are sent again.
   * Requests still in flight keep counting against concurrency until they settle (then `stale` → `drop`).
   */
  invalidate(): void {
    this.epoch++;
    for (const [id, r] of this.faces) if (r.state !== "pending") this.faces.delete(id);
    this.attempts.clear();
  }

  /** The faces to send now (marked pending). Nothing is sent while `blocked` (offline, paused, door closed). */
  next(candidates: readonly Candidate[], now: number, blocked = false): number[] {
    if (blocked) return [];
    const due = candidates
      .filter((c) => {
        const r = this.status(c.id);
        if (!c.ready) return false;
        if (r.state === "waiting") return true;
        if ((this.attempts.get(c.id) ?? 0) >= this.config.maxAttempts) return false;
        if (r.state === "retry") return r.at <= now;
        if (r.state === "done") return !!c.again && now - r.at >= this.config.retryMs;
        return false;
      })
      .sort((a, b) => b.priority - a.priority);
    const out: number[] = [];
    for (const c of due) {
      if (this.inFlight >= this.config.maxInFlight || now - this.lastDispatch < this.config.minGapMs) break;
      this.faces.set(c.id, { state: "pending", since: now, epoch: this.epoch });
      this.lastDispatch = now;
      out.push(c.id);
    }
    return out;
  }

  /** A result for `id`. `live` = the face is still tracked; otherwise its entry is dropped. */
  resolve(id: number, result: R, now: number, live = true): void {
    if (live) this.faces.set(id, { state: "done", result, at: now });
    else this.faces.delete(id);
  }

  /** The request failed (network, 429, 5xx): try this face again after `retryMs`. */
  fail(id: number, now: number, live = true): void {
    if (live) this.faces.set(id, { state: "retry", at: now + this.config.retryMs });
    else this.faces.delete(id);
  }

  /**
   * A transient result (no face found, inconclusive, an outage, too far for the face check): sent again after
   * `retryMs` once the face is ready again, until `maxAttempts` sends ended this way; then the result stands.
   */
  retry(id: number, result: R, now: number, live = true): void {
    if (!live) return void this.faces.delete(id);
    const n = (this.attempts.get(id) ?? 0) + 1;
    this.attempts.set(id, n);
    if (n >= this.config.maxAttempts) this.faces.set(id, { state: "done", result, at: now });
    else this.faces.set(id, { state: "retry", at: now + this.config.retryMs });
  }

  reset(): void {
    this.faces.clear();
    this.attempts.clear();
  }
}
