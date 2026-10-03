"use client";

import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { FieldShell, type FieldChrome } from "./TextField";
import styles from "./Picker.module.css";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Secondary text (Places secondary line, UTC offset, duration). */
  description?: string;
  disabled?: boolean;
}

export type ComboboxProps = Omit<FieldChrome, "size"> &
  Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "size" | "value" | "onChange" | "onSelect" | "role"> & {
    /** The text in the input (controlled). */
    inputValue: string;
    onInputChange: (value: string) => void;
    options: ComboboxOption[];
    onSelect: (option: ComboboxOption) => void;
    /** Accessible name of the listbox ("Start times"). */
    listLabel: string;
    /** The option to highlight and scroll to when the list opens (e.g. the current time). */
    activeValue?: string;
    /** Open the list when the input gets focus (pick lists); search boxes wait for typing. */
    openOnFocus?: boolean;
    /** Shown instead of options while a search runs. */
    loading?: boolean;
    /** Shown when there are no options (null hides the popover instead). */
    emptyText?: ReactNode;
    /** Icon inside the input, before the text. */
    leading?: ReactNode;
    /** Text inside the input, after the text (UTC offset, duration). */
    trailing?: ReactNode;
  };

/**
 * WAI-ARIA combobox (list autocomplete): an input with role="combobox" and a popup listbox. ArrowDown / ArrowUp open
 * and move, Enter selects, Escape closes (a second Escape leaves the text alone), Tab and blur close. Focus stays in
 * the input; the active option is aria-activedescendant. Styled as the C-00 input with a shadcn-style popover.
 */
export function Combobox({
  label,
  hideLabel,
  hint,
  error,
  state,
  className,
  id,
  inputValue,
  onInputChange,
  options,
  onSelect,
  listLabel,
  activeValue,
  openOnFocus,
  loading,
  emptyText = null,
  leading,
  trailing,
  onFocus,
  onBlur,
  onKeyDown,
  readOnly,
  disabled,
  ...rest
}: ComboboxProps) {
  const auto = useId();
  const base = id ?? auto;
  const listId = `${base}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);
  const enabled = options.filter((o) => !o.disabled);
  const showList = open && (loading || options.length > 0 || emptyText !== null);

  const firstEnabled = options.findIndex((o) => !o.disabled);
  const lastEnabled = options.findLastIndex((o) => !o.disabled);
  const indexOf = (value?: string) => (value === undefined ? -1 : options.findIndex((o) => o.value === value && !o.disabled));
  /** Where the list opens: the current value's option, else (when that option is disabled) the first enabled one. */
  const startIndex = (value?: string) => {
    const i = indexOf(value);
    return i >= 0 || !options.some((o) => o.value === value && o.disabled) ? i : firstEnabled;
  };
  // The active row is never a disabled one (the options can change under an open list).
  const current = active >= 0 && options[active] && !options[active]!.disabled ? active : -1;
  const openList = (at?: number) => {
    if (readOnly || disabled) return;
    setOpen(true);
    setActive(at ?? startIndex(activeValue));
  };
  const move = (delta: number) => {
    if (!enabled.length) return;
    let i = current < 0 ? (delta > 0 ? -1 : options.length) : current;
    do i = (i + delta + options.length) % options.length;
    while (options[i]!.disabled);
    setActive(i);
  };
  const choose = (o: ComboboxOption | undefined) => {
    if (!o || o.disabled) return;
    onSelect(o);
    setOpen(false);
    setActive(-1);
  };

  // Keep the active option in view (the time list is 96 rows long).
  useEffect(() => {
    if (!open || active < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) openList(indexOf(activeValue) >= 0 ? indexOf(activeValue) : firstEnabled);
      else move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) openList(indexOf(activeValue) >= 0 ? indexOf(activeValue) : lastEnabled);
      else move(-1);
    } else if (e.key === "Enter") {
      if (open && current >= 0) {
        e.preventDefault();
        choose(options[current]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <FieldShell id={base} label={label} hideLabel={hideLabel} hint={hint} error={error} className={className}>
      {(aria) => (
        <div className={styles.combo}>
          <div className={styles.inputBox} data-state={state} data-invalid={aria["aria-invalid"] ? "" : undefined} data-disabled={disabled ? "" : undefined}>
            {leading ? <span className={styles.leading} aria-hidden="true">{leading}</span> : null}
            <input
              {...aria}
              {...rest}
              type="text"
              role="combobox"
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={showList}
              aria-controls={listId}
              aria-activedescendant={showList && current >= 0 ? `${base}-opt-${current}` : undefined}
              className={styles.input}
              value={inputValue}
              readOnly={readOnly}
              disabled={disabled}
              onChange={(e) => {
                onInputChange(e.target.value);
                if (!readOnly) setOpen(true);
                setActive(-1);
              }}
              onFocus={(e) => {
                onFocus?.(e);
                if (openOnFocus) openList();
              }}
              onClick={() => {
                if (openOnFocus && !open) openList();
              }}
              onBlur={(e) => {
                setOpen(false);
                onBlur?.(e);
              }}
              onKeyDown={onKey}
            />
            {trailing ? <span className={styles.trailing}>{trailing}</span> : null}
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label={listLabel} className={styles.listbox} hidden={!showList}>
            {loading ? (
              <li className={styles.listNote} role="presentation">
                Searching…
              </li>
            ) : options.length === 0 ? (
              <li className={styles.listNote} role="presentation">
                {emptyText}
              </li>
            ) : (
              options.map((o, i) => (
                <li
                  key={`${o.value}-${i}`}
                  id={`${base}-opt-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === current}
                  aria-disabled={o.disabled || undefined}
                  data-current={o.value === activeValue ? "" : undefined}
                  className={styles.option}
                  // Keep focus in the input: select on mousedown's click without blurring first.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(o)}
                  onMouseMove={() => (o.disabled || i === current ? undefined : setActive(i))}
                >
                  <span className={styles.optionLabel}>{o.label}</span>
                  {o.description ? <span className={styles.optionDesc}>{o.description}</span> : null}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </FieldShell>
  );
}
