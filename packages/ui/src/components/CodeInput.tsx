"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type ClipboardEvent } from "react";
import { cx } from "../cx";
import styles from "./CodeInput.module.css";

export interface CodeInputProps {
  /** Form field name; the input submits the digits as one value. */
  name: string;
  /** Accessible label ("6-digit code"); the boxes themselves are decorative. */
  label: string;
  length?: number;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  /** Called once the last digit is typed or pasted (auto-submit). */
  onComplete?: (value: string) => void;
  /** The wrong-code look (04 R-05): red boxes, one 200 ms shake. */
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** id of the error or hint text, wired to aria-describedby. */
  describedBy?: string;
  /** Forces the focus look on the next empty box (frame gallery / docs only). */
  state?: "focus";
  id?: string;
  className?: string;
}

const digitsOnly = (v: string, n: number) => v.replace(/\D/g, "").slice(0, n);

/**
 * Six-box one-time-code entry (04 R-04…R-06, R-12/R-13; 05 U-08…U-12, DA-03). One real input under the boxes keeps
 * paste, SMS/email autofill (`autocomplete="one-time-code"`) and screen readers working; the boxes are drawn from it.
 */
export function CodeInput({
  name,
  label,
  length = 6,
  defaultValue = "",
  value,
  onChange,
  onComplete,
  invalid,
  disabled,
  autoFocus,
  describedBy,
  state,
  id,
  className,
}: CodeInputProps) {
  const auto = useId();
  const ref = useRef<HTMLInputElement>(null);
  // A wrong code stays on screen (red) and is replaced by the next keypress or paste: select it all.
  useEffect(() => {
    if (invalid && ref.current && document.activeElement === ref.current) ref.current.select();
  }, [invalid]);
  const [own, setOwn] = useState(() => digitsOnly(defaultValue, length));
  const current = value !== undefined ? digitsOnly(value, length) : own;
  // No maxLength on the input: autofill or typing may bring a formatted code (" 481903", "481 903") longer than
  // `length` characters; digitsOnly strips and caps it.
  const apply = (raw: string) => {
    const next = digitsOnly(raw, length);
    if (next === current) return;
    if (value === undefined) setOwn(next);
    onChange?.(next);
    if (next.length === length) onComplete?.(next);
  };
  const change = (e: ChangeEvent<HTMLInputElement>) => apply(e.target.value);
  // A pasted code ("481 903", "481-903") replaces what is there, even a full wrong code still on screen.
  const paste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData?.getData("text") ?? "";
    if (!/\d/.test(text)) return;
    e.preventDefault();
    apply(text);
  };
  return (
    <div className={cx(styles.wrap, invalid && styles.invalid, className)} data-state={state} style={{ gridTemplateColumns: `repeat(${length}, 1fr)` }}>
      <input
        ref={ref}
        id={id ?? auto}
        name={name}
        className={styles.input}
        value={current}
        onChange={change}
        onPaste={paste}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern={`\\d{${length}}`}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        autoFocus={autoFocus}
        spellCheck={false}
      />
      {Array.from({ length }, (_, i) => (
        <span key={i} aria-hidden="true" className={cx(styles.box, i === current.length && styles.next)}>
          {current[i] ?? ""}
        </span>
      ))}
    </div>
  );
}
