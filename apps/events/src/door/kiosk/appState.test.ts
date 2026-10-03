import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAMERA_REOPEN_MS,
  cameraRetryInS,
  connectionOf,
  initialAppState,
  kioskMode,
  nextDeadline,
  POLL_MS,
  reduce,
  scanningStopped,
  doorClosed,
  type KioskAction,
  type KioskAppState,
} from "./appState";
import type { ContextFetch } from "./client";
import { FIXTURE_OUTCOMES, fixtureContext } from "./fixtures";
import { armAt, runPoll, type KioskEffects } from "./poll";
import { doorScreen } from "./screen";
import type { KioskContext } from "./types";

const T0 = 1_000_000;
const start = (ctx: Partial<KioskContext> = {}) => initialAppState({ ...fixtureContext(), ...ctx }, T0);
const run = (s: KioskAppState, ...actions: KioskAction[]) => actions.reduce(reduce, s);
const ctxWith = (patch: Partial<KioskContext>): KioskContext => ({ ...fixtureContext(), ...patch });

/** The door screen code the shell would render for this state (engine idle, no camera error). */
function screenCode(s: KioskAppState, now = T0): string {
  const c = connectionOf(s);
  return doorScreen({
    door: { eventName: "E", timeZone: "Europe/Madrid", threshold: 80, startsAt: "2026-10-08T18:30:00+02:00" },
    connection: c.state === "online" ? c : { state: "offline", reason: c.reason, retryInS: (c.retryAt - now) / 1000, lastOnline: null },
    closed: doorClosed(s) ? (s.ctx.state === "live" ? "face_off" : s.ctx.state) : null,
    testMode: s.testMode,
    session: s.session,
    cameraError: s.camera.error,
    cameraRetryInS: cameraRetryInS(s, now),
    detectorError: false,
    engine: null,
    stateMs: 0,
    overlayOpen: s.overlay.open,
  }).code;
}

describe("kiosk mode precedence", () => {
  const outage: KioskAction = { type: "pollFailed", reason: "network", now: T0 };
  const budget: KioskAction = { type: "scanResult", outcome: FIXTURE_OUTCOMES.budget_exhausted, now: T0 };
  it.each([
    { name: "online", paused: false, actions: [], mode: "online", code: "K-01", stopped: false },
    { name: "closed (not started)", paused: true, actions: [], mode: "closed", code: "D-01a", stopped: false },
    { name: "budget", paused: false, actions: [budget], mode: "budget", code: "K-19", stopped: true },
    { name: "budget beats closed", paused: true, actions: [budget], mode: "budget", code: "K-19", stopped: true },
    { name: "offline", paused: false, actions: [outage], mode: "offline", code: "K-12c", stopped: true },
    { name: "offline beats closed", paused: true, actions: [outage], mode: "offline", code: "K-12c", stopped: true },
    { name: "offline beats budget", paused: false, actions: [budget, outage], mode: "offline", code: "K-12c", stopped: true },
    { name: "offline beats budget + closed", paused: true, actions: [budget, outage], mode: "offline", code: "K-12c", stopped: true },
  ] as const)("$name", ({ paused, actions, mode, code, stopped }) => {
    const s = run(start({ state: paused ? "not_started" : "live" }), ...actions);
    expect(kioskMode(s)).toBe(mode);
    expect(screenCode(s)).toBe(code);
    expect(scanningStopped(s)).toBe(stopped);
  });

  it("Test mode opens a closed door (never with face check-in off) and is labelled on every result", () => {
    const s = run(start({ state: "not_started" }), { type: "testMode", on: true });
    expect(kioskMode(s)).toBe("online");
    expect(screenCode(s)).toBe("K-01");
    expect(kioskMode(run(start({ state: "ended" }), { type: "testMode", on: true }))).toBe("online");
    const off = run(start({ state: "face_off" }), { type: "testMode", on: true });
    expect(off.testMode).toBe(false);
    expect(screenCode(off)).toBe("D-01e");
    // A poll that turns face check-in off also turns Test mode off.
    const later = reduce(s, { type: "contextReceived", context: ctxWith({ state: "face_off" }), requestedAt: T0, now: T0 + 1, source: "poll" });
    expect(later.testMode).toBe(false);
    // A Test mode welcome does not count as an arrival.
    const tested = run(s, { type: "scanResult", outcome: FIXTURE_OUTCOMES.welcomed_test, now: T0 + 5 });
    expect(tested.ctx.arrived).toBe(s.ctx.arrived);
    expect(tested.ctx.recentScans[0]).toMatchObject({ result: "welcomed", test: true });
    // …but the operator's Arrived counter shows the people this test session welcomed, once each.
    const welcomed = { ...FIXTURE_OUTCOMES.welcomed_test, registrationId: "r1" } as typeof FIXTURE_OUTCOMES.welcomed_test;
    const once = run(s, { type: "scanResult", outcome: welcomed, now: T0 + 5 });
    const twice = run(once, { type: "scanResult", outcome: welcomed, now: T0 + 6 });
    expect(twice.testArrived).toHaveLength(1);
    const other = run(twice, { type: "scanResult", outcome: { ...welcomed, registrationId: "r2" } as typeof FIXTURE_OUTCOMES.welcomed_test, now: T0 + 7 });
    // Two guests with the same name count twice.
    expect(other.testArrived).toEqual(["r1", "r2"]);
    expect(other.testArrived).toHaveLength(2);
    expect(run(other, { type: "testMode", on: false }).testArrived).toEqual([]);
  });

  it.each(["expired", "ended", "revoked"] as const)("a %s door session beats everything and freezes the state (D-02)", (reason) => {
    const s = run(start({ state: "not_started" }), budget, outage, { type: "sessionEnded", reason });
    expect(kioskMode(s)).toBe("session");
    expect(screenCode(s)).toBe("D-02");
    expect(scanningStopped(s)).toBe(true);
    expect(run(s, { type: "pollNow", now: T0 + 1 }, { type: "overlayToggle" })).toBe(s);
  });

  it("a service error from a scan is a one-off result (K-12a on the engine), not an outage", () => {
    const s = run(start(), { type: "scanResult", outcome: { result: "error", reason: "service", retryInS: 12 }, now: T0 });
    expect(kioskMode(s)).toBe("online");
    const credits = run(start(), { type: "scanResult", outcome: { result: "error", reason: "credits", retryInS: 30 }, now: T0 });
    expect(kioskMode(credits)).toBe("offline");
    expect(credits.poll.at).toBe(T0 + 30_000);
    expect(screenCode(credits)).toBe("K-12b");
  });
});

describe("scan budget (K-19)", () => {
  const exhausted = run(start(), { type: "scanResult", outcome: FIXTURE_OUTCOMES.budget_exhausted, now: T0 + 1000 });

  it("is persistent: it does not time out, survives later scans and outages, and stops the engine", () => {
    let s = exhausted;
    for (const t of [4000, 5000, 60_000, 3_600_000]) s = reduce(s, { type: "tick", now: T0 + t });
    s = run(s, { type: "scanResult", outcome: FIXTURE_OUTCOMES.welcomed, now: T0 + 2000 });
    expect(kioskMode(s)).toBe("budget");
    s = run(s, { type: "pollFailed", reason: "network", now: T0 + 20_000 }, { type: "contextReceived", context: ctxWith({ budgetExhausted: true }), requestedAt: T0 + 25_000, now: T0 + 25_100, source: "poll" });
    expect(kioskMode(s)).toBe("budget");
    expect(scanningStopped(s)).toBe(true);
    expect(connectionOf(s)).toMatchObject({ state: "offline", reason: "budget" });
  });

  it("a context requested before the budget ran out cannot clear it", () => {
    const s = run(exhausted, { type: "contextReceived", context: ctxWith({ budgetExhausted: false }), requestedAt: T0 + 500, now: T0 + 1500, source: "poll" });
    expect(kioskMode(s)).toBe("budget");
  });

  it("recovers only when a later context says the budget is available (e.g. the next day)", () => {
    const still = run(exhausted, { type: "contextReceived", context: ctxWith({ budgetExhausted: true }), requestedAt: T0 + 15_000, now: T0 + 15_100, source: "poll" });
    expect(kioskMode(still)).toBe("budget");
    const back = run(still, { type: "contextReceived", context: ctxWith({ budgetExhausted: false }), requestedAt: T0 + 30_000, now: T0 + 30_100, source: "poll" });
    expect(kioskMode(back)).toBe("online");
    expect(scanningStopped(back)).toBe(false);
    expect(screenCode(back)).toBe("K-01");
  });

  it("starts in budget mode when the server-rendered context says so, and keeps polling", () => {
    const s = start({ budgetExhausted: true });
    expect(kioskMode(s)).toBe("budget");
    expect(s.poll.at).toBe(T0 + POLL_MS);
  });
});

describe("camera errors (K-02) and retry backoff", () => {
  it("retries a busy camera at 5 s, then 10 s, 20 s, 30 s (cap), releasing it for 50 ms each time", () => {
    let s = run(start(), { type: "cameraStatus", error: "in_use", now: T0 });
    expect(screenCode(s)).toBe("K-02c");
    let t = T0;
    for (const wait of [5000, 10_000, 20_000, 30_000, 30_000]) {
      expect(s.camera.retryAt).toBe(t + wait);
      expect(cameraRetryInS(s, t)).toBe(wait / 1000);
      t += wait;
      expect(nextDeadline(s)).toBe(t);
      s = reduce(s, { type: "tick", now: t });
      expect(s.camera).toMatchObject({ enabled: false, reopenAt: t + CAMERA_REOPEN_MS });
      t += CAMERA_REOPEN_MS;
      s = reduce(s, { type: "tick", now: t });
      expect(s.camera.enabled).toBe(true);
      // The hook re-reports the same error (no edge) — the reducer already armed the next retry.
      s = reduce(s, { type: "cameraStatus", error: "in_use", now: t + 10 });
    }
  });

  it("resets the backoff once the camera opens", () => {
    let s = run(start(), { type: "cameraStatus", error: "in_use", now: T0 }, { type: "tick", now: T0 + 5000 }, { type: "tick", now: T0 + 5050 });
    expect(s.camera.attempt).toBe(1);
    s = reduce(s, { type: "cameraStatus", error: null, now: T0 + 5200 });
    expect(s.camera).toMatchObject({ error: null, attempt: 0, retryAt: null, enabled: true });
    expect(screenCode(s)).toBe("K-01");
    s = reduce(s, { type: "cameraStatus", error: "in_use", now: T0 + 9000 });
    expect(s.camera.retryAt).toBe(T0 + 14_000);
  });

  it.each([
    ["permission_denied", "K-02a"],
    ["not_found", "K-02b"],
  ] as const)("%s is not retried automatically (%s)", (error, code) => {
    const s = run(start(), { type: "cameraStatus", error, now: T0 });
    expect(s.camera.retryAt).toBeNull();
    expect(nextDeadline(s)).toBeNull();
    expect(screenCode(s)).toBe(code);
  });
});

describe("operator overlay", () => {
  it("toggles with O and closes with Esc", () => {
    const s = run(start(), { type: "overlayToggle" });
    expect(s.overlay.open).toBe(true);
    expect(screenCode(s)).toBe("K-13");
    expect(run(s, { type: "overlayToggle" }).overlay.open).toBe(false);
    expect(run(s, { type: "overlayClose" }).overlay.open).toBe(false);
    expect(run(start(), { type: "overlayClose" }).overlay.open).toBe(false);
  });

  it("opens on a 2 s long-press only", () => {
    const pressed = run(start(), { type: "pressStart", now: T0 });
    expect(nextDeadline(pressed)).toBe(T0 + 2000);
    expect(run(pressed, { type: "tick", now: T0 + 1999 }).overlay.open).toBe(false);
    expect(run(pressed, { type: "tick", now: T0 + 2000 }).overlay).toEqual({ open: true, pressAt: null });
    const released = run(pressed, { type: "tick", now: T0 + 1500 }, { type: "pressEnd" }, { type: "tick", now: T0 + 2500 });
    expect(released.overlay).toEqual({ open: false, pressAt: null });
  });

  it("shows K-21 (manual check-in) data while the budget is spent", () => {
    const s = run(start(), { type: "scanResult", outcome: FIXTURE_OUTCOMES.budget_exhausted, now: T0 }, { type: "overlayToggle" });
    expect(s.overlay.open).toBe(true);
    expect(connectionOf(s)).toMatchObject({ state: "offline", reason: "budget" });
    expect(screenCode(s)).toBe("K-19");
  });
});

describe("merging a context with local scans", () => {
  const scanAt = (now: number): KioskAction => ({ type: "scanResult", outcome: FIXTURE_OUTCOMES.welcomed, now });

  it("keeps scans that arrived after the request left; drops those the server already has", () => {
    let s = run(start(), scanAt(T0 + 1000), { type: "pollStarted", now: T0 + 2000 }, scanAt(T0 + 3000));
    expect(s.ctx.arrived).toBe(44);
    const server = ctxWith({ arrived: 43, recentScans: [{ id: "scn_101", at: new Date(T0 + 1000).toISOString(), name: "Maria García", result: "welcomed" as const }, ...fixtureContext().recentScans].slice(0, 5) });
    s = reduce(s, { type: "contextReceived", context: server, requestedAt: T0 + 2000, now: T0 + 4000, source: "poll" });
    expect(s.ctx.arrived).toBe(44);
    expect(s.ctx.recentScans[0]).toMatchObject({ id: `local_${T0 + 3000}`, name: "Maria García" });
    expect(s.ctx.recentScans[1]!.id).toBe("scn_101");
    expect(s.ctx.recentScans).toHaveLength(5);
    // The next context, requested after that scan, replaces it.
    s = reduce(s, { type: "contextReceived", context: ctxWith({ arrived: 44 }), requestedAt: T0 + 17_000, now: T0 + 17_100, source: "poll" });
    expect(s.ctx.arrived).toBe(44);
    expect(s.localScans).toEqual([]);
    expect(s.ctx.recentScans[0]!.id).toBe("scn_5");
  });

  it("a poll that reports the event ended closes the door (D-01b) and keeps local arrivals", () => {
    const s = run(start(), scanAt(T0 + 500), {
      type: "contextReceived",
      context: ctxWith({ state: "ended" }),
      requestedAt: T0,
      now: T0 + 800,
      source: "poll",
    });
    expect(s).toMatchObject({ ctx: { state: "ended", arrived: 43 } });
    expect(kioskMode(s)).toBe("closed");
    expect(screenCode(s)).toBe("D-01b");
  });
});

describe("poll scheduling (fake timers)", () => {
  beforeEach(() => vi.useFakeTimers({ now: T0 }));
  afterEach(() => vi.useRealTimers());

  /** The shell: a reducer store, with the poll timer re-armed only when `poll.at` changes (like KioskApp's effect). */
  function harness(responses: (n: number) => ContextFetch, latencyMs = 300) {
    let state = start();
    let cancel: () => void = () => undefined;
    const calls: number[] = [];
    const fetchContext = () => {
      calls.push(Date.now() - T0);
      return new Promise<ContextFetch>((resolve) => setTimeout(() => resolve(responses(calls.length)), latencyMs));
    };
    const timers = { now: () => Date.now(), setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>) };
    const arm = () => {
      cancel();
      cancel = armAt(state.poll.at, () => void runPoll(fx, fetchContext), timers);
    };
    const fx: KioskEffects = {
      getState: () => state,
      now: () => Date.now(),
      dispatch: (a) => {
        const prev = state.poll.at;
        state = reduce(state, a);
        if (state.poll.at !== prev) arm();
      },
    };
    arm();
    return { calls, fx, get state() { return state; } };
  }

  it("polls every 15 s from each poll's start over 3 cycles, whatever scans and responses do to the context", async () => {
    const h = harness((n) => ({ ok: true, context: ctxWith({ arrived: 42 + n }) }));
    for (const at of [7000, 22_000, 37_000]) {
      await vi.advanceTimersByTimeAsync(at - (Date.now() - T0));
      h.fx.dispatch({ type: "scanResult", outcome: FIXTURE_OUTCOMES.welcomed, now: Date.now() });
    }
    await vi.advanceTimersByTimeAsync(45_500 - (Date.now() - T0));
    expect(h.calls).toEqual([15_000, 30_000, 45_000]);
    expect(h.state.poll).toEqual({ at: T0 + 60_000, inFlightSince: null });
  });

  it("retries at the outage delay, then returns to the 15 s cadence", async () => {
    const h = harness((n) => (n === 1 ? { ok: false, reason: "network" } : { ok: true, context: fixtureContext() }));
    await vi.advanceTimersByTimeAsync(15_300);
    expect(kioskMode(h.state)).toBe("offline");
    await vi.advanceTimersByTimeAsync(5_300 + 15_000 + 15_000);
    expect(h.calls).toEqual([15_000, 20_300, 35_300, 50_300]);
    expect(kioskMode(h.state)).toBe("online");
  });

  it("Retry / browser online polls now; a poll that overruns its slot re-arms instead of stalling", async () => {
    const h = harness(() => ({ ok: true, context: fixtureContext() }), 20_000);
    await vi.advanceTimersByTimeAsync(3000);
    h.fx.dispatch({ type: "pollNow", now: Date.now() });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls).toEqual([3000]);
    await vi.advanceTimersByTimeAsync(20_000); // 18 s: slot missed while in flight; 23 s: response → poll again at once
    await vi.advanceTimersByTimeAsync(1); // a 0 ms timeout fires on the next millisecond
    expect(h.calls).toEqual([3000, 23_001]);
    expect(h.state.poll.at).toBe(T0 + 23_001 + POLL_MS);
  });

  it("a 401 on the poll ends the loop and asks for a sign-in (D-02) without losing the door", async () => {
    const h = harness(() => ({ ok: false, session: "expired", reason: "service" }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.calls).toEqual([15_000]);
    expect(kioskMode(h.state)).toBe("session");
    expect(h.state.session).toBe("expired");
    expect(h.state.ctx.station.name).toBe("Main door");
  });
});

describe("poll timeout (review fix)", () => {
  afterEach(() => vi.useRealTimers());
  it("a context fetch that never settles is failed after the timeout and releases the poll slot", async () => {
    vi.useFakeTimers();
    const actions: { type: string }[] = [];
    let state = { session: null, poll: { at: 0, inFlightSince: null as number | null } } as unknown as KioskAppState;
    const fx: KioskEffects = {
      getState: () => state,
      dispatch: (a) => {
        actions.push(a);
        if (a.type === "pollStarted") state = { ...state, poll: { ...state.poll, inFlightSince: 1 } } as KioskAppState;
        if (a.type === "pollFailed") state = { ...state, poll: { ...state.poll, inFlightSince: null } } as KioskAppState;
      },
      now: () => Date.now(),
    };
    const hung = () => new Promise<ContextFetch>(() => {});
    const p = runPoll(fx, hung, 1000);
    await vi.advanceTimersByTimeAsync(999);
    expect(actions.map((a) => a.type)).toEqual(["pollStarted"]);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(actions.map((a) => a.type)).toEqual(["pollStarted", "pollFailed"]);
    expect(state.poll.inFlightSince).toBeNull();
  });
});
