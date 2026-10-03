import { afterEach, expect, it, vi } from "vitest";
import { startLiveSnapshots } from "./live";
afterEach(() => vi.useRealTimers());
it("C26 replaces full snapshots on connect, coalesced signals, missed-notification refresh and reconnect", async () => {
 vi.useFakeTimers(); const handlers = new Map<string, () => void>(), stream = { addEventListener: (n: string, f: () => void) => { handlers.set(n, f); }, close: vi.fn() };
 let rows = ["a", "b"], state: string[] = [];
 const fetchSnapshot = vi.fn(async () => [...rows]), stop = startLiveSnapshots({ stream, fetchSnapshot, replace: v => { state = v; } });
 await vi.advanceTimersByTimeAsync(0); expect(state).toEqual(["a", "b"]);
 rows = ["b"]; await vi.advanceTimersByTimeAsync(15000); expect(state).toEqual(["b"]);
 rows = ["b", "late-commit"]; handlers.get("message")!(); handlers.get("message")!(); await vi.advanceTimersByTimeAsync(250); expect(state).toEqual(rows); expect(fetchSnapshot).toHaveBeenCalledTimes(3);
 rows = []; handlers.get("open")!(); await vi.advanceTimersByTimeAsync(0); expect(state).toEqual([]);
 stop(); await vi.advanceTimersByTimeAsync(30000); expect(fetchSnapshot).toHaveBeenCalledTimes(4); expect(stream.close).toHaveBeenCalledOnce();
});
