import type { ReactNode } from "react";
import { cx } from "../cx";
import styles from "./Tag.module.css";

/** Tag tones: the kiosk-result colours of 01b Admin A-09 (`RES`) plus the neutral pill tint. */
export type TagTone = "success" | "soft" | "neutral" | "dark" | "warning" | "feature" | "danger" | "brand";

export interface TagProps {
  tone?: TagTone;
  children: ReactNode;
  title?: string;
  className?: string;
}

/**
 * A dot-less status tag (A-09 scan results, A-17 door chips): 22px, 0 8px, 500 10px +.08em uppercase, pill radius.
 * Use StatusPill for the 16 C-00 statuses (those carry a dot); Tag is for result labels.
 */
export function Tag({ tone = "soft", children, title, className }: TagProps) {
  return (
    <span className={cx(styles.tag, styles[tone], className)} data-tone={tone} title={title}>
      {children}
    </span>
  );
}
