"use client";

import { useEffect, useRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "../cx";
import { Icon } from "./Icon";
import styles from "./Field.module.css";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className" | "checked" | "size"> & {
  /** `"mixed"` renders the indeterminate dash and sets aria-checked="mixed". */
  checked?: boolean | "mixed";
  label?: ReactNode;
  /** md = C-00 16px; lg = the 20px consent box of the guest flow (04 R-01, 05 U-14). */
  size?: "md" | "lg";
  /** Error outline (04 R-02: 1.5px danger). Also sets aria-invalid. */
  invalid?: boolean;
  className?: string;
};

/** Checkbox (C-00: unchecked, checked, mixed, disabled). */
export function Checkbox({ checked, label, size = "md", invalid, className, ...rest }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  const mixed = checked === "mixed";
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  const control = (
    <span className={cx(styles.box, size === "lg" && styles.boxLg, invalid && styles.boxInvalid)} data-mixed={mixed ? "" : undefined}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked === undefined ? undefined : checked === true}
        aria-checked={mixed ? "mixed" : undefined}
        aria-invalid={invalid || undefined}
        readOnly={checked !== undefined && !rest.onChange ? true : undefined}
        {...rest}
      />
      <span className={styles.boxFace} aria-hidden="true">
        <Icon name="check" size={size === "lg" ? 13 : 10} strokeWidth={3.5} />
        <span className={styles.dash} />
      </span>
    </span>
  );
  if (!label) return <span className={className} style={{ display: "inline-flex" }}>{control}</span>;
  return (
    <label className={cx(styles.checkLabel, className)}>
      {control}
      {label}
    </label>
  );
}
