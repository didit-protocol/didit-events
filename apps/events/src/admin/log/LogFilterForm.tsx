"use client";

import type { ChangeEvent } from "react";
import { Select, Switch } from "@didit-events/ui";
import type { DoorRef, LogFilters } from "./types";
import s from "./Log.module.css";

/**
 * Door select + "Show only people" as a GET form: a change submits it, so the filters live in the URL
 * (`?door=`, `?people=0`) and the server renders the result. `people=0` is sent only while the toggle is off.
 */
export function LogFilterForm({ action, filters, doors }: { action: string; filters: LogFilters; doors: DoorRef[] }) {
  const submit = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const form = e.currentTarget.form;
    const off = form?.elements.namedItem("people-off");
    if (off instanceof HTMLInputElement && e.currentTarget instanceof HTMLInputElement) off.disabled = e.currentTarget.checked;
    form?.requestSubmit();
  };
  return (
    <form method="get" action={action} className={s.filterForm}>
      {filters.view === "missing" ? <input type="hidden" name="view" value="missing" /> : null}
      {filters.result ? <input type="hidden" name="result" value={filters.result} /> : null}
      <Select
        name="door"
        label="Door"
        hideLabel
        className={s.door}
        defaultValue={filters.door ?? "all"}
        onChange={submit}
        options={[{ value: "all", label: "All doors" }, ...doors.map((d) => ({ value: d.id, label: d.name }))]}
      />
      <input type="hidden" id="people-off" name="people" value="0" disabled={filters.people} />
      <Switch defaultChecked={filters.people} onChange={submit} label="Show only people" className={s.people} />
      <button type="submit" className={s.srOnly}>
        Apply filters
      </button>
    </form>
  );
}
