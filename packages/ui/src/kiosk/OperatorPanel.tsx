import type { ReactNode, Ref } from "react";
import styles from "./Kiosk.module.css";

/*
 * K-13 operator overlay (and its K-21 offline variant). Presentational: the kiosk passes values and handlers; without
 * handlers (the frame gallery) the controls render uncontrolled at their fixture values.
 */

export interface OperatorPanelProps {
  /** "Main door" → "OPERATOR · MAIN DOOR". */
  kioskName: string;
  children: ReactNode;
  panelRef?: Ref<HTMLDivElement>;
  id?: string;
}

export function OperatorPanel({ kioskName, children, panelRef, id }: OperatorPanelProps) {
  return (
    <div ref={panelRef} id={id} className={styles.panel} role="dialog" aria-modal="false" aria-labelledby={id ? `${id}-title` : undefined} tabIndex={-1}>
      <div className={styles.panelHead}>
        <span className={styles.eyebrow} id={id ? `${id}-title` : undefined}>
          OPERATOR · {kioskName.toUpperCase()}
        </span>
        <span className={styles.panelHint}>Esc to close</span>
      </div>
      {children}
    </div>
  );
}

export function OperatorArrived({ arrived, capacity, test = false }: { arrived: number; capacity: number; test?: boolean }) {
  return (
    <div className={styles.block}>
      <span className={styles.eyebrow}>{test ? "ARRIVED · INCLUDING TEST" : "ARRIVED"}</span>
      <span className={styles.arrived}>
        {arrived} <span className={styles.arrivedTotal}>/ {capacity}</span>
      </span>
    </div>
  );
}

export type OperatorScanTone = "ok" | "neutral" | "warn";

export interface OperatorScan {
  id: string;
  time: string;
  name: string;
  result: string;
  tone: OperatorScanTone;
}

export function OperatorScans({ scans, title = "LAST 5 SCANS" }: { scans: OperatorScan[]; title?: string }) {
  return (
    <div className={styles.block} style={{ gap: 2 }}>
      <span className={`${styles.eyebrow} ${styles.scansTitle}`}>{title}</span>
      {scans.length === 0 ? <div className={styles.scanEmpty}>No scans yet</div> : null}
      <ol className={styles.scans} style={{ display: "contents" }} role="list">
        {scans.map((s) => (
          <li key={s.id} className={styles.scanRow}>
            <span className={styles.scanTime}>{s.time}</span>
            <span>{s.name}</span>
            <span className={styles.pill} data-tone={s.tone === "warn" ? undefined : s.tone}>
              {s.result}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export interface OperatorChoice {
  value: string;
  label: string;
}

export interface OperatorSegmentedProps {
  title: string;
  name: string;
  options: OperatorChoice[];
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}

/** Native radios (arrow keys work with no JS), styled as the K-13 segmented control. */
export function OperatorSegmented({ title, name, options, value, onChange, disabled }: OperatorSegmentedProps) {
  return (
    <fieldset className={styles.group} disabled={disabled}>
      <legend className={styles.eyebrow} style={{ padding: 0, float: "left" }}>
        {title}
      </legend>
      <div className={styles.seg}>
        {options.map((o) => (
          <label key={o.value} className={styles.segItem}>
            <input
              type="radio"
              name={name}
              value={o.value}
              {...(onChange ? { checked: o.value === value, onChange: () => onChange(o.value) } : { defaultChecked: o.value === value })}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export interface OperatorCameraProps {
  devices: OperatorChoice[];
  value: string;
  onSelect?: (value: string) => void;
  mirror: boolean;
  onMirror?: (mirror: boolean) => void;
}

export function OperatorCamera({ devices, value, onSelect, mirror, onMirror }: OperatorCameraProps) {
  const current = devices.find((d) => d.value === value) ?? devices[0];
  return (
    <div className={styles.group}>
      <span className={styles.eyebrow} id="operator-camera-title">
        CAMERA
      </span>
      <div className={styles.select}>
        {current?.label ?? "No camera"}
        <span className={styles.selectCaret} aria-hidden="true">
          ▾
        </span>
        <select
          aria-labelledby="operator-camera-title"
          {...(onSelect ? { value, onChange: (e) => onSelect(e.target.value) } : { defaultValue: value })}
          disabled={devices.length === 0}
        >
          {devices.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      <label className={styles.switchRow}>
        Mirror preview
        <span className={styles.switch}>
          <input
            type="checkbox"
            role="switch"
            {...(onMirror ? { checked: mirror, onChange: (e) => onMirror(e.target.checked) } : { defaultChecked: mirror })}
          />
          <span className={styles.switchKnob} />
        </span>
      </label>
    </div>
  );
}

export interface OperatorAction {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}

export function OperatorActions({ primary, secondary }: { primary: OperatorAction; secondary: OperatorAction }) {
  return (
    <div className={styles.actions}>
      {[primary, secondary].map((a, i) => (
        <button
          key={a.label}
          type="button"
          className={styles.action}
          data-variant={i === 0 ? "primary" : undefined}
          onClick={a.onClick}
          disabled={a.disabled}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

export interface OperatorOfflineProps {
  /** "Offline", "Didit unavailable"… */
  status: string;
  /** "Reconnecting in 12s · last online 19:51". */
  detail: string;
  /** Link to the event's check-in log in the admin, shown under the QR. */
  logUrl: string;
  /** The QR of `logUrl` (a server-rendered `<QrCode>`, so the QR encoder stays out of the kiosk's client JS). */
  qr: ReactNode;
}

/** K-21: the kiosk is offline, so staff check guests in by hand from the admin. */
export function OperatorOffline({ status, detail, logUrl, qr }: OperatorOfflineProps) {
  return (
    <>
      <div className={styles.block}>
        <span className={styles.eyebrow}>CONNECTION</span>
        <span className={styles.status}>{status}</span>
        <span className={styles.statusSub} aria-live="polite">
          {detail}
        </span>
      </div>
      <div className={styles.group}>
        <span className={styles.eyebrow}>MANUAL CHECK-IN</span>
        <span className={styles.manual}>Manual check-in in the admin</span>
        <div className={styles.qrCard}>
          <div className={styles.qrTile}>
            {qr}
          </div>
          <div className={styles.qrText}>
            Scan with a staff phone to open the check-in log.
            <span className={styles.qrUrl}>{logUrl.replace(/^https?:\/\//, "")}</span>
          </div>
        </div>
      </div>
    </>
  );
}
