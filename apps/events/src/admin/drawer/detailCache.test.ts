import { describe, expect, it, vi } from "vitest";
import { createDetailCache, PREFETCH_LIMIT } from "./detailCache";

/** A fetcher whose answers the test releases by id. */
function deferred() {
  const waiting = new Map<string, { resolve: (v: string | null) => void; reject: (e: Error) => void }[]>();
  const fetcher = vi.fn((id: string) => new Promise<string | null>((resolve, reject) => waiting.set(id, [...(waiting.get(id) ?? []), { resolve, reject }])));
  const settle = async (id: string, value: string | null | Error) => {
    const next = waiting.get(id)!.shift()!;
    if (value instanceof Error) next.reject(value);
    else next.resolve(value);
    await new Promise((r) => setTimeout(r, 0));
  };
  return { fetcher, settle };
}

describe("drawer detail cache", () => {
  it("prefetches at most two at a time, caches by id and never asks twice", async () => {
    const { fetcher, settle } = deferred();
    const cache = createDetailCache(fetcher);
    expect(PREFETCH_LIMIT).toBe(2);
    cache.prefetch(["a", "b", "c", "d"]);
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
    await settle("a", "A");
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual(["a", "b", "c"]);
    await settle("b", "B");
    await settle("c", "C");
    await settle("d", "D");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(cache.get("a")).toEqual({ data: "A", loading: false, stale: false, error: false });
    cache.prefetch(["a", "b"]);
    cache.load("a");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("a new set of neighbours replaces the ones still queued", async () => {
    const { fetcher, settle } = deferred();
    const cache = createDetailCache(fetcher);
    cache.prefetch(["a", "b", "c"]);
    cache.prefetch(["x"]);
    await settle("a", "A");
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual(["a", "b", "x"]);
  });

  it("the open record loads at once, behind no prefetch, and reuses a prefetch already under way", () => {
    const { fetcher } = deferred();
    const cache = createDetailCache(fetcher);
    cache.prefetch(["a", "b"]);
    cache.load("c");
    cache.load("a");
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual(["a", "b", "c"]);
    expect(cache.get("c")).toMatchObject({ loading: true });
  });

  it("invalidate keeps showing what it has and loads it again when opened; an answer from before is kept as stale", async () => {
    const { fetcher, settle } = deferred();
    const cache = createDetailCache(fetcher);
    cache.load("a");
    await settle("a", "A1");
    cache.prefetch(["b"]);
    cache.invalidate();
    await settle("b", "B-before");
    expect(cache.get("a")).toMatchObject({ data: "A1", stale: true, loading: false });
    expect(cache.get("b")).toMatchObject({ data: "B-before", stale: true });
    // Neighbours are not fetched again just for being stale…
    cache.prefetch(["a", "b"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    // …the open one is, with its old data still on screen.
    cache.load("a");
    expect(cache.get("a")).toMatchObject({ data: "A1", loading: true });
    await settle("a", "A2");
    expect(cache.get("a")).toEqual({ data: "A2", loading: false, stale: false, error: false });
  });

  it("a failed load keeps the last data, marks the error and can be retried; an unknown record is null", async () => {
    const { fetcher, settle } = deferred();
    const cache = createDetailCache(fetcher);
    const seen = vi.fn();
    cache.subscribe(seen);
    cache.load("a");
    await settle("a", new Error("offline"));
    expect(cache.get("a")).toMatchObject({ data: undefined, error: true, loading: false });
    cache.load("a");
    await settle("a", null);
    expect(cache.get("a")).toEqual({ data: null, loading: false, stale: false, error: false });
    expect(seen).toHaveBeenCalled();
  });

  it("adopts a load under way elsewhere, falls back to the route when it breaks, and takes a record set directly", async () => {
    const { fetcher, settle } = deferred();
    const cache = createDetailCache(fetcher);
    cache.adopt("a", Promise.resolve("streamed"));
    cache.load("a");
    await new Promise((r) => setTimeout(r, 0));
    expect(fetcher).not.toHaveBeenCalled();
    expect(cache.get("a")).toMatchObject({ data: "streamed", stale: false });
    cache.adopt("b", Promise.reject(new Error("stream broke")));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual(["b"]);
    await settle("b", "B");
    expect(cache.get("b")).toMatchObject({ data: "B", error: false });
    cache.set("c", "C");
    expect(cache.get("c")).toEqual({ data: "C", loading: false, stale: false, error: false });
  });

  // v24: React's server-streamed thenable inherits Promise.prototype, but its `then` returns nothing, so
  // `catch`/`finally` on it return undefined (the drawers crashed with "reading 'then'" of undefined).
  const streamed = <T,>(settled: Promise<T>): Promise<T> => {
    const thenable = Object.create(Promise.prototype) as Promise<T>;
    Object.defineProperty(thenable, "then", { value: (ok: (v: T) => void, fail: (e: unknown) => void) => { void settled.then(ok, fail); } });
    return thenable;
  };

  it("adopts a React streamed thenable whose catch and finally return undefined", async () => {
    const { fetcher, settle } = deferred();
    const cache = createDetailCache(fetcher);
    const ok = streamed(Promise.resolve("streamed"));
    expect(ok.catch(() => "x")).toBeUndefined();
    expect(ok.finally(() => undefined)).toBeUndefined();
    expect(() => cache.adopt("a", ok)).not.toThrow();
    expect(cache.get("a")).toMatchObject({ loading: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetcher).not.toHaveBeenCalled();
    expect(cache.get("a")).toEqual({ data: "streamed", loading: false, stale: false, error: false });
    expect(() => cache.adopt("b", streamed(Promise.reject(new Error("stream broke"))))).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual(["b"]);
    await settle("b", "B");
    expect(cache.get("b")).toMatchObject({ data: "B", error: false });
  });
});
