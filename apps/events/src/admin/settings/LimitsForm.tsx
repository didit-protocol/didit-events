"use client";
import { CsrfField } from "../../auth/CsrfField";

import { useActionState, useEffect } from "react";
import { Button, ProgressBar, Segmented, TextField } from "@didit-events/ui";
import { saveLimitsAction } from "../../../app/admin/(events)/events/[id]/(tabs)/settings/actions";
import { notifySessionExpired } from "../system/session";
import { BUDGET_MAX, BUDGET_MIN, usage } from "./limits";
import type { SettingsSaveState, SpendLimits } from "./types";
import s from "./Settings.module.css";

const IDLE: SettingsSaveState = { status: "idle" };

/** A-18 Spend and limits: scan budget per day, today's usage, door mode, matching strictness. */
export function LimitsForm({ eventId, limits, editVersion }: { eventId: string; limits: SpendLimits; editVersion?: number }) {
  const [state, action, pending] = useActionState(saveLimitsAction.bind(null, eventId), IDLE);
  useEffect(() => {
    if (state.status === "error" && state.message === "session_expired") notifySessionExpired();
  }, [state]);
  const errors = state.status === "invalid" ? state.errors : {};
  const use = usage(limits);
  return (
    <form action={action} className={s.fields}><CsrfField />
      {editVersion !== undefined ? <input type="hidden" name="expectedVersion" value={editVersion} /> : null}
      <div className={s.limitsGrid}>
        <span className={s.label} aria-hidden="true">
          Scan budget per day
        </span>
        <TextField
          className={s.budget}
          name="budget"
          type="number"
          inputMode="numeric"
          min={BUDGET_MIN}
          max={BUDGET_MAX}
          step={10}
          label="Scan budget per day"
          hideLabel
          defaultValue={String(limits.dailyScanBudget)}
          error={errors.budget}
          hint="Kiosks pause with a notice when it runs out."
        />
        <span className={s.label} aria-hidden="true">
          Today
        </span>
        <div className={s.usage} data-tone={use.tone}>
          <ProgressBar value={limits.scansToday} max={limits.dailyScanBudget} label="Scans used today" valueText={use.text} />
          <span className={s.usageText}>{use.text}</span>
        </div>
        <span className={s.label} aria-hidden="true">
          Door mode
        </span>
        <div>
          <Segmented
            name="mode"
            label="Door mode"
            defaultValue={limits.mode}
            options={[
              { value: "supervised", label: "Supervised" },
              { value: "strict", label: "Strict with liveness" },
            ]}
          />
          {errors.mode ? <p className={s.formError}>{errors.mode}</p> : null}
        </div>
        <span className={s.label} aria-hidden="true">
          Matching strictness
        </span>
        <div>
          <TextField className={s.strictness} name="strictness" label="Matching strictness" hideLabel type="number" min={60} max={99} step={1} defaultValue={String(limits.strictness)} hint="Similarity threshold, from 60 to 99." />
          {errors.strictness ? <p className={s.formError}>{errors.strictness}</p> : null}
        </div>
      </div>
      <div className={s.saveRow} aria-live="polite">
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Save limits
        </Button>
        {state.status === "saved" ? <span className={s.saved}>Saved</span> : null}
        {state.status === "error" && state.message !== "session_expired" ? <p className={s.formError}>{state.message}</p> : null}
      </div>
    </form>
  );
}
