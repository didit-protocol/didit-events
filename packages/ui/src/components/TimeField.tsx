"use client";

import { useMemo, useState } from "react";
import { Combobox } from "./Combobox";
import { Icon } from "./Icon";
import type { FieldChrome } from "./TextField";
import { formatDuration, normalizeTime, timeSlots, timeToMinutes } from "./time";

export interface TimeFieldProps extends Omit<FieldChrome, "size"> {
  id?: string;
  name?: string;
  /** "HH:MM" (or whatever was typed and not yet normalised). */
  value: string;
  onChange: (value: string) => void;
  /** Only offer slots strictly after this time ("HH:MM"): the end picker passes the start. */
  after?: string;
  /**
   * Inline error for a typed time at or before `after`, shown as soon as it is committed (blur or Enter). Pass the
   * form's own rule so the message matches the server's.
   */
  afterError?: string | ((time: string) => string | undefined);
  /** Show the duration from this time next to each slot and in the field ("3 h 30 min"). */
  durationFrom?: string;
  step?: number;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  onBlur?: () => void;
}

/**
 * Time picker in the shadcn look: an outline field with a clock icon that opens a list of `step`-minute slots
 * (24 h). Typing works too ("19:00", "1900", "7pm", "7:30 pm") and is normalised to HH:MM on blur or Enter. The
 * input itself submits, so a plain form post carries the value.
 */
export function TimeField({ id, name, value, onChange, after, afterError, durationFrom, step = 15, placeholder = "--:--", readOnly, disabled, onBlur, ...chrome }: TimeFieldProps) {
  const [typing, setTyping] = useState<string | null>(null);
  // A typed value was committed: from then on a value at or before `after` shows the inline error (a picked slot
  // is always in range, and a new keystroke hides it until the next commit).
  const [typedCommit, setTypedCommit] = useState(false);
  const floor = after ? timeToMinutes(after) : null;
  const from = durationFrom ? timeToMinutes(durationFrom) : null;
  const options = useMemo(
    () =>
      timeSlots(step)
        .filter((t) => floor === null || timeToMinutes(t)! > floor)
        .map((t) => {
          const d = from !== null ? timeToMinutes(t)! - from : null;
          return { value: t, label: t, description: d !== null && d > 0 ? formatDuration(d) : undefined };
        }),
    [step, floor, from],
  );
  const text = typing ?? value;
  const typed = normalizeTime(text);
  // Highlight the typed time's slot, else the first slot at or after it, else the current value.
  const minutes = typed ? timeToMinutes(typed)! : null;
  const active = minutes !== null ? (options.find((o) => timeToMinutes(o.value)! >= minutes)?.value ?? options.at(-1)?.value) : value || (floor !== null ? options[0]?.value : "19:00");
  const current = timeToMinutes(value);
  const duration = from !== null && current !== null && current > from ? formatDuration(current - from) : null;
  const outOfRange = typedCommit && typing === null && floor !== null && current !== null && current <= floor;
  const rangeError = outOfRange ? (typeof afterError === "function" ? afterError(value) : afterError) ?? `Pick a time after ${after}` : undefined;

  const commitTyped = (t: string) => {
    onChange(t);
    setTyping(null);
    setTypedCommit(true);
  };
  const commit = () => {
    if (typing === null) return;
    commitTyped(normalizeTime(typing) ?? typing);
  };

  return (
    <Combobox
      {...chrome}
      error={chrome.error ?? rangeError}
      id={id}
      name={name}
      inputMode="text"
      placeholder={placeholder}
      inputValue={text}
      onInputChange={(v) => {
        setTyping(v);
        setTypedCommit(false);
      }}
      options={options}
      activeValue={active}
      openOnFocus
      listLabel={typeof chrome.label === "string" ? `${chrome.label} times` : "Times"}
      emptyText="No later time on this day"
      leading={<Icon name="clock" size={16} />}
      trailing={duration}
      readOnly={readOnly}
      disabled={disabled}
      onSelect={(o) => {
        setTyping(null);
        setTypedCommit(false);
        onChange(o.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && typing !== null && normalizeTime(typing)) {
          // Enter on a typed time commits it (the list selection wins when an option is active).
          const t = normalizeTime(typing)!;
          if (!options.some((o) => o.value === t)) {
            e.preventDefault();
            commitTyped(t);
          }
        }
      }}
      onBlur={() => {
        // Typed text commits through onChange (the form validates the new value there); otherwise report the blur.
        if (typing !== null) commit();
        else onBlur?.();
      }}
    />
  );
}

