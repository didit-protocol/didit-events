"use client";

import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Button, TextField, TimeField, cx, normalizeTime } from "@didit-events/ui";
import { AGENDA_LABEL_MAX, AGENDA_MAX, AGENDA_UNTIL_ERROR, agendaOutside, untilNextDay, uuid, type AgendaRow, type V2Errors } from "./editor";
import s from "./Sections.module.css";

export interface AgendaFieldProps {
  value: AgendaRow[];
  onChange: (next: AgendaRow[]) => void;
  /** The event's start and end as typed: rows outside them get a warning (never an error). */
  start: string;
  end: string;
  /** Item-level messages (`agenda:<id>:time|until|label`, `agenda`), shown once the section has an error. */
  errors?: V2Errors;
  readOnly?: boolean;
}

/** Moves the item at `from` to index `to` (both in range). */
export function moveRow<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

const plus30 = (hm: string) => {
  const m = Math.min(23 * 60 + 59, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)) + 30);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/**
 * Agenda: rows of {time, optional until, label} in the event's time zone, shown on the event page and in the day-before email in
 * this order. Rows are added, removed and reordered by dragging the handle, with the arrow buttons, or with
 * Alt+↑/↓ (↑/↓ on the handle). A time outside the event's start–end is flagged but can still be saved (doors before
 * the start, an after-party).
 */
export function AgendaField({ value, onChange, start, end, errors = {}, readOnly }: AgendaFieldProps) {
  const ids = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [announce, setAnnounce] = useState("");
  const from = normalizeTime(start), to = normalizeTime(end);

  const name = (r: AgendaRow, i: number) => r.label.trim() || `item ${i + 1}`;
  const update = (i: number, r: AgendaRow) => onChange(value.map((x, j) => (j === i ? r : x)));
  const move = (i: number, j: number, focus?: "grip") => {
    if (readOnly || j < 0 || j >= value.length || i === j) return;
    onChange(moveRow(value, i, j));
    setAnnounce(`Moved ${name(value[i]!, i)} to position ${j + 1} of ${value.length}`);
    if (focus) requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-agenda-row="${value[i]!.id}"] [data-grip]`)?.focus());
  };
  const remove = (i: number) => {
    onChange(value.filter((_, j) => j !== i));
    setAnnounce(`Removed ${name(value[i]!, i)}`);
  };
  const add = () => {
    const last = value.at(-1);
    const lastTime = last ? normalizeTime(last.time) : null;
    const row: AgendaRow = { id: uuid(), time: lastTime ? plus30(lastTime) : from ?? "", label: "" };
    onChange([...value, row]);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLInputElement>(`[data-agenda-row="${row.id}"] [data-agenda-label] input`)?.focus());
  };
  const rowKey = (i: number) => (e: KeyboardEvent<HTMLElement>) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    move(i, i + (e.key === "ArrowUp" ? -1 : 1));
  };
  const gripKey = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    move(i, i + (e.key === "ArrowUp" ? -1 : 1), "grip");
  };
  const drop = (i: number) => (e: DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    if (dragging !== null) move(dragging, i);
    setDragging(null);
    setOver(null);
  };

  return (
    <div className={s.block}>
      {value.length ? (
        <ol ref={listRef} className={s.agendaList} aria-describedby={`${ids}-how`}>
          {value.map((row, i) => {
            const label = name(row, i);
            const time = normalizeTime(row.time);
            const outside = time !== null && !row.day && agendaOutside(time, from, to);
            return (
              <li
                key={row.id}
                className={s.agendaRow}
                data-agenda-row={row.id}
                data-dragging={dragging === i ? "" : undefined}
                data-over={over === i && dragging !== null && dragging !== i ? "" : undefined}
                onKeyDown={rowKey(i)}
                onDragOver={(e) => {
                  if (dragging === null) return;
                  e.preventDefault();
                  setOver(i);
                }}
                onDrop={drop(i)}
              >
                <button
                  type="button"
                  className={cx(s.iconBtn, s.grip)}
                  data-grip=""
                  aria-label={`Reorder ${label}`}
                  aria-describedby={`${ids}-how`}
                  disabled={readOnly || value.length < 2}
                  draggable={!readOnly && value.length > 1}
                  onKeyDown={gripKey(i)}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", row.id);
                    setDragging(i);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                >
                  <span aria-hidden="true">⠿</span>
                </button>
                <div>
                  <TimeField label="Time" value={row.time} readOnly={readOnly} error={errors[`agenda:${row.id}:time`]} onChange={(t) => update(i, { ...row, time: t })} />
                </div>
                <div data-agenda-until="">
                  <TimeField
                    label="Until (optional)"
                    value={row.until ?? ""}
                    readOnly={readOnly}
                    after={untilNextDay(row) ? undefined : (time ?? undefined)}
                    afterError={AGENDA_UNTIL_ERROR}
                    durationFrom={untilNextDay(row) ? undefined : (time ?? undefined)}
                    error={errors[`agenda:${row.id}:until`]}
                    onChange={(t) => update(i, { ...row, until: t.trim() ? t : undefined })}
                  />
                </div>
                <div data-agenda-label="">
                  <TextField
                    label="What happens"
                    value={row.label}
                    readOnly={readOnly}
                    placeholder="e.g. Doors open"
                    maxLength={AGENDA_LABEL_MAX + 20}
                    error={errors[`agenda:${row.id}:label`]}
                    onChange={(e) => update(i, { ...row, label: e.target.value })}
                  />
                </div>
                <div className={s.agendaTools}>
                  <button type="button" className={s.iconBtn} aria-label={`Move ${label} up`} disabled={readOnly || i === 0} onClick={() => move(i, i - 1)}>
                    ↑
                  </button>
                  <button type="button" className={s.iconBtn} aria-label={`Move ${label} down`} disabled={readOnly || i === value.length - 1} onClick={() => move(i, i + 1)}>
                    ↓
                  </button>
                  <button type="button" className={s.iconBtn} aria-label={`Remove ${label}`} disabled={readOnly} onClick={() => remove(i)}>
                    ×
                  </button>
                </div>
                {outside ? (
                  <span className={s.agendaWarn} data-agenda-warning="">
                    Outside the event’s {from}–{to}. Guests still see it.
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={s.note}>No agenda yet. The event page hides the section until you add an item.</p>
      )}
      {errors.agenda ? <span className={s.error}>{errors.agenda}</span> : null}
      <span id={`${ids}-how`} className={s.srOnly}>
        Drag the handle, or press Alt plus the up or down arrow, to reorder.
      </span>
      <span className={s.srOnly} role="status" aria-live="polite">
        {announce}
      </span>
      <div className={s.agendaFoot}>
        <Button type="button" variant="secondary" size="sm" disabled={readOnly || value.length >= AGENDA_MAX} onClick={add}>
          Add agenda item
        </Button>
        <span className={s.help}>
          {value.length}/{AGENDA_MAX}
        </span>
      </div>
    </div>
  );
}
