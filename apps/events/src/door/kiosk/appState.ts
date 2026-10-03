// The door's app-level state machine as a pure reducer: connection (outage / daily scan budget / online), camera
// errors and their retry backoff, the operator overlay, Test mode, the poll schedule, and the end of the door session. Time is always passed in
// (`now`, epoch ms), so every transition is table-testable; KioskApp only dispatches actions and arms timers for the
// deadlines this state names.
import { withScan } from "./client";
import type { CameraError } from "../face/camera";
import type { Connection, KioskContext, OutageReason, RecentScan, ScanOutcome, SessionEnd } from "./types";

/** Events is polled this often while online (counters, pause state, budget, revocation). */
export const POLL_MS = 15_000;
/** Retry delays per outage (K-12a/b/c copy). */
export const RETRY_S: Record<OutageReason, number> = { service: 12, credits: 30, network: 5 };
/** Long-press on the top-left corner opens the operator panel. */
export const LONG_PRESS_MS = 2000;
/** K-02c: first retry after 5 s, doubling per failed attempt up to 30 s. */
export const CAMERA_RETRY_MS = 5000;
export const CAMERA_RETRY_MAX_MS = 30_000;
/** How long the camera stays released before it is reopened on a retry. */
export const CAMERA_REOPEN_MS = 50;

export interface LocalScan {
  /** Client time the scan result arrived. */
  at: number;
  scan: RecentScan;
  welcomed: boolean;
}

export interface KioskAppState {
  ctx: KioskContext;
  /** Events or Didit unreachable (K-12). Retried at `retryAt`. */
  outage: { reason: OutageReason; retryAt: number } | null;
  /** Daily scan budget spent (K-19): sticky until a context fetched after `since` says the budget is back. */
  budget: { since: number } | null;
  /** Last time Events answered. */
  lastOnline: number | null;
  /** Scans shown locally since the last context fetch started; replayed on top of a context that may predate them. */
  localScans: LocalScan[];
  /** Next context poll is due at `at`; `inFlightSince` is the start of the poll in flight. */
  poll: { at: number; inFlightSince: number | null };
  camera: { enabled: boolean; error: CameraError | null; attempt: number; retryAt: number | null; reopenAt: number | null };
  overlay: { open: boolean; pressAt: number | null };
  busy: boolean;
  /** Test mode: real recognition, nobody is checked in. Works before the start and after the end. */
  testMode: boolean;
  /** Test mode: the guests this test session welcomed (by registration id, once each), so the Arrived counter can be checked. */
  testArrived: string[];
  /** The door session stopped (expired, ended elsewhere, access removed): the door asks for a sign-in. */
  session: SessionEnd | null;
}

export type KioskAction =
  | { type: "scanResult"; outcome: ScanOutcome; now: number }
  | { type: "sessionEnded"; reason: SessionEnd }
  | { type: "testMode"; on: boolean }
  | { type: "pollStarted"; now: number }
  | { type: "pollFailed"; reason: "network" | "service"; now: number }
  /** A fresh context: from a poll (`source: "poll"`) or a mutation's response. `requestedAt` = when the request left. */
  | { type: "contextReceived"; context: KioskContext; requestedAt: number; now: number; source: "poll" | "mutation" }
  | { type: "mutationStarted" }
  | { type: "mutationFailed" }
  | { type: "networkLost"; now: number }
  /** Browser back online, or the operator pressed Retry: poll right away. */
  | { type: "pollNow"; now: number }
  | { type: "cameraStatus"; error: CameraError | null; now: number }
  | { type: "overlayToggle" }
  | { type: "overlayClose" }
  | { type: "pressStart"; now: number }
  | { type: "pressEnd" }
  /** A deadline from `nextDeadline` passed (camera retry/reopen, long-press). */
  | { type: "tick"; now: number };

export function initialAppState(ctx: KioskContext, now: number, testMode = false): KioskAppState {
  return {
    ctx,
    outage: null,
    budget: ctx.budgetExhausted ? { since: now } : null,
    lastOnline: now,
    localScans: [],
    testArrived: [],
    poll: { at: now + POLL_MS, inFlightSince: null },
    camera: { enabled: true, error: null, attempt: 0, retryAt: null, reopenAt: null },
    overlay: { open: false, pressAt: null },
    busy: false,
    testMode: testMode && ctx.state !== "face_off",
    session: null,
  };
}

export const cameraBackoffMs = (attempt: number) => Math.min(CAMERA_RETRY_MS * 2 ** attempt, CAMERA_RETRY_MAX_MS);

function goOffline(s: KioskAppState, reason: OutageReason, now: number): KioskAppState {
  const retryAt = now + RETRY_S[reason] * 1000;
  return { ...s, outage: { reason, retryAt }, poll: { ...s.poll, at: retryAt } };
}

/** The server context, with the local scans it may not include yet (those that arrived after the request left). */
function mergeContext(s: KioskAppState, context: KioskContext, requestedAt: number): Pick<KioskAppState, "ctx" | "localScans"> {
  const pending = s.localScans.filter((l) => l.at >= requestedAt);
  const ids = new Set(context.recentScans.map((r) => r.id));
  const newest = [...pending].sort((a, b) => b.at - a.at).map((l) => l.scan).filter((r) => !ids.has(r.id));
  return {
    ctx: {
      ...context,
      arrived: context.arrived + pending.filter((l) => l.welcomed).length,
      recentScans: [...newest, ...context.recentScans].slice(0, 5),
    },
    localScans: pending,
  };
}

export function reduce(s: KioskAppState, a: KioskAction): KioskAppState {
  if (s.session) return s; // waiting for a sign-in: nothing else matters
  switch (a.type) {
    case "scanResult": {
      const { outcome, now } = a;
      let next: KioskAppState = s;
      if (outcome.result === "error" && outcome.reason !== "service") next = goOffline(s, outcome.reason, now);
      else next = { ...s, lastOnline: now };
      if (outcome.result === "budget_exhausted") next = { ...next, budget: next.budget ?? { since: now } };
      const ctx = withScan(next.ctx, outcome, new Date(now));
      if (ctx === next.ctx) return next;
      const scan = ctx.recentScans[0]!;
      const tested = outcome.test && outcome.result === "welcomed" ? (outcome.registrationId ?? `name:${outcome.fullName.trim().toLowerCase()}`) : "";
      const testArrived = tested && !next.testArrived.includes(tested) ? [...next.testArrived, tested] : next.testArrived;
      return { ...next, ctx, testArrived, localScans: [...next.localScans, { at: now, scan, welcomed: outcome.result === "welcomed" && !outcome.test }] };
    }
    case "sessionEnded":
      return { ...s, session: a.reason, busy: false, overlay: { open: false, pressAt: null } };
    case "testMode":
      return { ...s, testMode: a.on && s.ctx.state !== "face_off", testArrived: [] };
    case "pollStarted":
      return { ...s, poll: { at: a.now + POLL_MS, inFlightSince: a.now } };
    case "pollFailed": {
      const next = goOffline(s, a.reason, a.now);
      return { ...next, poll: { ...next.poll, inFlightSince: null } };
    }
    case "contextReceived": {
      const { context, requestedAt, now } = a;
      const budget = context.budgetExhausted ? (s.budget ?? { since: now }) : s.budget && s.budget.since > requestedAt ? s.budget : null;
      const poll =
        a.source === "poll"
          ? // A poll that overran its slot re-arms at once rather than stalling the chain.
            { at: Math.max(s.poll.at, now), inFlightSince: null }
          : s.outage // back online through a mutation: the outage retry slot becomes a normal one
            ? { ...s.poll, at: now + POLL_MS }
            : s.poll;
      return {
        ...s,
        ...mergeContext(s, context, requestedAt),
        testMode: s.testMode && context.state !== "face_off",
        outage: null,
        budget,
        lastOnline: now,
        poll,
        busy: a.source === "mutation" ? false : s.busy,
      };
    }
    case "mutationStarted":
      return { ...s, busy: true };
    case "mutationFailed":
      return { ...s, busy: false };
    case "networkLost":
      return goOffline(s, "network", a.now);
    case "pollNow":
      return { ...s, poll: { ...s.poll, at: a.now } };
    case "cameraStatus": {
      const { error, now } = a;
      if (error === null) return { ...s, camera: { ...s.camera, error: null, attempt: 0, retryAt: null } };
      const retryAt = error === "in_use" ? (s.camera.retryAt ?? now + cameraBackoffMs(s.camera.attempt)) : null;
      return { ...s, camera: { ...s.camera, error, retryAt } };
    }
    case "overlayToggle":
      return { ...s, overlay: { ...s.overlay, open: !s.overlay.open } };
    case "overlayClose":
      return { ...s, overlay: { ...s.overlay, open: false } };
    case "pressStart":
      return { ...s, overlay: { ...s.overlay, pressAt: a.now + LONG_PRESS_MS } };
    case "pressEnd":
      return s.overlay.pressAt === null ? s : { ...s, overlay: { ...s.overlay, pressAt: null } };
    case "tick": {
      const { now } = a;
      let { camera, overlay } = s;
      if (camera.retryAt !== null && camera.retryAt <= now) {
        camera = { ...camera, enabled: false, retryAt: null, reopenAt: now + CAMERA_REOPEN_MS };
      } else if (camera.reopenAt !== null && camera.reopenAt <= now) {
        // Still busy after the reopen → the camera hook won't report it again, so the next retry is armed here.
        const attempt = camera.attempt + 1;
        camera = { ...camera, enabled: true, reopenAt: null, attempt, retryAt: camera.error === "in_use" ? now + cameraBackoffMs(attempt) : null };
      }
      if (overlay.pressAt !== null && overlay.pressAt <= now) overlay = { open: true, pressAt: null };
      return camera === s.camera && overlay === s.overlay ? s : { ...s, camera, overlay };
    }
  }
}

/** The soonest time a `tick` has work to do, or null. */
export function nextDeadline(s: KioskAppState): number | null {
  const times = [s.camera.retryAt, s.camera.reopenAt, s.overlay.pressAt].filter((t): t is number => t !== null);
  return times.length ? Math.min(...times) : null;
}

export type KioskMode = "session" | "offline" | "budget" | "closed" | "online";

/** The door admits nobody: face check-in is off, or the event is not live and Test mode is off. */
export const doorClosed = (s: Pick<KioskAppState, "ctx" | "testMode">) => s.ctx.state === "face_off" || (s.ctx.state !== "live" && !s.testMode);

/** Precedence: session ended → outage (K-12) → scan budget (K-19) → closed (D-01) → scanning. */
export function kioskMode(s: KioskAppState): KioskMode {
  if (s.session) return "session";
  if (s.outage) return "offline";
  if (s.budget) return "budget";
  if (doorClosed(s)) return "closed";
  return "online";
}

/** The engine scans only in `online`; closed keeps its own pause override. */
export const scanningStopped = (s: KioskAppState) => s.session !== null || s.outage !== null || s.budget !== null;

/** What the door screen and the operator overlay (K-21) show about connectivity. */
export function connectionOf(s: KioskAppState): Connection {
  if (s.outage) return { state: "offline", reason: s.outage.reason, retryAt: s.outage.retryAt, lastOnline: s.lastOnline };
  if (s.budget) return { state: "offline", reason: "budget", retryAt: s.poll.at, lastOnline: s.lastOnline };
  return { state: "online" };
}

/** Seconds left on the K-02c camera retry, or null when none is armed. */
export function cameraRetryInS(s: KioskAppState, now: number): number | null {
  if (s.camera.error !== "in_use") return null;
  if (s.camera.retryAt === null) return 0;
  return Math.max(0, Math.ceil((s.camera.retryAt - now) / 1000));
}
