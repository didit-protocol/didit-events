"use client";
import { actionCsrf } from "../../auth/client";

import { useState, useTransition } from "react";
import { Button, DatePicker, TextField, TimeField, normalizeTime, toast } from "@didit-events/ui";
import { saveDetailsAction, type DetailsResult } from "../../../app/admin/(events)/events/[id]/(tabs)/settings/actions";
import { LeaveGuard } from "../form/LeaveGuard";
import { NAME_MAX } from "../form/validate";
import { handleSessionExpired } from "../system/session";
import { useAdminRouter } from "../useAdminRouter";
import { sameDetails, validateDetails, type DetailsErrors, type DetailsValues } from "./details";
import s from "./Settings.module.css";

export interface DetailsFormProps {
  eventId: string;
  initial: DetailsValues & { timeZone: string };
  editVersion: number;
  /** Ended / cancelled events are read-only. */
  readOnly?: boolean;
}

const FAILED: Record<string, string> = {
  conflict: "Someone else changed this event. Reload the latest details, then make your change again.",
  closed: "This event has ended, so its details can’t change.",
  not_found: "This event no longer exists.",
  invalid: "Check the highlighted fields.",
};

/**
 * Settings → Event details: name, date and start/end times edited in place with the editor's own date picker and
 * time fields, saved against the event's edit version, validated like the editor (end after start), and guarded
 * against leaving with unsaved changes.
 */
export function DetailsForm({ eventId, initial, editVersion, readOnly }: DetailsFormProps) {
  const router = useAdminRouter();
  const base: DetailsValues = { name: initial.name, date: initial.date, start: initial.start, end: initial.end };
  const [saved, setSaved] = useState(base);
  const [values, setValues] = useState(base);
  const [version, setVersion] = useState(editVersion);
  const [errors, setErrors] = useState<DetailsErrors>({});
  const [failure, setFailure] = useState<string>();
  const [outcome, setOutcome] = useState<{ ok: boolean } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, start] = useTransition();
  const dirty = !sameDetails(values, saved);
  // The server's latest values (refreshed after any save, ours or someone else's). A clean form follows them, so the
  // next save is checked against the current edit version; a form with unsaved edits keeps its version and conflicts.
  const [server, setServer] = useState({ ...base, version: editVersion });
  if (server.version !== editVersion || !sameDetails(server, base)) {
    setServer({ ...base, version: editVersion });
    if (!dirty && !pending) { setSaved(base); setValues(base); setVersion(editVersion); }
  }
  /** Conflict recovery: drop the local edits, take the latest values and version, and fetch anything newer. */
  const reload = () => {
    const latest: DetailsValues = { name: server.name, date: server.date, start: server.start, end: server.end };
    setSaved(latest); setValues(latest); setVersion(server.version); setErrors({}); setFailure(undefined); setConflict(false); setOutcome(null);
    router.refresh();
  };

  const set = <K extends keyof DetailsValues>(k: K, v: DetailsValues[K]) => {
    const next = { ...values, [k]: v };
    setValues(next);
    // Once a field shows an error, keep it in step with the value.
    if (errors[k] || (k === "start" && errors.end)) setErrors(validateDetails(next));
  };
  const blur = (k: keyof DetailsValues) => {
    const e = validateDetails(values);
    setErrors((prev) => ({ ...prev, [k]: e[k], ...(k === "start" ? { end: values.end ? e.end : prev.end } : {}) }));
  };

  /** Starts a save; false when the values are invalid (nothing is sent). */
  const save = () => {
    const e = validateDetails(values);
    setErrors(e);
    setFailure(undefined);
    if (Object.keys(e).length) return false;
    start(async () => {
      const result = await saveDetailsAction(eventId, values, version, actionCsrf()).catch((): DetailsResult => ({ error: "conflict" }));
      if (handleSessionExpired(result)) return;
      if ("error" in result) {
        if (result.errors) setErrors(result.errors);
        setConflict(result.error === "conflict");
        if (result.error === "conflict") router.refresh();
        setFailure(FAILED[result.error] ?? FAILED.invalid);
        setOutcome({ ok: false });
        return;
      }
      const clean = { ...values, name: values.name.trim(), start: normalizeTime(values.start) ?? values.start, end: normalizeTime(values.end) ?? values.end };
      setVersion(result.editVersion);
      setSaved(clean);
      setValues(clean);
      setOutcome({ ok: true });
      toast({ message: "Event details saved." });
      router.refresh();
    });
    return true;
  };

  return (
    <form
      className={s.details}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className={s.detailsGrid}>
        <TextField label="Event name" value={values.name} maxLength={NAME_MAX + 40} error={errors.name} readOnly={readOnly || pending} onChange={(e) => set("name", e.currentTarget.value)} onBlur={() => blur("name")} />
        <DatePicker label="Date" value={values.date} onChange={(iso) => set("date", iso)} onBlur={() => blur("date")} error={errors.date} readOnly={readOnly || pending} />
        <TimeField label="Start" value={values.start} onChange={(v) => set("start", v)} onBlur={() => blur("start")} error={errors.start} readOnly={readOnly || pending} />
        <TimeField
          label="End"
          value={values.end}
          after={normalizeTime(values.start) ?? undefined}
          durationFrom={normalizeTime(values.start) ?? undefined}
          afterError={(end) => validateDetails({ ...values, end }).end}
          onChange={(v) => set("end", v)}
          onBlur={() => blur("end")}
          error={errors.end}
          readOnly={readOnly || pending}
        />
      </div>
      <p className={s.note}>Times are in {initial.timeZone.replace(/_/g, " ")}. Venue, capacity, cover and questions are in the full editor.</p>
      {dirty || failure ? (
        <div className={s.saveRow} aria-live="polite">
          <Button type="submit" size="sm" loading={pending} disabled={readOnly}>
            Save details
          </Button>
          {conflict ? (
            <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={reload}>
              Reload latest details
            </Button>
          ) : (
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { setValues(saved); setErrors({}); setFailure(undefined); }}>
              Discard
            </Button>
          )}
          {failure ? <p className={s.formError} role="alert">{failure}</p> : null}
        </div>
      ) : null}
      <LeaveGuard dirty={dirty} unpublished={false} onSaveDraft={save} outcome={outcome} saved={outcome?.ok === true} saving={pending} saveLabel="Save changes" />
    </form>
  );
}
