"use client";

import { useId, useRef, useState, type InputHTMLAttributes } from "react";
import { cx } from "../cx";
import { Icon } from "./Icon";
import styles from "./Field.module.css";

export type SearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className" | "value" | "defaultValue" | "onChange"> & {
  label?: string;
  /** Shows the label above the control (C-00); otherwise it is visually hidden. */
  showLabel?: boolean;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  clearLabel?: string;
  className?: string;
};

/** Search input with icon and a clear chip (Esc also clears). Controlled or uncontrolled. */
export function SearchField({
  label = "Search",
  showLabel,
  value,
  defaultValue = "",
  onValueChange,
  clearLabel = "Clear search",
  className,
  id,
  onKeyDown,
  ...rest
}: SearchFieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const ref = useRef<HTMLInputElement>(null);
  const [inner, setInner] = useState(defaultValue);
  const current = value ?? inner;
  const set = (next: string) => {
    if (value === undefined) setInner(next);
    onValueChange?.(next);
  };
  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={inputId} className={showLabel ? styles.label : styles.srOnly}>
        {label}
      </label>
      <div className={styles.search}>
        <Icon name="search" />
        <input
          ref={ref}
          id={inputId}
          type="search"
          className={styles.searchInput}
          value={current}
          onChange={(e) => set(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && current) {
              e.preventDefault();
              set("");
            }
            onKeyDown?.(e);
          }}
          {...rest}
        />
        {current ? (
          <button
            type="button"
            className={styles.clear}
            aria-label={clearLabel}
            onClick={() => {
              set("");
              ref.current?.focus();
            }}
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}
