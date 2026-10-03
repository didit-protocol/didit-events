import { useId, type CSSProperties } from "react";
import { cx } from "../cx";
import styles from "./MarkLoader.module.css";

export interface MarkLoaderProps {
  /** Height in px; the width follows the mark's 22:28 proportion. */
  size?: number;
  /** Announces the wait (role="status"). Without it the loader is decorative: the text next to it says what is happening. */
  label?: string;
  className?: string;
}

/**
 * The Didit isotype as a loader: the mark's ring drawn faint, with a bright stretch of it travelling round. An inline
 * SVG of the mark in its gradient (assets/didit-mark.png is 94 KB). Its box is fixed by `size`, so nothing moves when
 * it appears. Reduced motion: the whole ring, pulsing in opacity. Inside buttons use Spinner (the same ring in the
 * text colour).
 */
export function MarkLoader({ size = 24, label, className }: MarkLoaderProps) {
  const gradient = useId();
  // The mark's own weight: a 2.6 ring on the 22 × 28 box (Spinner's is heavier so it reads at 12–16px).
  const ring = { x: 1.3, y: 1.3, width: 19.4, height: 25.4, rx: 9.7, stroke: `url(#${gradient})`, strokeWidth: 2.6 };
  return (
    <span
      className={cx(styles.loader, className)}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-mark-loader="brand"
      style={{ width: (size * 22) / 28, height: size, "--mark-len": "72.95px" } as CSSProperties}
    >
      <svg viewBox="0 0 22 28" fill="none" aria-hidden="true" focusable="false">
        <linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1="0" y1="20" x2="22" y2="10">
          <stop stopColor="#A6EDFF" />
          <stop offset="0.12" stopColor="#7FD9FF" />
          <stop offset="0.38" stopColor="#0B7CEB" />
          <stop offset="0.7" stopColor="#2B5BDA" />
          <stop offset="1" stopColor="#5648C9" />
        </linearGradient>
        <rect {...ring} className={styles.track} />
        <rect {...ring} className={styles.run} strokeLinecap="round" />
      </svg>
    </span>
  );
}
