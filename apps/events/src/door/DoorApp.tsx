"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { cameraRetryInS, connectionOf, doorClosed, initialAppState, nextDeadline, reduce, type KioskAppState } from "./kiosk/appState";
import { doorApi, fetchContext, postPinExit, setDoorCsrf } from "./kiosk/client";
import { formatClock } from "./kiosk/format";
import { KioskView } from "./kiosk/KioskView";
import { OperatorOverlay } from "./kiosk/OperatorOverlay";
import { armAt, runPoll, type KioskEffects, type Timers } from "./kiosk/poll";
import { doorScreen, type OvalScreen } from "./kiosk/screen";
import { TestModeBanner } from "./kiosk/TestModeBanner";
import type { FaceScan, KioskContext, SessionEnd } from "./kiosk/types";
import { useMirror } from "./kiosk/useMirror";
import { useStage } from "./kiosk/useStage";
import { addArrival, announcement, arrivalOf, type Arrival } from "./live/tags";
import { useLiveDoor } from "./live/useLiveDoor";
import styles from "./kiosk/kiosk.module.css";

const timers: Timers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export interface DoorAppProps {
  initial: KioskContext;
  /** The page's build; a context from another build means a deploy happened (reload prompt). */
  build: string;
  /** CSRF token bound to this device's door cookie (sent on every door API call). */
  csrf?: string;
  /** Server-rendered QR of the check-in log (K-21), so the QR encoder stays out of this bundle. */
  offlineQr: ReactNode;
  /** The server's render instant: the first clock text matches the server HTML (the 1 s tick then takes over). */
  renderedAt?: number;
}

const testKey = (eventId: string) => `didit-door-test:${eventId}`;

// The AR layer is its own chunk: it can only show something once the camera runs, by which time it has loaded.
const LiveOverlay = dynamic(() => import("./live/LiveOverlay").then((m) => m.LiveOverlay), { ssr: false });

/** The live door's frame: no oval, the AR layer draws over the camera. */
const LIVE_MODEL: OvalScreen = { code: "V5", kind: "oval", camera: "live", cameraTone: "live", tone: "idle" };

/** The live strip over the camera when the door can't admit right now but keeps its preview running. */
export function liveBanner(s: { session: SessionEnd | null; connection: ReturnType<typeof connectionOf>; now: number }): string | null {
  if (s.session) return "Door paused · staff: sign in to continue";
  if (s.connection.state === "offline") {
    if (s.connection.reason === "budget") return "Scan limit reached · manual check-in at the desk";
    return `Offline · reconnecting in ${Math.max(0, Math.ceil((s.connection.retryAt - s.now) / 1000))}s`;
  }
  return null;
}

/**
 * The Door inside Events (kiosk mode): the live multi-face door (camera → on-device detection and tracking → one
 * scan per face → AR name tags + the Arrivals rail), Test mode and the operator panel
 * (press O, or long-press the top-left corner). App state lives in the pure reducer of ./kiosk/appState.ts; this
 * shell only dispatches actions and arms the timers it names. The page is locked to one event's door: leaving needs
 * a sign-in (any team member with door access) or the staff-set PIN.
 */
export function DoorApp({ initial, build, csrf, offlineQr, renderedAt }: DoorAppProps) {
  if (csrf) setDoorCsrf(csrf);
  const base = doorApi(initial.event.slug);
  const stage = useStage();
  const [mirror, setMirror] = useMirror();
  const videoRef = useRef<HTMLVideoElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Test mode starts off on the server and the client alike (no hydration mismatch); a saved choice is restored after mount.
  const [state, dispatch] = useReducer(reduce, initial, (ctx) => initialAppState(ctx, Date.now(), false));
  const [now, setNow] = useState(() => renderedAt ?? Date.now());
  const [fullscreen, setFullscreen] = useState(false);
  const [pin, setPin] = useState<{ open: boolean; value: string; error: string | null; busy: boolean }>({ open: false, value: "", error: null, busy: false });
  const { ctx } = state;
  const stale = !!ctx.build && ctx.build !== build;

  const stateRef = useRef<KioskAppState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const fx = useMemo<KioskEffects>(() => ({ getState: () => stateRef.current, dispatch, now: () => Date.now() }), []);
  const poll = useCallback(() => void runPoll(fx, () => fetchContext(base)), [fx, base]);

  const restored = useRef(false);
  useEffect(() => {
    try { if (sessionStorage.getItem(testKey(ctx.event.id)) === "1") dispatch({ type: "testMode", on: true }); } catch { /* private mode */ }
    restored.current = true;
  }, [ctx.event.id]);
  useEffect(() => {
    if (!restored.current) return;
    try { sessionStorage.setItem(testKey(ctx.event.id), state.testMode ? "1" : "0"); } catch { /* private mode */ }
  }, [state.testMode, ctx.event.id]);

  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [said, setSaid] = useState("");
  const onScan = useCallback((scan: FaceScan, at: number) => {
    dispatch({ type: "scanResult", outcome: scan, now: at });
    const arrival = arrivalOf(scan, at);
    if (arrival) setArrivals((list) => addArrival(list, arrival));
    const sentence = announcement(scan);
    if (sentence) setSaid(sentence);
  }, []);
  const onSession = useCallback((reason: SessionEnd) => dispatch({ type: "sessionEnded", reason }), []);
  const testModeNow = useCallback(() => stateRef.current.testMode, []);
  const closed = doorClosed(state);
  const connection = connectionOf(state);
  const live = useLiveDoor(videoRef, {
    enabled: state.camera.enabled,
    base,
    testMode: testModeNow,
    blocked: closed || state.session !== null || state.budget !== null,
    offline: state.outage !== null,
    strict: ctx.doorMode === "strict",
    onScan,
    onSession,
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Poll Events at `poll.at`: every 15 s online, at the retry time when offline.
  useEffect(() => armAt(state.poll.at, poll, timers), [state.poll.at, poll]);
  useEffect(() => {
    const offline = () => dispatch({ type: "networkLost", now: Date.now() });
    const online = () => dispatch({ type: "pollNow", now: Date.now() });
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, []);

  const deadline = nextDeadline(state);
  useEffect(() => {
    if (deadline === null) return;
    return armAt(deadline, () => dispatch({ type: "tick", now: Date.now() }), timers);
  }, [deadline]);
  useEffect(() => {
    dispatch({ type: "cameraStatus", error: live.cameraError, now: Date.now() });
  }, [live.cameraError]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return dispatch({ type: "overlayClose" });
      const t = e.target;
      const typing = t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;
      if ((e.key === "o" || e.key === "O") && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) dispatch({ type: "overlayToggle" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const overlayOpen = state.overlay.open;
  useEffect(() => {
    if (overlayOpen) panelRef.current?.focus();
  }, [overlayOpen]);
  const pressEnd = () => dispatch({ type: "pressEnd" });

  useEffect(() => {
    const on = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  // Sign in again: the door session stays until the person who signs in has door access to this event. These land on
  // the Door tab (exit, restart, after the PIN); the kiosk itself is this page, /door/kiosk, which a reload keeps.
  const doorPath = `/admin/events/${encodeURIComponent(ctx.event.slug)}/door`;
  // A full page load on purpose: sign-in and exit swap cookies server-side, which client navigation would not pick up.
  const go = (path: string) => window.location.assign(new URL(path, window.location.origin).href);
  // The exit page sends signed-out operators through login and then asks for a CSRF-protected confirmation.
  const signInExit = () => go(`${doorPath}/exit`);
  const signInRestart = () => go(`/login?next=${encodeURIComponent(`${doorPath}?station=${encodeURIComponent(ctx.station.name)}&resume=1`)}`);
  const submitPin = async () => {
    setPin((p) => ({ ...p, busy: true, error: null }));
    const result = await postPinExit(base, pin.value);
    if (result.ok) return go(`/login?next=${encodeURIComponent(doorPath)}`);
    const error = result.error === "wrong_pin" ? "Wrong PIN." : result.error === "locked" ? "Too many tries. Wait 10 minutes or sign in instead." : result.error === "no_pin" ? "No PIN is set for this event. Sign in instead." : result.error === "offline" ? "No connection. Try again." : "Couldn’t end door mode. Sign in instead.";
    setPin((p) => ({ ...p, busy: false, error, value: "" }));
  };

  const tz = ctx.event.timeZone;
  // Closed doors, camera and detector failures get their full screen; everything else keeps the live preview.
  const liveView = !closed && !state.camera.error && !live.detectorError;
  const model = liveView ? LIVE_MODEL : doorScreen({
    door: { eventName: ctx.event.name, timeZone: tz, threshold: ctx.threshold, startsAt: ctx.event.startsAt },
    connection:
      connection.state === "online"
        ? connection
        : { state: "offline", reason: connection.reason, retryInS: (connection.retryAt - now) / 1000, lastOnline: connection.lastOnline === null ? null : formatClock(connection.lastOnline, tz) },
    closed: closed ? (ctx.state === "live" ? "face_off" : ctx.state) : null,
    testMode: state.testMode,
    session: state.session,
    cameraError: state.camera.error,
    cameraRetryInS: cameraRetryInS(state, now),
    detectorError: live.detectorError,
    engine: null,
    stateMs: 0,
    overlayOpen,
  });
  const timeOf = useCallback((at: number) => formatClock(at, tz), [tz]);

  const cameras = live.devices.map((d, i) => ({ value: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  const offline =
    connection.state === "offline"
      ? {
          status: connection.reason === "budget" ? "Scan limit reached" : "Offline",
          detail: [
            connection.reason === "budget" ? "Manual check-in only" : `Reconnecting in ${Math.max(0, Math.ceil((connection.retryAt - now) / 1000))}s`,
            connection.lastOnline === null ? null : `last online ${formatClock(connection.lastOnline, tz)}`,
          ].filter(Boolean).join(" · "),
          qr: offlineQr,
        }
      : undefined;

  return (
    <div className={styles.page} data-operator={overlayOpen || pin.open || state.session ? "" : undefined}>
      <div style={stage.style}>
        {state.testMode && !state.session ? <TestModeBanner /> : null}
        <KioskView
          model={model}
          orientation={stage.orientation}
          width={stage.width}
          height={stage.height}
          camera={<video ref={videoRef} muted playsInline autoPlay />}
          mirror={mirror}
          event={ctx.event.name}
          clock={formatClock(now, tz)}
          badge={ctx.doorMode === "supervised" ? "Staffed entry" : undefined}
          live={
            liveView ? (
              <LiveOverlay
                store={live.store}
                width={stage.width}
                height={stage.height}
                mirror={mirror}
                banner={liveBanner({ session: state.session, connection, now })}
                arrivals={arrivals}
                announcement={said}
                timeOf={timeOf}
              />
            ) : undefined
          }
          overlay={
            overlayOpen ? (
              <OperatorOverlay
                panelRef={panelRef}
                context={ctx}
                cameras={cameras}
                cameraId={live.deviceId ?? cameras[0]?.value ?? ""}
                stats={live.metrics ? `${live.metrics.fps} fps · detect ${live.metrics.detectMs} ms (${live.metrics.passes} passes, ${live.metrics.mode}) · scan p50 ${live.metrics.p50} ms / p95 ${live.metrics.p95} ms (${live.metrics.scans})` : undefined}
                mirror={mirror}
                offline={offline}
                fullscreen={fullscreen}
                testMode={state.testMode}
                testArrived={state.testArrived.length}
                busy={state.busy}
                onCamera={(id) => live.selectDevice(id || null)}
                onMirror={setMirror}
                onTestMode={() => dispatch({ type: "testMode", on: !state.testMode })}
                onRetry={() => dispatch({ type: "pollNow", now: Date.now() })}
                onFullscreen={toggleFullscreen}
                onSignInExit={signInExit}
                onPinExit={() => setPin({ open: true, value: "", error: null, busy: false })}
              />
            ) : null
          }
        />
      </div>
      {state.session ? (
        <div className={styles.notice} role="alert">
          <span>Sign in to keep the door running as “{ctx.station.name}”.</span>
          <button type="button" onClick={signInRestart}>Sign in</button>
        </div>
      ) : stale ? (
        <div className={styles.notice} role="status">
          <span>A new version of the door is ready.</span>
          <button type="button" onClick={() => window.location.reload()}>Reload</button>
        </div>
      ) : null}
      {pin.open ? (
        <form className={`${styles.notice} ${styles.pinCard}`} onSubmit={(e) => { e.preventDefault(); void submitPin(); }} aria-label="End door mode with the PIN">
          <label className={styles.pin}>
            <span>PIN</span>
            <input autoFocus inputMode="numeric" autoComplete="off" pattern="[0-9]*" maxLength={8} value={pin.value} onChange={(e) => setPin((p) => ({ ...p, value: e.target.value.replace(/\D/g, "") }))} aria-invalid={!!pin.error} />
          </label>
          {pin.error ? <span className={styles.error} role="alert">{pin.error}</span> : null}
          <div className={styles.pinFoot} data-pin-footer="">
            <button type="button" onClick={() => setPin({ open: false, value: "", error: null, busy: false })}>Cancel</button>
            <button type="submit" disabled={pin.busy || pin.value.length < 4}>End door mode</button>
          </div>
        </form>
      ) : null}
      <div
        className={styles.hotspot}
        aria-hidden="true"
        onPointerDown={(e) => {
          e.preventDefault();
          dispatch({ type: "pressStart", now: Date.now() });
        }}
        onPointerUp={pressEnd}
        onPointerLeave={pressEnd}
        onPointerCancel={pressEnd}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
