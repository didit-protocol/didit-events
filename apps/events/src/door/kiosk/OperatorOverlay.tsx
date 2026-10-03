import type { ReactNode, Ref } from "react";
import {
  OperatorActions,
  OperatorArrived,
  OperatorCamera,
  OperatorOffline,
  OperatorPanel,
  OperatorScans,
  OperatorSegmented,
  type OperatorChoice,
} from "@didit-events/ui/kiosk";
import { SCAN_RESULT_PILL, formatClock } from "./format";
import { STRICTNESS, type KioskContext } from "./types";

export const OPERATOR_PANEL_ID = "operator-panel";

export interface OperatorOverlayProps {
  context: KioskContext;
  cameras: OperatorChoice[];
  cameraId: string;
  mirror: boolean;
  /** K-21: set while the door is offline; the panel swaps its live sections for the manual check-in fallback. */
  offline?: { status: string; detail: string; qr: ReactNode };
  fullscreen?: boolean;
  testMode?: boolean;
  /** Test mode: distinct people welcomed in this test session, added to Arrived (labelled as a test count). */
  testArrived?: number;
  busy?: boolean;
  onCamera?: (deviceId: string) => void;
  onMirror?: (mirror: boolean) => void;
  onTestMode?: () => void;
  onRetry?: () => void;
  onFullscreen?: () => void;
  /** Ends door mode: sign in again (any team member with door access), or the staff-set PIN when there is one. */
  onSignInExit?: () => void;
  onPinExit?: () => void;
  panelRef?: Ref<HTMLDivElement>;
  /** Dev builds: detector fps and recognition latency (p50/p95). */
  stats?: string;
}

/** K-13 operator overlay (K-21 when offline). Server-safe; the door passes handlers, the gallery doesn't. */
export function OperatorOverlay({ context, cameras, cameraId, mirror, offline, fullscreen = true, testMode = false, testArrived = 0, busy, onCamera, onMirror, onTestMode, onRetry, onFullscreen, onSignInExit, onPinExit, panelRef, stats }: OperatorOverlayProps) {
  const fullscreenAction = { label: fullscreen ? "Exit full screen" : "Enter full screen", onClick: onFullscreen };
  const exit = context.pinSet
    ? <OperatorActions primary={{ label: "Exit with PIN", onClick: onPinExit, disabled: busy }} secondary={{ label: "Sign in to exit", onClick: onSignInExit }} />
    : <OperatorActions primary={{ label: "Sign in to exit", onClick: onSignInExit, disabled: busy }} secondary={{ label: "Retry now", onClick: onRetry }} />;
  if (offline) {
    return (
      <OperatorPanel kioskName={context.station.name} panelRef={panelRef} id={OPERATOR_PANEL_ID}>
        <OperatorOffline status={offline.status} detail={offline.detail} logUrl={context.event.logUrl} qr={offline.qr} />
        <OperatorActions primary={{ label: "Retry now", onClick: onRetry, disabled: busy }} secondary={fullscreenAction} />
        {exit}
      </OperatorPanel>
    );
  }
  const scans = context.recentScans.slice(0, 5).map((s) => ({
    id: s.id,
    time: formatClock(s.at, context.event.timeZone),
    name: s.name ?? "—",
    result: s.test ? `Test · ${SCAN_RESULT_PILL[s.result].label}` : SCAN_RESULT_PILL[s.result].label,
    tone: s.test ? ("neutral" as const) : SCAN_RESULT_PILL[s.result].tone,
  }));
  const testAvailable = context.state !== "face_off";
  return (
    <OperatorPanel kioskName={context.station.name} panelRef={panelRef} id={OPERATOR_PANEL_ID}>
      <OperatorArrived arrived={context.arrived + (testMode ? testArrived : 0)} capacity={context.event.capacity} test={testMode} />
      <OperatorScans scans={scans} />
      <OperatorSegmented
        key={context.threshold}
        title="MATCH STRICTNESS"
        name="operator-strictness"
        options={STRICTNESS.some(o => o.value === context.threshold) ? STRICTNESS.map((o) => ({ value: String(o.value), label: o.label })) : [{ value: String(context.threshold), label: String(context.threshold) }]}
        value={String(context.threshold)}
        onChange={undefined}
        disabled
      />
      <OperatorCamera devices={cameras} value={cameraId} onSelect={onCamera} mirror={mirror} onMirror={onMirror} />
      {stats ? <p data-door-stats="" style={{ margin: 0, font: "400 14px/1.4 var(--font-mono, ui-monospace)", opacity: 0.7 }}>{stats}</p> : null}
      <OperatorActions
        primary={{ label: testMode ? "Stop Test mode" : "Start Test mode", onClick: onTestMode, disabled: busy || !testAvailable }}
        secondary={fullscreenAction}
      />
      {exit}
    </OperatorPanel>
  );
}
