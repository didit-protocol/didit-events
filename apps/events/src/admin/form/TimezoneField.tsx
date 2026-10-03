"use client";

import { useState } from "react";
import { Combobox, Icon } from "@didit-events/ui";
import { type CalendarDate, TIMEZONES, searchTimezones, timezoneCity, timezoneLabel, utcOffsetLabel } from "./validate";

export interface TimezoneFieldProps {
  value: string;
  onChange: (id: string) => void;
  /** The event date: the offset shown is the one in force that day (summer time or not). */
  date: CalendarDate | null;
  error?: string;
  readOnly?: boolean;
  className?: string;
  onBlur?: () => void;
}

/**
 * Searchable timezone combobox: type "Madrid", "New York" or "CEST"; each option shows its UTC offset on the event
 * date, and the field shows the chosen zone's city and offset. Posts the IANA id through a hidden input.
 */
export function TimezoneField({ value, onChange, date, error, readOnly, className, onBlur }: TimezoneFieldProps) {
  const [query, setQuery] = useState<string | null>(null);
  const known = TIMEZONES.some((z) => z.id === value);
  // The field shows the city ("Madrid (CEST)"): the full IANA id never fits beside the offset, and the list has it.
  const shown = query ?? (known ? timezoneLabel(value, date).replace(value, timezoneCity(value)) : value);
  const list = query === null ? TIMEZONES : searchTimezones(query);
  return (
    <>
      <Combobox
        label="Timezone"
        className={className}
        inputValue={shown}
        onInputChange={setQuery}
        options={list.map((z) => ({ value: z.id, label: `${timezoneCity(z.id)} · ${z.id}`, description: utcOffsetLabel(z.id, date) }))}
        activeValue={value}
        onSelect={(o) => {
          onChange(o.value);
          setQuery(null);
        }}
        openOnFocus
        listLabel="Timezones"
        emptyText="No matching timezone"
        leading={<Icon name="globe" size={16} />}
        trailing={known && query === null ? utcOffsetLabel(value, date) : undefined}
        error={error}
        readOnly={readOnly}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          // A typed exact match counts as a pick; anything else snaps back to the current zone.
          const exact = query !== null ? searchTimezones(query) : [];
          if (exact.length === 1) onChange(exact[0]!.id);
          setQuery(null);
          onBlur?.();
        }}
      />
      <input type="hidden" name="timezone" value={value} />
    </>
  );
}
