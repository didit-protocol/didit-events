import type { CSSProperties, ReactNode } from "react";
import { cx } from "../cx";
import { Logo } from "../Logo";
import styles from "./Kiosk.module.css";

/* Didit Access kiosk surfaces (design/03 Kiosk.dc.html). Server-safe: no hooks, no handlers of their own. */

export type KioskOrientation = "landscape" | "portrait";

/** The design stage per orientation; the live kiosk scales it to the screen. */
export const KIOSK_SIZES: Record<KioskOrientation, { w: number; h: number }> = {
  landscape: { w: 1920, h: 1080 },
  portrait: { w: 1080, h: 1920 },
};

/** Camera layer opacity: `live` .8 (scanning), `hero` .45 (K-06 welcome), `dim` .35 (K-11 paused, K-12 offline). */
export type KioskCameraTone = "live" | "hero" | "dim";

export interface KioskScreenProps {
  orientation: KioskOrientation;
  /** Stage size in CSS px; defaults to the orientation's design size. */
  width?: number;
  height?: number;
  /** `none` = black (no camera yet), `placeholder` = the design's stand-in scene (frames), or the live <video>. */
  camera: "none" | "placeholder" | ReactNode;
  /** Keep a live camera mounted but show the black canvas (K-02: the video element must survive a retry). */
  cameraHidden?: boolean;
  cameraTone?: KioskCameraTone;
  /** K-03e: the camera frame is too dark. */
  cameraDark?: boolean;
  /** Mirror the live video (operator setting). */
  mirror?: boolean;
  /** K-06 colour bloom behind the welcome. */
  bloom?: boolean;
  /** Event name, top right; omitted (with the clock) before the kiosk knows its event. */
  event?: string;
  clock?: string;
  /** K-14: door-mode chip next to the event name. */
  badge?: string;
  /** "42 / 120 arrived" (K-01). */
  counter?: string;
  /** The operator panel (K-13, K-21). */
  overlay?: ReactNode;
  /** Design canvas treatment (radius + shadow) for the frame gallery. */
  framed?: boolean;
  /** `data-screen-label` for the pixel gate. */
  label?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function KioskScreen({
  orientation,
  width,
  height,
  camera,
  cameraHidden,
  cameraTone = "live",
  cameraDark,
  mirror,
  bloom,
  event,
  clock,
  badge,
  counter,
  overlay,
  framed,
  label,
  className,
  style,
  children,
}: KioskScreenProps) {
  const size = KIOSK_SIZES[orientation];
  const w = width ?? size.w;
  const h = height ?? size.h;
  const cameraClass =
    camera === "none" || cameraHidden ? styles.cameraNone : camera === "placeholder" ? styles.cameraPlaceholder : undefined;
  return (
    <div
      data-screen-label={label}
      data-orientation={orientation}
      className={cx(styles.screen, framed && styles.framed, className)}
      style={{ width: w, height: h, ["--kiosk-w" as string]: `${w}px`, ...style }}
    >
      <div
        className={cx(styles.camera, cameraClass, cameraHidden && styles.cameraHidden, cameraDark && styles.cameraDark, mirror && styles.mirror)}
        data-tone={cameraTone === "live" ? undefined : cameraTone}
        aria-hidden="true"
      >
        {camera !== "none" && camera !== "placeholder" ? camera : null}
      </div>
      <div className={styles.vignette} aria-hidden="true" />
      {bloom ? <div className={styles.bloom} aria-hidden="true" /> : null}
      <header className={styles.top}>
        <Logo variant="white" height={40} className={styles.logo} priority />
        {event ? (
          <div className={styles.meta}>
            {badge ? (
              <span className={styles.badge}>
                <span className={styles.badgeDot} aria-hidden="true" />
                {badge}
              </span>
            ) : null}
            <span>{event}</span>
            {clock ? (
              <>
                <span className={styles.metaRule} aria-hidden="true" />
                <span className={styles.clock}>{clock}</span>
              </>
            ) : null}
          </div>
        ) : null}
      </header>
      <footer className={styles.privacy}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" />
        </svg>
        Face check-in by Didit. Each scan is logged by Didit for this event.
      </footer>
      {counter ? <div className={styles.counter}>{counter}</div> : null}
      {children}
      {overlay}
    </div>
  );
}

/* ── Oval stage ─────────────────────────────────────────────── */

export type KioskOvalTone = "idle" | "face" | "blue";

export interface KioskOvalStageProps {
  head?: string;
  /** Brand-light words after `head` ("Welcome to <accent>"). */
  accent?: string;
  /** `idle` dashed (no face), `face` solid white, `blue` holding / verifying. */
  tone: KioskOvalTone;
  /** K-01 attract loop. */
  breathing?: boolean;
  /** Drawn inside the oval, under its outline (the frames' face stand-in). */
  inside?: ReactNode;
  /** K-05 scan line. */
  scan?: boolean;
  /** K-04 hold progress, 0–1. */
  ring?: number;
  hint?: string;
  sub?: string;
}

export function KioskOvalStage({ head, accent, tone, breathing, inside, scan, ring, hint, sub }: KioskOvalStageProps) {
  return (
    <div className={styles.stage} role="status" aria-live="polite">
      {head ? (
        <h1 className={styles.stageHead}>
          {head}
          {accent ? (
            <>
              {" "}
              <span className={styles.accent}>{accent}</span>
            </>
          ) : null}
        </h1>
      ) : null}
      <div className={styles.ovalWrap} aria-hidden="true">
        {inside}
        {scan ? <div className={styles.scan} /> : null}
        <div className={cx(styles.oval, breathing && styles.breathing)} data-tone={tone === "idle" ? undefined : tone} />
        {ring !== undefined ? <KioskRing progress={ring} /> : null}
      </div>
      {hint ? (
        <div key={hint} className={styles.hint}>
          {hint}
        </div>
      ) : null}
      {sub ? <div className={styles.stageSub}>{sub}</div> : null}
    </div>
  );
}

function KioskRing({ progress }: { progress: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <svg className={styles.ring} viewBox="0 0 100 100" preserveAspectRatio="none">
      <ellipse cx="50" cy="50" rx="48" ry="48" fill="none" className={styles.ringTrack} vectorEffect="non-scaling-stroke" />
      <ellipse
        cx="50"
        cy="50"
        rx="48"
        ry="48"
        fill="none"
        className={styles.ringFill}
        pathLength={100}
        strokeDasharray={`${pct} 100`}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Where a stand-in face sits in the frames (design `face`): K-03a far, K-03b near, K-03c off-centre, K-03e dim. */
export type KioskFacePose = "on" | "far" | "near" | "off" | "dim";

export interface KioskFacePlaceholderProps {
  orientation: KioskOrientation;
  pose: KioskFacePose;
  /** K-05: the frame is frozen (warmer, brighter). */
  frozen?: boolean;
  /** K-03f: a second person beside the first. */
  second?: boolean;
}

/** The design's stand-in face (gallery frames only; the live kiosk shows the camera). */
export function KioskFacePlaceholder({ orientation, pose, frozen, second }: KioskFacePlaceholderProps) {
  const portrait = orientation === "portrait";
  const ow = portrait ? 520 : 400;
  const oh = portrait ? 680 : 520;
  const off = pose === "off" ? (portrait ? 140 : 220) : 0;
  const scale = pose === "far" ? 0.6 : pose === "near" ? 1.35 : 1;
  const style: CSSProperties = {
    width: ow * 0.78 * scale,
    height: oh * 0.82 * scale,
    transform: `translate(calc(-50% + ${off}px), -50%)`,
    background: frozen
      ? "radial-gradient(ellipse at 50% 40%, rgba(205,180,160,.9), rgba(130,105,90,.7) 60%, transparent 72%)"
      : "radial-gradient(ellipse at 50% 40%, rgba(190,165,145,.75), rgba(120,98,85,.55) 60%, transparent 72%)",
    filter: pose === "dim" ? "brightness(.4)" : undefined,
    boxShadow: second ? `${portrait ? 360 : 520}px 0 0 -20px rgba(160,140,125,.5)` : undefined,
  };
  return <div className={styles.face} style={style} />;
}

/* ── Message screens ────────────────────────────────────────── */

export type KioskIconTone = "ok" | "warn" | "neutral" | "feature";

export interface KioskMessageProps {
  icon?: string;
  iconTone?: KioskIconTone;
  /** Accessible name of the icon glyph ("✓", "!", "?"…); defaults to hidden. */
  iconLabel?: string;
  head: string;
  sub?: string;
  /** Code slots, an error line… rendered between the sub and the chip. */
  children?: ReactNode;
  /** Staff-only detail, shown in a chip tagged STAFF. */
  chip?: string;
}

export function KioskMessage({ icon, iconTone = "neutral", iconLabel, head, sub, children, chip }: KioskMessageProps) {
  return (
    <div className={styles.message} role="status" aria-live="polite">
      {icon ? (
        <div className={styles.icon} data-tone={iconTone === "neutral" ? undefined : iconTone}>
          <span className={styles.iconGlyph} aria-hidden={iconLabel ? undefined : true} aria-label={iconLabel} role={iconLabel ? "img" : undefined}>
            {icon}
          </span>
        </div>
      ) : null}
      <h1 className={styles.messageHead}>{head}</h1>
      {sub ? <p className={styles.messageSub}>{sub}</p> : null}
      {children}
      {chip ? <KioskStaffChip>{chip}</KioskStaffChip> : null}
    </div>
  );
}

export function KioskStaffChip({ children }: { children: ReactNode }) {
  return (
    <div className={styles.chip}>
      <span className={styles.chipTag}>STAFF</span>
      {children}
    </div>
  );
}

export function KioskError({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <div className={styles.error} id={id} role="alert">
      {children}
    </div>
  );
}

/** K-00: "or scan the QR from the admin with this device's camera". */
export function KioskQrLine({ children }: { children: ReactNode }) {
  return (
    <div className={styles.qrLine}>
      <span className={styles.qrRule} aria-hidden="true" />
      {children}
      <span className={styles.qrRule} aria-hidden="true" />
    </div>
  );
}

export interface KioskCodeSlotsProps {
  /** One entry per slot; "" = empty. */
  values: string[];
  /** Slot with the brand focus ring (the next one to type). */
  active?: number;
  error?: boolean;
  disabled?: boolean;
  /** The real text input (the pairing page); laid invisibly over the slots. */
  input?: ReactNode;
}

export function KioskCodeSlots({ values, active, error, disabled, input }: KioskCodeSlotsProps) {
  return (
    <div className={styles.slots} data-error={error ? "" : undefined} data-disabled={disabled ? "" : undefined}>
      {values.map((v, i) => (
        <div key={i} className={styles.slot} data-active={!error && !disabled && i === active ? "" : undefined} aria-hidden="true">
          {v}
        </div>
      ))}
      {input}
    </div>
  );
}

/** Class for the invisible input laid over `KioskCodeSlots`. */
export const kioskSlotsInputClass = styles.slotsInput;

/* ── Welcome ────────────────────────────────────────────────── */

export interface KioskWelcomeProps {
  /** K-06: bloom, green check, bigger name. K-07 is the calm variant. */
  hero?: boolean;
  greeting: string;
  name: string;
  sub: string;
  time: string;
}

export function KioskWelcome({ hero, greeting, name, sub, time }: KioskWelcomeProps) {
  const h = hero ? "" : undefined;
  return (
    <div className={styles.welcome} role="status" aria-live="polite">
      <div className={styles.check} data-hero={h} aria-hidden="true">
        <svg width="56%" height="56%" viewBox="0 0 24 24" fill="none" stroke="#0D0D0D" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <div className={styles.names}>
        <div className={styles.greeting} data-hero={h}>
          {greeting}
        </div>
        <h1 className={styles.name} data-hero={h}>
          {name}
        </h1>
      </div>
      <div className={styles.welcomeMeta}>
        <span>{sub}</span>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.time}>{time}</span>
      </div>
    </div>
  );
}
