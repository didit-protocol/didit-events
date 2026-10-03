"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "./Icon";
import { addDays, addMonths, compareYmd, daysInMonth, isoDate, parseIsoDate, todayYmd, weekdayMon, type YMD } from "./time";
import styles from "./Picker.module.css";

const WEEKDAYS = [
  ["Mo", "Monday"],
  ["Tu", "Tuesday"],
  ["We", "Wednesday"],
  ["Th", "Thursday"],
  ["Fr", "Friday"],
  ["Sa", "Saturday"],
  ["Su", "Sunday"],
] as const;
const monthTitle = (c: YMD) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(c.y, c.m - 1, 1)));
const dayLabel = (c: YMD) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(c.y, c.m - 1, c.d)));

export interface DatePickerCalendarProps {
  id: string;
  label: string;
  value: string;
  min?: string;
  max?: string;
  onSelect: (iso: string) => void;
  onClose: () => void;
  /** Tests and frames: the clock for "today". */
  today?: YMD;
  /** Move focus into the grid on open (off in the static frame gallery). */
  autoFocus?: boolean;
}

/**
 * The popover month grid (WAI-ARIA date picker dialog): Monday-first weekday header, prev/next month buttons,
 * today marked, the selected day filled, outside-month days muted, days outside min/max disabled. Keys: arrows by
 * day/week, PageUp/PageDown by month (Shift = year), Home/End to the week's start/end, Enter/Space select,
 * Escape closes. One roving tab stop in the grid.
 */
export default function DatePickerCalendar({ id, label, value, min, max, onSelect, onClose, today: todayProp, autoFocus = true }: DatePickerCalendarProps) {
  const today = todayProp ?? todayYmd();
  const selected = parseIsoDate(value);
  const lo = min ? parseIsoDate(min) : null;
  const hi = max ? parseIsoDate(max) : null;
  const clamp = (c: YMD) => (lo && compareYmd(c, lo) < 0 ? lo : hi && compareYmd(c, hi) > 0 ? hi : c);
  const [focus, setFocus] = useState<YMD>(() => clamp(selected ?? today));
  const [view, setView] = useState<{ y: number; m: number }>({ y: focus.y, m: focus.m });
  const grid = useRef<HTMLTableElement>(null);
  // Keyboard moves (and opening) move DOM focus to the day; the month buttons keep focus where it is.
  const moveFocus = useRef(autoFocus);

  const outOfRange = (c: YMD) => Boolean((lo && compareYmd(c, lo) < 0) || (hi && compareYmd(c, hi) > 0));

  // Focus the roving day on open and after every keyboard move.
  useEffect(() => {
    if (!moveFocus.current) return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${isoDate(focus)}"]`)?.focus();
  }, [focus]);

  const go = (c: YMD) => {
    moveFocus.current = true;
    setFocus(c);
    if (c.y !== view.y || c.m !== view.m) setView({ y: c.y, m: c.m });
  };
  const shiftMonth = (delta: number) => {
    const next = addMonths({ ...view, d: 1 }, delta);
    moveFocus.current = false;
    setView({ y: next.y, m: next.m });
    setFocus(addMonths(focus, delta));
  };

  const onKey = (e: KeyboardEvent<HTMLTableElement>) => {
    const k = e.key;
    let next: YMD | null = null;
    if (k === "ArrowLeft") next = addDays(focus, -1);
    else if (k === "ArrowRight") next = addDays(focus, 1);
    else if (k === "ArrowUp") next = addDays(focus, -7);
    else if (k === "ArrowDown") next = addDays(focus, 7);
    else if (k === "PageUp") next = addMonths(focus, e.shiftKey ? -12 : -1);
    else if (k === "PageDown") next = addMonths(focus, e.shiftKey ? 12 : 1);
    else if (k === "Home") next = addDays(focus, -weekdayMon(focus));
    else if (k === "End") next = addDays(focus, 6 - weekdayMon(focus));
    else if (k === "Enter" || k === " ") {
      e.preventDefault();
      if (!outOfRange(focus)) onSelect(isoDate(focus));
      return;
    }
    if (next) {
      e.preventDefault();
      go(next);
    }
  };

  // 6 weeks from the Monday on or before the 1st.
  const first: YMD = { y: view.y, m: view.m, d: 1 };
  const start = addDays(first, -weekdayMon(first));
  const weeks: YMD[][] = [];
  for (let w = 0; w < 6; w++) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i)));
  const titleId = `${id}-title`;
  const prevDisabled = Boolean(lo && compareYmd(addDays(first, -1), lo) < 0);
  const nextDisabled = Boolean(hi && compareYmd({ y: view.y, m: view.m, d: daysInMonth(view.y, view.m) }, hi) >= 0);

  return (
    <div
      id={id}
      role="dialog"
      aria-modal="false"
      aria-label={label}
      className={styles.popover}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className={styles.calHead}>
        <button type="button" className={styles.navBtn} aria-label="Previous month" onClick={() => shiftMonth(-1)} disabled={prevDisabled}>
          <Icon name="chevron-left" size={16} />
        </button>
        <h2 id={titleId} className={styles.calTitle} aria-live="polite">
          {monthTitle(first)}
        </h2>
        <button type="button" className={styles.navBtn} aria-label="Next month" onClick={() => shiftMonth(1)} disabled={nextDisabled}>
          <Icon name="chevron-right" size={16} />
        </button>
      </div>
      <table ref={grid} role="grid" aria-labelledby={titleId} className={styles.grid} onKeyDown={onKey}>
        <thead>
          <tr>
            {WEEKDAYS.map(([short, long]) => (
              <th key={short} scope="col" abbr={long} className={styles.weekday}>
                {short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={isoDate(week[0]!)}>
              {week.map((day) => {
                const iso = isoDate(day);
                const isSelected = Boolean(selected && compareYmd(day, selected) === 0);
                const isToday = compareYmd(day, today) === 0;
                const outside = day.m !== view.m;
                const off = outOfRange(day);
                const isFocus = compareYmd(day, focus) === 0;
                return (
                  <td key={iso} role="gridcell" aria-selected={isSelected || undefined}>
                    <button
                      type="button"
                      data-date={iso}
                      className={styles.day}
                      data-selected={isSelected ? "" : undefined}
                      data-today={isToday ? "" : undefined}
                      data-outside={outside ? "" : undefined}
                      aria-current={isToday ? "date" : undefined}
                      aria-label={dayLabel(day)}
                      aria-disabled={off || undefined}
                      tabIndex={isFocus ? 0 : -1}
                      onClick={() => {
                        if (off) return;
                        onSelect(iso);
                      }}
                    >
                      {day.d}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
