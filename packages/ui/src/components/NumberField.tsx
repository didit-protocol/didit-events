"use client";

import { useId, useState } from "react";
import { cx } from "../cx";
import { Icon } from "./Icon";
import { FieldShell, type FieldChrome } from "./TextField";
import styles from "./Picker.module.css";

export interface NumberFieldProps extends Omit<FieldChrome, "size"> {
  id?: string;
  /** Submits the plain digits ("1200") through a hidden input. */
  name?: string;
  /** Digits as typed ("" allowed). */
  value: string;
  onChange: (digits: string) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  onBlur?: () => void;
}

const group = (digits: string) => (digits ? Number(digits).toLocaleString("en-US") : "");

/**
 * Integer stepper: − / + buttons around a numeric input. Letters and decimals never enter the value; the input
 * shows thousands separators ("1,200") except while it is being edited. ArrowUp/ArrowDown step by one.
 */
export function NumberField({ label, hideLabel, hint, error, state, className, id, name, value, onChange, min = 0, max = Number.MAX_SAFE_INTEGER, step = 1, placeholder, readOnly, disabled, onBlur }: NumberFieldProps) {
  const auto = useId();
  const base = id ?? auto;
  const [editing, setEditing] = useState(false);
  const n = value === "" ? null : Number(value);
  const set = (next: number) => onChange(String(Math.min(max, Math.max(min, next))));
  const bump = (delta: number) => (readOnly || disabled ? undefined : set((n ?? min - (delta > 0 ? delta : 0)) + delta));
  const shown = editing ? value : /^\d+$/.test(value) ? group(value) : value;
  return (
    <FieldShell id={base} label={label} hideLabel={hideLabel} hint={hint} error={error} className={className}>
      {(aria) => (
        <div className={styles.stepper} data-state={state} data-invalid={aria["aria-invalid"] ? "" : undefined} data-disabled={disabled ? "" : undefined}>
          <button type="button" className={styles.stepBtn} aria-label="Decrease" tabIndex={-1} onClick={() => bump(-step)} disabled={disabled || readOnly || (n !== null && n <= min)}>
            <Icon name="minus" size={14} />
          </button>
          <input
            {...aria}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className={cx(styles.input, styles.stepInput)}
            placeholder={placeholder}
            value={shown}
            readOnly={readOnly}
            disabled={disabled}
            role="spinbutton"
            aria-valuenow={n ?? undefined}
            aria-valuemin={min}
            aria-valuemax={max}
            onFocus={() => setEditing(true)}
            onBlur={() => {
              setEditing(false);
              onBlur?.();
            }}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 9))}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                bump(e.key === "ArrowUp" ? step : -step);
              }
            }}
          />
          <button type="button" className={styles.stepBtn} aria-label="Increase" tabIndex={-1} onClick={() => bump(step)} disabled={disabled || readOnly || (n !== null && n >= max)}>
            <Icon name="plus" size={14} />
          </button>
          {name ? <input type="hidden" name={name} value={value} /> : null}
        </div>
      )}
    </FieldShell>
  );
}
