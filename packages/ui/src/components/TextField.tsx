import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "../cx";
import styles from "./Field.module.css";

export interface FieldChrome {
  label?: ReactNode;
  /** Visually hide the label but keep it for assistive tech. */
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  /** Forces the focus look (frame gallery / docs only). */
  state?: "focus";
  /**
   * md = C-00 admin controls (36px, 13/14px); lg = guest forms (44px, label 14px, text 15px, error 13px);
   * xl = the 390 guest flow (04 R-*, 05 U-*: 48px, label 14px, text 15px, error 13px).
   */
  size?: "md" | "lg" | "xl";
  className?: string;
}

/** Label + control + hint/error wrapper. Wires id, aria-describedby and aria-invalid for its child. */
export function FieldShell({
  id,
  label,
  hideLabel,
  hint,
  error,
  size = "md",
  className,
  children,
}: FieldChrome & { id: string; children: (aria: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx(styles.field, size === "lg" && styles.fieldLg, size === "xl" && styles.fieldXl, className)}>
      {label ? (
        <label htmlFor={id} className={hideLabel ? styles.srOnly : styles.label}>
          {label}
        </label>
      ) : null}
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error ? (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      ) : hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export type TextFieldProps = FieldChrome & Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "size">;

/** Single-line text input (C-00 inputs: default, focus, filled, error, disabled). */
export function TextField({ label, hideLabel, hint, error, state, size, className, id, type = "text", ...rest }: TextFieldProps) {
  const auto = useId();
  return (
    <FieldShell id={id ?? auto} label={label} hideLabel={hideLabel} hint={hint} error={error} size={size} className={className}>
      {(aria) => <input type={type} className={styles.control} data-state={state} {...aria} {...rest} />}
    </FieldShell>
  );
}

/** Email input: type=email, email autocomplete and keyboard. */
export function EmailField(props: Omit<TextFieldProps, "type">) {
  return <TextField type="email" autoComplete="email" inputMode="email" spellCheck={false} {...props} />;
}

