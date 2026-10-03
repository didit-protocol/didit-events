import type { ChangeSignal } from "@didit-events/core";
import type { FastPollResult } from "@didit-events/core/verification/fast-poll";
import { COOKIE_NAMES } from "@didit-events/core/http/policy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verificationStream, type VerificationStreamDeps } from "./verification-stream";

const ME = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";

function harness(over: Partial<VerificationStreamDeps> = {}) {
  const channels = new Map<string, (s: ChangeSignal) => void>();
  const unlisten = vi.fn(async () => {});
  const valid = new Set(["good"]);
  const deps: VerificationStreamDeps = {
    requireGuest: async (cookie) => { if (!valid.has(cookie)) throw new Error("unauthenticated"); return { accountId: ME }; },
    listen: async (channel, onSignal) => { channels.set(channel, onSignal); return unlisten; },
    heartbeatMs: 20, pollMs: 10, passivePollMs: 10, maxPollMs: 10_000, maxLifetimeMs: 10_000,
    ...over,
  };
  const controller = new AbortController();
  const request = (cookie = "good", headers: Record<string, string> = {}, query = "", signal = controller.signal) =>
    new Request(`https://events.test/api/me/verification/stream${query}`, { headers: { cookie: `${COOKIE_NAMES.session}=${cookie}`, ...headers }, signal });
  return { deps, channels, unlisten, valid, controller, request };
}

/** Reads SSE frames until `until` matches the accumulated text (or the stream ends). */
async function readUntil(res: Response, until: (text: string) => boolean, timeoutMs = 2000) {
  const reader = res.body!.getReader(), decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (!until(text) && Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), new Promise<{ done: true; value?: undefined }>((r) => setTimeout(() => r({ done: true }), deadline - Date.now()))]);
    if (chunk.done) break;
    text += decoder.decode(chunk.value);
  }
  reader.releaseLock();
  return text;
}

afterEach(() => vi.useRealTimers());

describe("GET /api/me/verification/stream", () => {
  it("refuses signed-out and cross-site requests", async () => {
    const h = harness();
    expect((await verificationStream(h.request("nope"), h.deps)).status).toBe(401);
    expect((await verificationStream(h.request("good", { "sec-fetch-site": "cross-site" }), h.deps)).status).toBe(403);
    expect(h.channels.size).toBe(0);
  });

  it("listens to the guest's own account channel only and forwards its verification signals", async () => {
    const h = harness();
    const res = await verificationStream(h.request(), h.deps);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await readUntil(res, (t) => t.includes("event: connected"))).toContain("retry: 3000");
    expect([...h.channels.keys()]).toEqual([`account_${ME}`]);
    const push = h.channels.get(`account_${ME}`)!;
    push({ type: "verification.updated", event_id: OTHER }); // a signal naming another account is dropped
    push({ type: "profile.updated", event_id: ME }); // not a verification signal
    push({ type: "verification.updated", event_id: ME });
    const text = await readUntil(res, (t) => t.includes("verification.updated"));
    expect(text.match(/data: \{"type":"verification.updated"\}/g)).toHaveLength(1);
    expect(text).not.toContain("profile.updated");
    h.controller.abort();
  });

  it("sends heartbeats while the session is valid and ends the stream when it lapses", async () => {
    const h = harness();
    const res = await verificationStream(h.request(), h.deps);
    expect(await readUntil(res, (t) => t.includes("event: ping"))).toContain("event: ping");
    h.valid.delete("good");
    const text = await readUntil(res, (t) => t.includes("event: end"));
    expect(text).toContain('"reason":"session"');
    await vi.waitFor(() => expect(h.unlisten).toHaveBeenCalled());
  });

  it("closes and unlistens when the client goes away, and after its lifetime", async () => {
    const h = harness();
    const res = await verificationStream(h.request(), h.deps);
    await readUntil(res, (t) => t.includes("connected"));
    h.controller.abort();
    await vi.waitFor(() => expect(h.unlisten).toHaveBeenCalledTimes(1));

    const short = harness({ maxLifetimeMs: 1, heartbeatMs: 15 });
    const res2 = await verificationStream(short.request(), short.deps);
    expect(await readUntil(res2, (t) => t.includes("event: end"))).toContain('"reason":"lifetime"');
    await vi.waitFor(() => expect(short.unlisten).toHaveBeenCalled());
  });

  it("fast-polls the guest's own account without overlapping, pushes an applied decision, and stops after maxPollMs", async () => {
    let calls = 0, inFlight = 0, maxInFlight = 0;
    const poll = vi.fn(async (accountId: string) => {
      expect(accountId).toBe(ME);
      calls++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 25));
      inFlight--;
      return calls === 2 ? ({ state: "applied", status: "Approved" } as const) : ({ state: "unchanged", status: "In Progress" } as const);
    });
    const h = harness({ poll, maxPollMs: 200 });
    const res = await verificationStream(h.request(), h.deps);
    expect(await readUntil(res, (t) => t.includes("verification.updated"))).toContain('data: {"type":"verification.updated"}');
    expect(maxInFlight).toBe(1);
    await new Promise((r) => setTimeout(r, 400));
    const settled = poll.mock.calls.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(poll.mock.calls.length).toBe(settled);
    h.controller.abort();
  });

  it("a failing poll never breaks the stream", async () => {
    const log = vi.fn();
    const h = harness({ poll: async () => { throw new Error("provider down"); }, log });
    const res = await verificationStream(h.request(), h.deps);
    expect(await readUntil(res, (t) => t.includes("event: ping"))).toContain("event: ping");
    expect(log).toHaveBeenCalledWith("verification.fast_poll_failed");
    h.controller.abort();
  });

  describe("fast-poll budget on a simulated clock (production intervals)", () => {
    /**
     * `pollActiveDecision`'s limits in memory: one read per 2 s (dedupe), 60 reads per 15 min per account (budget).
     * Didit approves the check at `approveAt`; the first read after that applies it once.
     */
    function didit(approveAt: number) {
      const reads: number[] = [];
      let applied = false;
      const poll = vi.fn(async (): Promise<FastPollResult> => {
        if (applied) return { state: "idle" };
        const now = Date.now();
        if (reads.length && now - reads.at(-1)! < 2_000) return { state: "limited", scope: "dedupe" };
        if (reads.filter((t) => now - t < 900_000).length >= 60) return { state: "limited", scope: "budget" };
        reads.push(now);
        if (now < approveAt) return { state: "unchanged", status: "In Progress" };
        applied = true;
        return { state: "applied", status: "Approved" };
      });
      return { poll, reads };
    }
    /** Collects every SSE frame as it is written (no timers involved, so it works under fake timers). */
    function collect(res: Response) {
      const out = { text: "" };
      const reader = res.body!.getReader(), decoder = new TextDecoder();
      void (async () => { for (;;) { const c = await reader.read(); if (c.done) return; out.text += decoder.decode(c.value); } })().catch(() => {});
      return out;
    }
    const PROD = { heartbeatMs: 15_000, pollMs: 3_000, passivePollMs: 20_000, maxPollMs: 10 * 60_000, maxLifetimeMs: 15 * 60_000 };

    it("a 5-minute camera step (passive stream) leaves the budget for the wait, and the approval is applied", async () => {
      vi.useFakeTimers({ now: new Date("2026-10-01T10:00:00Z") });
      const start = Date.now(), FIVE_MIN = 5 * 60_000;
      const d = didit(start + FIVE_MIN);
      const h = harness({ ...PROD, poll: d.poll });
      // The guest is in the Didit camera UI: passive stream (no ?wait=decision).
      const camera = new AbortController();
      const passive = collect(await verificationStream(h.request("good", {}, "", camera.signal), h.deps));
      await vi.advanceTimersByTimeAsync(FIVE_MIN - 1_000);
      expect(d.reads.length).toBeLessThanOrEqual(15);
      expect(passive.text).not.toContain("verification.limited");
      camera.abort();
      // The SDK says done: the modal shows "Checking your result…" and reopens the stream waiting for the decision.
      await vi.advanceTimersByTimeAsync(1_000);
      const waiting = collect(await verificationStream(h.request("good", {}, "?wait=decision"), h.deps));
      await vi.advanceTimersByTimeAsync(3_000);
      expect(waiting.text).toContain('data: {"type":"verification.updated"}');
      expect(waiting.text).not.toContain("verification.limited");
      h.controller.abort();
    });

    it("when the budget runs out the stream says so once (the modal offers Check again) instead of waiting silently", async () => {
      vi.useFakeTimers({ now: new Date("2026-10-01T10:00:00Z") });
      const d = didit(Date.now() + 60 * 60_000); // never approves within the test
      const log = vi.fn();
      const h = harness({ ...PROD, poll: d.poll, log });
      const out = collect(await verificationStream(h.request("good", {}, "?wait=decision"), h.deps));
      await vi.advanceTimersByTimeAsync(3 * 60_000 + 3_000); // 60 reads at 3 s, then the budget refuses
      expect(d.reads).toHaveLength(60);
      expect(out.text.match(/data: \{"type":"verification.limited"\}/g)).toHaveLength(1);
      expect(log).toHaveBeenCalledWith("verification.fast_poll_limited", { scope: "budget" });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(out.text.match(/verification.limited/g)).toHaveLength(1);
      h.controller.abort();
    });

    it("a dedupe refusal (another tab just read) is normal and pushes nothing", async () => {
      const h = harness({ poll: async () => ({ state: "limited", scope: "dedupe" }) });
      const res = await verificationStream(h.request("good", {}, "?wait=decision"), h.deps);
      const text = await readUntil(res, (t) => (t.match(/event: ping/g) ?? []).length >= 3);
      expect(text).not.toContain("verification.limited");
      h.controller.abort();
    });
  });
});
