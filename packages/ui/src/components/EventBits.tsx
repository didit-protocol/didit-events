import type { ReactNode } from "react";
import { cx } from "../cx";
import { Icon, type IconName } from "./Icon";
import styles from "./EventBits.module.css";

/* Guest-page primitives from design/04 AI Era Event (P-01, P-02, P-03) and 02 Guest (G-01…G-03). */

/* ── Date badge: the calendar-page tile (OCT / 8) ────────────── */
export interface DateBadgeProps {
  /** Short month, rendered uppercase ("Oct"). */
  month: string;
  day: string | number;
  /** lg = 44px desktop tile, md = 40px mobile tile. */
  size?: "md" | "lg";
  className?: string;
}

export function DateBadge({ month, day, size = "lg", className }: DateBadgeProps) {
  return (
    <span className={cx(styles.date, size === "md" && styles.dateMd, className)} aria-hidden="true">
      <span className={styles.dateMonth}>{month}</span>
      <span className={styles.dateDay}>{day}</span>
    </span>
  );
}

/* ── Icon tile: bordered (44/40) or soft-filled (36) square behind a 24-grid icon ── */
export interface IconTileProps {
  /** A named icon, or a custom 24×24 path (the design's user-check / face-scan / pin shapes). */
  icon: IconName;
  variant?: "outline" | "soft";
  size?: "md" | "lg";
  className?: string;
}

export function IconTile({ icon, variant = "outline", size = "lg", className }: IconTileProps) {
  const px = variant === "soft" ? 18 : size === "lg" ? 20 : 18;
  return (
    <span className={cx(styles.tile, variant === "soft" ? styles.tileSoft : size === "md" ? styles.tileMd : styles.tileLg, className)} aria-hidden="true">
      <Icon name={icon} size={px} />
    </span>
  );
}

/* ── Tone icon: the round status glyph at the top of cards and message screens ── */
export type ToneIconTone = "success" | "success-soft" | "warning" | "danger" | "feature" | "brand" | "neutral";

export interface ToneIconProps {
  tone: ToneIconTone;
  /** A text glyph (…, ×, !, ?, —) or "check" for the drawn check mark. */
  glyph: string;
  /** 44 = registration card, 48 = desktop sign-in modal, 56 = guest flow screens, 64 = message screen, 88 = hero success. */
  size?: 44 | 48 | 56 | 64 | 88;
  className?: string;
}

const TONES: Record<ToneIconTone, string | undefined> = {
  success: styles.success,
  "success-soft": styles.successSoft,
  warning: styles.warning,
  danger: styles.danger,
  feature: styles.feature,
  brand: styles.brand,
  neutral: styles.neutral,
};

const SIZES: Record<NonNullable<ToneIconProps["size"]>, string | undefined> = {
  44: styles.tone44,
  48: styles.tone48,
  56: styles.tone56,
  64: styles.tone64,
  88: styles.tone88,
};

export function ToneIcon({ tone, glyph, size = 44, className }: ToneIconProps) {
  return (
    <span className={cx(styles.tone, TONES[tone], SIZES[size], className)} aria-hidden="true">
      {glyph === "check" ? (
        <svg width="50%" height="50%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : (
        <span>{glyph}</span>
      )}
    </span>
  );
}

/* ── Avatar stack: overlapping 28px initials ("84 going") ────── */
export interface AvatarStackProps {
  initials: string[];
  /** Accessible summary, e.g. "84 going". */
  label: string;
  className?: string;
}

const STACK_TONES = [styles.stackSoft, styles.stackBrand, styles.stackSuccess, styles.stackSoft];

export function AvatarStack({ initials, label, className }: AvatarStackProps) {
  return (
    <span role="img" aria-label={label} className={cx(styles.stack, className)}>
      {initials.map((i, k) => (
        <span key={k} aria-hidden="true" className={cx(styles.stackItem, STACK_TONES[k % 4])}>
          {i}
        </span>
      ))}
    </span>
  );
}

/* ── Segmented navigation: links that look like the segmented control (P-03 Upcoming / Past) ── */
export interface SegmentedNavItem {
  label: ReactNode;
  href: string;
  current?: boolean;
}

export function SegmentedNav({ items, label, className }: { items: SegmentedNavItem[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cx(styles.segNav, className)}>
      {items.map((it) => (
        <a key={it.href} href={it.href} aria-current={it.current ? "page" : undefined} className={styles.segItem}>
          {it.label}
        </a>
      ))}
    </nav>
  );
}
