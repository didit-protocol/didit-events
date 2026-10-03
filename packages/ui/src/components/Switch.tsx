import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";
import styles from "./Switch.module.css";

export type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className" | "size"> & {
  /** Visible label; clicking it toggles the switch. Without one, pass `aria-label`. */
  label?: ReactNode;
  /** Secondary line under the label. */
  hint?: ReactNode;
  /** Label on the left, switch on the right (settings rows). */
  labelPosition?: "start" | "end";
  className?: string;
};

/**
 * Admin switch: a native checkbox with role="switch", a 36×20 track with a clear off state (solid grey, bordered
 * thumb), on = brand, a visible focus ring, and the whole label as the hit area.
 */
export function Switch({ label, hint, labelPosition = "end", className, id, ...rest }: SwitchProps) {
  const control = (
    <span className={styles.switch}>
      <input type="checkbox" role="switch" id={id} {...rest} />
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
    </span>
  );
  if (!label) return <span className={cx(styles.bare, className)}>{control}</span>;
  return (
    <label className={cx(styles.row, labelPosition === "start" && styles.start, className)} htmlFor={id}>
      {control}
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {hint ? <span className={styles.hint}>{hint}</span> : null}
      </span>
    </label>
  );
}
