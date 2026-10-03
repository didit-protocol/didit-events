"use client";

import { useSyncExternalStore } from "react";
import { notifySessionExpired } from "../system/session";

/**
 * What a drawer host knows about one record. `data: null` = the server says it does not exist. `stale` data is still
 * shown (no skeleton) while the record loads again.
 */
export interface DetailEntry<T> {
  data?: T | null;
  loading: boolean;
  stale: boolean;
  error: boolean;
}

export interface DetailCache<T> {
  get(id: string): DetailEntry<T> | undefined;
  /** The open record: loads at once when missing or stale (never waits behind prefetches). */
  load(id: string): void;
  /** Neighbours: only what is not cached yet, at most `PREFETCH_LIMIT` requests at a time. */
  prefetch(ids: readonly string[]): void;
  /** A record that arrives another way (the page's own render, an action's answer). */
  set(id: string, data: T | null): void;
  /** A load already under way elsewhere (the page streams the deep-linked record). */
  adopt(id: string, promise: PromiseLike<T | null>): void;
  /** After a decision or a list refresh: everything cached is shown as is and loaded again when opened. */
  invalidate(): void;
  subscribe(notify: () => void): () => void;
}

export const PREFETCH_LIMIT = 2;
const MAX_ENTRIES = 40;

export function createDetailCache<T>(fetcher: (id: string) => Promise<T | null>): DetailCache<T> {
  const entries = new Map<string, DetailEntry<T>>();
  const listeners = new Set<() => void>();
  /** The request whose answer an entry is waiting for; an older answer is dropped. */
  const pending = new Map<string, Promise<T | null>>();
  /** Requests started before the last `invalidate()`: their answer is kept, but as stale. */
  const outdated = new WeakSet<Promise<T | null>>();
  const queue: string[] = [];
  let prefetching = 0;

  const put = (id: string, entry: DetailEntry<T>) => {
    entries.delete(id);
    entries.set(id, entry);
    // Oldest first; a record still loading is never dropped.
    for (const [key, e] of entries) {
      if (entries.size <= MAX_ENTRIES) break;
      if (key !== id && !e.loading) entries.delete(key);
    }
    for (const notify of listeners) notify();
  };

  const track = (id: string, promise: Promise<T | null>): Promise<void> => {
    pending.set(id, promise);
    const prev = entries.get(id);
    put(id, { data: prev?.data, loading: true, stale: prev?.stale ?? false, error: false });
    return promise.then(
      (data) => {
        if (pending.get(id) !== promise) return;
        pending.delete(id);
        put(id, { data, loading: false, stale: outdated.has(promise), error: false });
      },
      () => {
        if (pending.get(id) !== promise) return;
        pending.delete(id);
        const last = entries.get(id);
        put(id, { data: last?.data, loading: false, stale: true, error: true });
      },
    );
  };

  const pump = () => {
    while (prefetching < PREFETCH_LIMIT && queue.length) {
      const id = queue.shift()!;
      if (entries.has(id)) continue;
      prefetching++;
      void track(id, fetcher(id)).finally(() => {
        prefetching--;
        pump();
      });
    }
  };

  return {
    get: (id) => entries.get(id),
    load(id) {
      const entry = entries.get(id);
      if (entry?.loading || (entry && !entry.stale && !entry.error)) return;
      void track(id, fetcher(id));
    },
    prefetch(ids) {
      // Only the latest neighbours matter: a queue left from the previous record is dropped.
      queue.length = 0;
      for (const id of ids) if (!entries.has(id) && !queue.includes(id)) queue.push(id);
      pump();
    },
    set(id, data) {
      pending.delete(id);
      put(id, { data, loading: false, stale: false, error: false });
    },
    adopt(id, promise) {
      // The page hands over React's streamed thenable: its `then` returns nothing, so `catch`/`finally` on it give
      // `undefined`. Only `then(resolve, reject)` is used, to settle a real Promise.
      const real = new Promise<T | null>((resolve, reject) => { promise.then(resolve, reject); });
      // A stream that breaks (the page render failed half-way) falls back to the route.
      void track(id, real.catch(() => fetcher(id)));
    },
    invalidate() {
      for (const promise of pending.values()) outdated.add(promise);
      for (const [id, e] of entries) entries.set(id, { ...e, stale: true });
      for (const notify of listeners) notify();
    },
    subscribe(notify) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
  };
}

const nothing = () => undefined;

/** The cached entry of `id`, re-rendering when it changes. */
export function useDetail<T>(cache: DetailCache<T>, id: string | undefined): DetailEntry<T> | undefined {
  return useSyncExternalStore(cache.subscribe, () => (id ? cache.get(id) : undefined), nothing);
}

/** GET a staff-only detail route (`{ ok, data }`); `null` for an unknown record, the session modal on 401. */
export async function fetchDetail<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" } });
  if (response.status === 404) return null;
  if (response.status === 401) notifySessionExpired();
  if (!response.ok) throw new Error("DetailUnavailable");
  return ((await response.json()) as { data: T | null }).data;
}
