"use client";

import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { cx } from "../cx";
import { Icon } from "./Icon";
import { FieldShell, type FieldChrome } from "./TextField";
import { formatLongDate, parseIsoDate } from "./time";
import styles from "./Picker.module.css";

// The month grid only loads on first open: the trigger is all a form's first-load JS pays for.
const Calendar = lazy(() => import("./DatePickerCalendar"));

export interface DatePickerProps extends Omit<FieldChrome, "size"> {
  id?: string;
  /** Posts the ISO date ("2026-10-23", or "" when empty) through a hidden input. */
  name?: string;
  /** ISO "YYYY-MM-DD" or "". */
  value: string;
  onChange: (iso: string) => void;
  /** Days before `min` (ISO) are disabled. */
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  /** Called when the popover closes without a pick (Escape, click outside, trigger): the form's blur check. */
  onBlur?: () => void;
  /** Frame gallery: render the popover open (it still loads lazily). */
  defaultOpen?: boolean;
}

/**
 * shadcn-style date picker: an outline trigger with a calendar icon and the formatted date ("Pick a date" when
 * empty) opening a popover dialog with a month grid. Escape closes and returns focus to the trigger; a click
 * outside closes. The value submits as ISO through a hidden input, so plain server actions keep working.
 */
export function DatePicker({ label, hideLabel, hint, error, state, className, id, name, value, onChange, min, max, placeholder = "Pick a date", disabled, readOnly, onBlur, defaultOpen }: DatePickerProps) {
  const auto = useId();
  const base = id ?? auto;
  const dialogId = `${base}-dialog`;
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = parseIsoDate(value);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
    onBlur?.();
  };

  // Click outside closes (pointerdown, so a drag that ends outside does not count).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <FieldShell id={base} label={label} hideLabel={hideLabel} hint={hint} error={error} className={className}>
      {(aria) => (
        <div className={styles.pickerWrap} ref={wrap}>
          <button
            {...aria}
            ref={trigger}
            type="button"
            className={cx(styles.trigger, !selected && styles.placeholder)}
            data-state={state}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? dialogId : undefined}
            disabled={disabled}
            onClick={() => (readOnly ? undefined : open ? close(false) : setOpen(true))}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && !open && !readOnly) {
                e.preventDefault();
                setOpen(true);
              }
            }}
          >
            <Icon name="calendar" size={16} className={styles.triggerIcon} />
            <span className={styles.triggerText}>{selected ? formatLongDate(selected) : placeholder}</span>
          </button>
          {name ? <input type="hidden" name={name} value={selected ? value : ""} /> : null}
          {open ? (
            <Suspense fallback={<div className={styles.popover} role="dialog" aria-label="Choose date" aria-busy="true" />}>
              <Calendar
                id={dialogId}
                label={typeof label === "string" ? `Choose ${label.toLowerCase()}` : "Choose date"}
                value={value}
                min={min}
                max={max}
                onSelect={(iso) => {
                  // A pick is a change, not a blur: the form validates the new value from onChange.
                  onChange(iso);
                  setOpen(false);
                  trigger.current?.focus();
                }}
                onClose={() => close(true)}
              />
            </Suspense>
          ) : null}
        </div>
      )}
    </FieldShell>
  );
}
