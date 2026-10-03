import type { ReactNode } from "react";
import { cx } from "../cx";
import styles from "./FilterChips.module.css";

export interface FilterChipItem {
  key: string;
  label: ReactNode;
  /** Optional count, drawn in a lighter tone after the label (A-05 "Checked in 42"). */
  count?: number;
  href: string;
  current?: boolean;
}

export interface FilterChipsProps {
  items: FilterChipItem[];
  /** Accessible name of the filter group ("Filter events by status"). */
  label: string;
  className?: string;
}

/**
 * Filter chips as links (A-02 status filter, A-05 guest filter): 32px pills, the current one black. They change a
 * search param, so they work without client JS; the current chip carries aria-current.
 */
export function FilterChips({ items, label, className }: FilterChipsProps) {
  return (
    <nav aria-label={label} className={cx(styles.chips, className)}>
      {items.map((it) => (
        <a key={it.key} href={it.href} className={styles.chip} aria-current={it.current ? "true" : undefined}>
          {it.label}
          {it.count !== undefined ? <span className={styles.count}>{it.count}</span> : null}
        </a>
      ))}
    </nav>
  );
}
