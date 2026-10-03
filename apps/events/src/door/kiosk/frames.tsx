// Door frames for the /_frames gallery: K-01…K-13 from design/03 Kiosk.dc.html, K-14…K-21 from design-prompt.md §3
// D-01…D-03 for the door inside Events (closed states, session ended, Test mode) and L-01…L-03 for the v5 live
// multi-face door (AR name tags, Arrivals rail, offline, idle), each in landscape (1920×1080)
// and portrait (1080×1920). Every frame is a real screen model from ./screen rendered by the same KioskView the live
// door uses, with the fixtures in ./fixtures.
import type { ReactNode } from "react";
import { QrCode } from "@didit-events/ui/qr";
import type { FrameDef } from "@didit-events/ui/frames";
import { KIOSK_SIZES, type KioskOrientation } from "@didit-events/ui/kiosk";
import { KioskView } from "./KioskView";
import { LiveOverlay } from "../live/LiveOverlay";
import { LiveStore, type LiveFace } from "../live/store";
import { addArrival, arrivalOf, tagView, type Arrival } from "../live/tags";
import { OperatorOverlay } from "./OperatorOverlay";
import { TestModeBanner } from "./TestModeBanner";
import { FIXTURE_CAMERAS, FIXTURE_NOW, FIXTURE_OUTCOMES, FIXTURE_TIME_ZONE, fixtureContext } from "./fixtures";
import { formatClock } from "./format";
import {
  adjustScreen,
  asTest,
  budgetScreen,
  closedScreen,
  cameraErrorScreen,
  holdScreen,
  idleScreen,
  outageScreen,
  outcomeScreen,
  pausedScreen,
  sessionScreen,
  verifyingScreen,
  type ScreenModel,
} from "./screen";

interface LiveFixture {
  faces: LiveFace[];
  banner?: string;
  arrivals: Arrival[];
  idle?: boolean;
}

interface KioskFrameSpec {
  /** Design frame id (K-00a, K-01, …); the portrait twin adds "-portrait". */
  id: string;
  /** The design's data-screen-label (landscape). */
  label: string;
  model: ScreenModel;
  overlay?: "live" | "offline";
  badge?: string;
  /** The persistent Test mode banner above the screen. */
  test?: boolean;
  /** v5 live door: tracked faces (camera px, 1280×720) and the rail. */
  live?: LiveFixture;
}

const NOW = Date.parse(FIXTURE_NOW);
const ctx = fixtureContext();
const door = { eventName: ctx.event.name, timeZone: FIXTURE_TIME_ZONE, threshold: ctx.threshold };
const O = FIXTURE_OUTCOMES;
const LIVE: ScreenModel = { code: "V5", kind: "oval", camera: "live", cameraTone: "live", tone: "idle" };

const verified = { verified: true, verifiedAt: "2026-09-12T10:00:00.000Z", photo: "none" as const };
const LIVE_SCANS = {
  maria: { ...O.welcomed, test: false, outcome: "welcome" as const, displayName: "Maria García", trackId: 1, ...verified },
  long: { result: "not_on_list" as const, firstName: "Maximiliana", test: false, outcome: "not_on_list" as const, displayName: "Maximiliana Alessandra Fitzgerald-Montgomery", trackId: 3, ...verified },
};
const LIVE_ARRIVALS = [
  arrivalOf({ ...O.welcomed, displayName: "Kenji Watanabe", verified: true, verifiedAt: null }, NOW - 300_000)!,
  arrivalOf({ ...O.welcome_back, displayName: "Oliver Bennett", verified: false, verifiedAt: null }, NOW - 60_000)!,
  arrivalOf(LIVE_SCANS.maria, NOW)!,
].reduce((list: Arrival[], a) => addArrival(list, a), []);
const LIVE_FACES: LiveFace[] = [
  { id: 1, box: { x: 300, y: 250, w: 190, h: 230 }, view: tagView({ state: "done", scan: LIVE_SCANS.maria }) },
  { id: 2, box: { x: 700, y: 300, w: 120, h: 145 }, view: tagView({ state: "checking" }) },
  { id: 3, box: { x: 930, y: 40, w: 90, h: 110 }, view: tagView({ state: "done", scan: LIVE_SCANS.long }) },
  { id: 4, box: { x: 1060, y: 330, w: 54, h: 66 }, view: tagView({ state: "done", scan: { result: "unknown", threshold: 80, bestScore: null } }) },
];

export const KIOSK_FRAME_SPECS: KioskFrameSpec[] = [
  { id: "K-01", label: "K-01 Idle / attract", model: idleScreen(door) },
  { id: "K-02a", label: "K-02 Camera permission needed", model: cameraErrorScreen("permission_denied") },
  { id: "K-02b", label: "K-02 Camera not found", model: cameraErrorScreen("not_found") },
  { id: "K-02c", label: "K-02 Camera in use", model: cameraErrorScreen("in_use") },
  { id: "K-03a", label: "K-03 Adjust / move closer", model: adjustScreen("too_far") },
  { id: "K-03b", label: "K-03 Adjust / step back", model: adjustScreen("too_close") },
  { id: "K-03c", label: "K-03 Adjust / center", model: adjustScreen("off_center") },
  { id: "K-03d", label: "K-03 Adjust / look at screen", model: adjustScreen("not_frontal") },
  { id: "K-03e", label: "K-03 Adjust / more light", model: adjustScreen("too_dark") },
  { id: "K-03f", label: "K-03 Adjust / one person", model: adjustScreen("multiple_faces") },
  { id: "K-04", label: "K-04 Hold still", model: holdScreen(0.62) },
  { id: "K-05a", label: "K-05 Verifying", model: verifyingScreen(0) },
  { id: "K-05b", label: "K-05 Verifying / after 4s", model: verifyingScreen(4000) },
  { id: "K-06", label: "K-06 Welcome", model: outcomeScreen(O.welcomed, door) },
  { id: "K-07", label: "K-07 Welcome back", model: outcomeScreen(O.welcome_back, door) },
  { id: "K-08", label: "K-08 Not recognised", model: outcomeScreen(O.unknown, door) },
  { id: "K-09", label: "K-09 Not on this list", model: outcomeScreen(O.not_on_list, door) },
  { id: "K-10", label: "K-10 Verification not finished", model: outcomeScreen(O.not_verified, door) },
  { id: "K-11", label: "K-11 Paused", model: pausedScreen() },
  { id: "K-12a", label: "K-12 Offline / service problem", model: outageScreen("service", 12) },
  { id: "K-12b", label: "K-12 Staff / out of credits", model: outageScreen("credits", 30) },
  { id: "K-12c", label: "K-12 Staff / network offline", model: outageScreen("network", 5, "19:51") },
  { id: "K-13", label: "K-13 Operator overlay", model: idleScreen(door, true), overlay: "live" },
  // Derived frames (design-prompt.md §3); no design file yet, so these follow the K-01 / K-08 / K-12 / K-13 system.
  { id: "K-14", label: "K-14 Supervised mode badge", model: idleScreen(door), badge: "Staffed entry" },
  { id: "K-15", label: "K-15 Double check", model: outcomeScreen(O.ambiguous, door) },
  { id: "K-16", label: "K-16 Can't confirm", model: outcomeScreen(O.inconclusive, door) },
  { id: "K-17", label: "K-17 Not admitted", model: outcomeScreen(O.not_admitted, door) },
  { id: "K-18", label: "K-18 Liveness check failed", model: outcomeScreen(O.liveness_failed, door) },
  { id: "K-19", label: "K-19 Daily limit reached", model: budgetScreen() },
  { id: "K-21", label: "K-21 Offline / staff overlay", model: outageScreen("network", 12, "19:51"), overlay: "offline" },
  { id: "K-12d", label: "K-12 Server error / request id", model: outcomeScreen(O.error, door) },
  { id: "K-17b", label: "K-17 Not admitted / declined", model: outcomeScreen(O.not_admitted_rejected, door) },
  // The door inside Events (v4): closed states instead of a dead "paused", the session-ended re-auth, Test mode.
  { id: "D-01a", label: "D-01 Closed / doors open later", model: closedScreen("not_started", ctx.event) },
  { id: "D-01b", label: "D-01 Closed / event ended", model: closedScreen("ended", ctx.event) },
  { id: "D-01c", label: "D-01 Closed / event cancelled", model: closedScreen("cancelled", ctx.event) },
  { id: "D-01d", label: "D-01 Closed / draft", model: closedScreen("draft", ctx.event) },
  { id: "D-01e", label: "D-01 Closed / face check-in off", model: closedScreen("face_off", ctx.event) },
  { id: "D-02a", label: "D-02 Session expired", model: sessionScreen("expired") },
  { id: "D-02b", label: "D-02 Door access removed", model: sessionScreen("revoked") },
  { id: "D-03a", label: "D-03 Test mode / idle", model: idleScreen(door), test: true },
  { id: "D-03b", label: "D-03 Test mode / would welcome", model: asTest(outcomeScreen(O.welcomed_test, door)), test: true },
  { id: "D-03c", label: "D-03 Test mode / not on list", model: asTest(outcomeScreen({ ...O.not_on_list, test: true }, door)), test: true },
  // v5: the live multi-face door. No oval and no full-screen result: tags follow the faces, arrivals collect on the right.
  { id: "L-01", label: "L-01 Live door / four faces", model: LIVE, badge: "Staffed entry", live: { faces: LIVE_FACES, arrivals: LIVE_ARRIVALS } },
  { id: "L-02", label: "L-02 Live door / offline", model: LIVE, live: { faces: LIVE_FACES.slice(1, 2).map((f) => ({ ...f, view: tagView({ state: "offline" }) })), arrivals: LIVE_ARRIVALS, banner: "Offline · reconnecting in 5s" } },
  { id: "L-03", label: "L-03 Live door / idle", model: LIVE, live: { faces: [], arrivals: [], idle: true } },
];

function overlayFor(kind: KioskFrameSpec["overlay"]): ReactNode {
  if (!kind) return undefined;
  const offline =
    kind === "offline"
      ? { status: "Offline", detail: "Reconnecting in 12s · last online 19:51", qr: <QrCode value={ctx.event.logUrl} size={168} label="QR code: the event's check-in log in the admin" /> }
      : undefined;
  return <OperatorOverlay context={ctx} cameras={FIXTURE_CAMERAS} cameraId={FIXTURE_CAMERAS[0]!.value} mirror offline={offline} />;
}

function liveLayer(live: LiveFixture, orientation: KioskOrientation): ReactNode {
  const store = new LiveStore();
  store.set({ width: 1280, height: 720 }, live.faces, live.idle ? 10_000 : 0);
  const { w, h } = KIOSK_SIZES[orientation];
  return <LiveOverlay store={store} width={w} height={h} mirror={false} banner={live.banner} arrivals={live.arrivals} announcement="" timeOf={(at) => formatClock(at, FIXTURE_TIME_ZONE)} />;
}

function frameFor(spec: KioskFrameSpec, orientation: KioskOrientation): FrameDef {
  const portrait = orientation === "portrait";
  const { w, h } = KIOSK_SIZES[orientation];
  const label = portrait ? `${spec.label} · portrait` : spec.label;
  return {
    code: portrait ? `${spec.id}-portrait` : spec.id,
    name: label.slice(label.indexOf(" ") + 1),
    app: "events",
    viewport: { w, h },
    background: "var(--canvas)",
    render: () => (
      <div style={{ position: "relative" }}>
      {spec.test ? <TestModeBanner /> : null}
      <KioskView
        model={spec.model}
        orientation={orientation}
        camera="placeholder"
        event={ctx.event.name}
        clock={formatClock(NOW, FIXTURE_TIME_ZONE)}
        badge={spec.badge}
        overlay={overlayFor(spec.overlay)}
        live={spec.live ? liveLayer(spec.live, orientation) : undefined}
        framed
        label={label}
      />
      </div>
    ),
  };
}

/** Landscape first, then portrait: the pixel gate names a code's first capture `<CODE>.png`, like the design order. */
export const kioskFrames: FrameDef[] = [
  ...KIOSK_FRAME_SPECS.map((s) => frameFor(s, "landscape")),
  ...KIOSK_FRAME_SPECS.map((s) => frameFor(s, "portrait")),
];
