import { cx } from "../cx";
import styles from "./StatusIcon.module.css";

/* ── Status icon: the round state mark at the top of guest screens, cards and the join modal ── */
export type StatusTone = "success" | "pending" | "info" | "warning" | "error" | "review" | "neutral";
export type StatusIconName = "check" | "clock" | "info" | "warning" | "x" | "eye" | "mail" | "minus" | "question";

export interface StatusIconProps {
  tone: StatusTone;
  /** Defaults to the tone's mark (success ✓, pending clock, info i, warning !, error ×, review eye, neutral —). */
  icon?: StatusIconName;
  /** 44 = registration card, 48 = desktop sign-in modal, 56 = guest flow screens, 64 = message screen, 88 = hero. */
  size?: 44 | 48 | 56 | 64 | 88;
  /** Success only: the circle scales in and the check draws (off under prefers-reduced-motion). Default on. */
  animate?: boolean;
  className?: string;
}

const DEFAULT_ICON: Record<StatusTone, StatusIconName> = {
  success: "check",
  pending: "clock",
  info: "info",
  warning: "warning",
  error: "x",
  review: "eye",
  neutral: "minus",
};

// One path per mark (circles as arcs, dots as zero-length round-capped strokes): small in every route bundle.
const MARKS: Record<StatusIconName, string> = {
  check: "M5 12.5l4.5 4.5L19 7.5",
  clock: "M3.5 12a8.5 8.5 0 1 0 17 0 8.5 8.5 0 1 0-17 0M12 7.5V12l3 2",
  info: "M12 6.75h.01M12 11v7",
  warning: "M12 5.5v8M12 18h.01",
  x: "M7 7l10 10M17 7 7 17",
  eye: "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zm6.75 0a2.75 2.75 0 1 0 5.5 0 2.75 2.75 0 1 0-5.5 0",
  mail: "M5 5.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM3.5 7l8.5 6 8.5-6",
  minus: "M6.5 12h11",
  question: "M9.25 9.25a2.75 2.75 0 1 1 3.9 2.5c-.75.35-1.15.95-1.15 1.75v.5M12 18h.01",
};

/** Decorative (aria-hidden): the state is always named in the text next to it. */
export function StatusIcon({ tone, icon = DEFAULT_ICON[tone], size = 56, animate = true, className }: StatusIconProps) {
  const drawn = icon === "check" && tone === "success" && animate;
  return (
    <span className={cx(styles.icon, className)} style={{ width: size, height: size }} aria-hidden="true" data-status-icon={tone} data-animate={drawn ? "" : undefined}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={icon === "check" ? 2.4 : 2.2} strokeLinecap="round" strokeLinejoin="round" focusable="false">
        <path d={MARKS[icon]} pathLength={drawn ? 1 : undefined} />
      </svg>
    </span>
  );
}
