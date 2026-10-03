import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "../cx";
import { Icon } from "./Icon";
import { FieldShell, type FieldChrome } from "./TextField";
import styles from "./Field.module.css";

// Preserve direct imports while text-only consumers avoid the other field controls.
export { FieldShell, TextField, EmailField, type TextFieldProps } from "./TextField";

export type TextareaProps = Omit<FieldChrome, "size"> & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> & { size?: "md" | "xl" };

export function Textarea({ label, hideLabel, hint, error, state, size, className, id, ...rest }: TextareaProps) {
  const auto = useId();
  return (
    <FieldShell id={id ?? auto} label={label} hideLabel={hideLabel} hint={hint} error={error} size={size} className={className}>
      {(aria) => <textarea className={cx(styles.control, styles.textarea)} data-state={state} {...aria} {...rest} />}
    </FieldShell>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export type SelectProps = Omit<FieldChrome, "size"> & Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> & { options: SelectOption[]; placeholder?: string };

/** Native select with the C-00 chevron. */
export function Select({ label, hideLabel, hint, error, state, className, id, options, placeholder, ...rest }: SelectProps) {
  const auto = useId();
  return (
    <FieldShell id={id ?? auto} label={label} hideLabel={hideLabel} hint={hint} error={error} className={className}>
      {(aria) => (
        <div className={styles.selectWrap}>
          <select className={cx(styles.control, styles.select)} data-state={state} {...aria} {...rest}>
            {placeholder ? (
              <option value="" disabled>
                {placeholder}
              </option>
            ) : null}
            {options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" className={styles.chevron} />
        </div>
      )}
    </FieldShell>
  );
}

export interface DateTimeFieldProps extends FieldChrome {
  id?: string;
  name?: string;
  dateValue?: string;
  timeValue?: string;
  defaultDate?: string;
  defaultTime?: string;
  onDateChange?: (value: string) => void;
  onTimeChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  min?: string;
  max?: string;
}

/** Date + time pair (native inputs, 1.3 : 1). Submits `${name}Date` and `${name}Time`. */
export function DateTimeField({
  label,
  hideLabel,
  hint,
  error,
  state,
  className,
  id,
  name,
  dateValue,
  timeValue,
  defaultDate,
  defaultTime,
  onDateChange,
  onTimeChange,
  disabled,
  required,
  min,
  max,
}: DateTimeFieldProps) {
  const auto = useId();
  const base = id ?? auto;
  return (
    <FieldShell id={base} label={label} hideLabel={hideLabel} hint={hint} error={error} className={className}>
      {(aria) => (
        <div className={styles.dateTime} role="group" aria-labelledby={undefined}>
          <input
            {...aria}
            type="date"
            name={name ? `${name}Date` : undefined}
            className={cx(styles.control, styles.tnum)}
            data-state={state}
            value={dateValue}
            defaultValue={defaultDate}
            onChange={onDateChange ? (e) => onDateChange(e.target.value) : undefined}
            disabled={disabled}
            required={required}
            min={min}
            max={max}
          />
          <input
            id={`${base}-time`}
            aria-label="Time"
            aria-describedby={aria["aria-describedby"]}
            aria-invalid={aria["aria-invalid"]}
            type="time"
            name={name ? `${name}Time` : undefined}
            className={cx(styles.control, styles.tnum)}
            value={timeValue}
            defaultValue={defaultTime}
            onChange={onTimeChange ? (e) => onTimeChange(e.target.value) : undefined}
            disabled={disabled}
            required={required}
          />
        </div>
      )}
    </FieldShell>
  );
}

export type ToggleProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & { label?: ReactNode; className?: string };

/** Switch (C-00: off, on, disabled). A native checkbox with role="switch". */
export function Toggle({ label, className, ...rest }: ToggleProps) {
  const control = (
    <span className={styles.switch}>
      <input type="checkbox" role="switch" {...rest} />
      <span className={styles.track} aria-hidden="true" />
      <span className={styles.thumb} aria-hidden="true" />
    </span>
  );
  if (!label) return <span className={className}>{control}</span>;
  return (
    <label className={cx(styles.switchLabel, className)}>
      {control}
      {label}
    </label>
  );
}

export type RadioProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & { label?: ReactNode; className?: string };

export function Radio({ label, className, ...rest }: RadioProps) {
  const control = (
    <span className={styles.radio}>
      <input type="radio" {...rest} />
      <span className={styles.radioFace} aria-hidden="true" />
    </span>
  );
  if (!label) return <span className={className}>{control}</span>;
  return (
    <label className={cx(styles.checkLabel, className)}>
      {control}
      {label}
    </label>
  );
}

export interface SegmentedOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps {
  name: string;
  options: SegmentedOption[];
  /** Accessible group name. */
  label: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  size?: "sm" | "md";
  className?: string;
}

/** Segmented control (C-00: Relaxed / Standard / Strict). Native radios, so arrow keys work with no JS. */
export function Segmented({ name, options, label, value, defaultValue, onChange, size = "md", className }: SegmentedProps) {
  return (
    <div role="radiogroup" aria-label={label} className={cx(styles.segmented, size === "sm" && styles.segmentedSm, className)}>
      {options.map((o) => (
        <label key={o.value} className={styles.segment}>
          <input
            type="radio"
            name={name}
            value={o.value}
            disabled={o.disabled}
            checked={value === undefined ? undefined : value === o.value}
            defaultChecked={value === undefined ? defaultValue === o.value : undefined}
            onChange={onChange ? () => onChange(o.value) : value !== undefined ? () => {} : undefined}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}
