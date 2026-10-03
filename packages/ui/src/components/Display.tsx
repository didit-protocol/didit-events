import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { cx } from "../cx";
import { Icon, type IconName } from "./Icon";
import styles from "./Display.module.css";

/* ── Avatar ──────────────────────────────────────────────────── */
export type AvatarTone = "neutral" | "brand" | "dark";

export function initials(name: string): string {
  const local = name.includes("@") ? (name.split("@")[0] ?? "") : name;
  const parts = local.trim().split(/[\s._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : (parts[0]?.[1] ?? "");
  return (first + second).toUpperCase();
}

/**
 * The one-letter fallback shown when there is no photo: the first letter of the first name, else of the email.
 * Returns "" only when both are empty.
 */
export function avatarInitial(name?: string | null, email?: string | null): string {
  const fromName = (name ?? "").trim().replace(/^[^\p{L}\p{N}]+/u, "");
  const fromEmail = (email ?? "").trim().replace(/^[^\p{L}\p{N}]+/u, "");
  const source = fromName && !fromName.includes("@") ? fromName : fromEmail || fromName;
  const first = Array.from(source)[0] ?? "";
  return first.toLocaleUpperCase();
}

export interface AvatarProps {
  /** Full name; may be empty for a new account (then the email's first letter is used). */
  name: string;
  /** Fallback for the initial and the accessible name when `name` is empty. */
  email?: string;
  /** Explicit initials; defaults to one letter from the name, else the email. Blank values are ignored. */
  initials?: string;
  src?: string;
  size?: 24 | 28 | 32 | 40 | 48 | 56 | 64 | 72 | 80 | 96;
  tone?: AvatarTone;
  className?: string;
}

export function Avatar({ name, email, initials: explicit, src, size = 32, tone = "neutral", className }: AvatarProps) {
  const toneCls = tone === "brand" ? styles.avBrand : tone === "dark" ? styles.avDark : styles.avNeutral;
  const label = name.trim() || email?.trim() || "Account";
  const letter = explicit?.trim() || avatarInitial(name, email);
  return (
    <span
      role="img"
      aria-label={label}
      className={cx(styles.avatar, toneCls, className)}
      style={{ width: size, height: size, fontSize: size <= 24 ? 10 : size >= 40 ? Math.round(size * 0.36) : 13 }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" />
      ) : (
        <span aria-hidden="true">{letter}</span>
      )}
    </span>
  );
}

/* ── Stat tile ───────────────────────────────────────────────── */
export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  deltaTone?: "positive" | "negative" | "warning" | "neutral";
  className?: string;
}

export function StatTile({ label, value, delta, deltaTone = "positive", className }: StatTileProps) {
  const toneCls =
    deltaTone === "positive" ? styles.deltaPositive : deltaTone === "negative" ? styles.deltaNegative : deltaTone === "warning" ? styles.deltaWarning : undefined;
  return (
    <div className={cx(styles.stat, className)}>
      <span className={styles.eyebrow}>{label}</span>
      <span className={styles.metric}>{value}</span>
      {delta ? <span className={cx(styles.delta, toneCls)}>{delta}</span> : null}
    </div>
  );
}

/* ── Progress bar ────────────────────────────────────────────── */
export interface ProgressBarProps {
  value: number;
  max?: number;
  label: string;
  valueText?: string;
  className?: string;
}

export function ProgressBar({ value, max = 100, label, valueText, className }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      className={cx(styles.progress, className)}
    >
      <div className={styles.progressFill} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ── Banner ──────────────────────────────────────────────────── */
/** `neutral` = the soft grey notice of 05 AP-12 / AP-25 (#F4F4F6, black text). */
export type BannerTone = "info" | "success" | "warning" | "danger" | "neutral";

export interface BannerProps {
  tone?: BannerTone;
  icon?: IconName;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Inline notice. Danger banners are announced assertively (role="alert"), others politely. */
export function Banner({ tone = "info", icon, action, children, className }: BannerProps) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx(styles.banner, styles[tone], className)}>
      {icon ? <Icon name={icon} /> : null}
      <div className={styles.bannerBody}>{children}</div>
      {action}
    </div>
  );
}

/* ── Tooltip ─────────────────────────────────────────────────── */
export interface TooltipProps {
  content: ReactNode;
  /** A single focusable element; it gets aria-describedby. */
  children: ReactElement<{ "aria-describedby"?: string }>;
  placement?: "top" | "bottom";
  /** Renders the bubble on its own, always visible (frame gallery / docs). */
  static?: boolean;
}

/** CSS-only tooltip: shows on hover and keyboard focus; the trigger is described by it. */
export function Tooltip({ content, children, placement = "top", static: isStatic }: TooltipProps) {
  const id = useId();
  if (isStatic) {
    return (
      <span role="tooltip" id={id} className={cx(styles.tip, styles.tipStatic)}>
        {content}
      </span>
    );
  }
  const trigger = isValidElement(children) ? cloneElement(children, { "aria-describedby": id }) : children;
  return (
    <span className={styles.tipWrap}>
      {trigger}
      <span role="tooltip" id={id} className={cx(styles.tip, placement === "bottom" && styles.tipBottom)}>
        {content}
      </span>
    </span>
  );
}

/* ── Empty state ─────────────────────────────────────────────── */
export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

const CALENDAR_40 = (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="6" y="9" width="28" height="24" rx="4" />
    <path d="M6 16h28M13 5v7M27 5v7" />
  </svg>
);

export function EmptyState({ title, description, icon = CALENDAR_40, action, className }: EmptyStateProps) {
  return (
    <div className={cx(styles.empty, className)}>
      <span className={styles.emptyIcon}>{icon}</span>
      <h3 className={styles.emptyTitle}>{title}</h3>
      {description ? <p className={styles.emptyBody}>{description}</p> : null}
      {action ? <div className={styles.emptyAction}>{action}</div> : null}
    </div>
  );
}

/* ── Skeleton ────────────────────────────────────────────────── */
export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  shape?: "line" | "pill";
  /** The highlight sweeping across (default on; still under reduced motion). */
  shimmer?: boolean;
  className?: string;
}

export function Skeleton({ width = "100%", height = 10, shape = "line", shimmer = true, className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(styles.skeleton, shape === "pill" && styles.skPill, shimmer && styles.shimmer, className)}
      style={{ width, height }}
    />
  );
}
