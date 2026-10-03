"use client";

import { useId } from "react";
import { Segmented, Switch } from "@didit-events/ui";
import type { EventDoor } from "../model/contract";
import { DEFAULT_THRESHOLD, type V2Errors } from "./editor";
import s from "./Sections.module.css";

export interface DoorSectionProps {
  value: EventDoor;
  onChange: (next: EventDoor) => void;
  errors: V2Errors;
  readOnly?: boolean;
}

const PRESETS = [
  { value: 70, label: "Relaxed · 70%" },
  { value: 80, label: "Standard · 80%" },
  { value: 90, label: "Strict · 90%" },
];

/**
 * Door: is there a face kiosk at the entrance? Only then strictness (match threshold) and mode appear. Without a
 * kiosk, hosts check guests in from the guest list; the account baseline (email + face) still applies.
 */
export function DoorSection({ value, onChange, errors, readOnly }: DoorSectionProps) {
  const ids = useId();
  const threshold = value.kiosk ? value.match_threshold : DEFAULT_THRESHOLD;
  const presets = PRESETS.some((p) => p.value === threshold) ? PRESETS : [...PRESETS, { value: threshold, label: `Custom · ${threshold}%` }];
  return (
    <div className={s.stack}>
      <div className={s.toggleRow}>
        <div className={s.toggleText}>
          <label htmlFor={`${ids}-kiosk`} className={s.rowTitle}>
            Face kiosk at the door
          </label>
          <span className={s.help}>{value.kiosk ? "Guests walk up to a paired kiosk and are recognised by their enrolled selfie." : "No kiosk: hosts check guests in from the guest list or their pass."}</span>
        </div>
        <Switch
          id={`${ids}-kiosk`}
          checked={value.kiosk}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.checked ? { kiosk: true, mode: "supervised", match_threshold: threshold } : { kiosk: false })}
        />
      </div>
      {value.kiosk ? (
        <>
          <div className={s.block}>
            <span className={s.blockTitle} id={`${ids}-mode`}>
              Kiosk mode
            </span>
            <Segmented
              name={`${ids}-mode`}
              label="Kiosk mode"
              className={s.segmented}
              value={value.mode}
              onChange={(v) => onChange({ ...value, mode: v === "strict" ? "strict" : "supervised" })}
              options={[
                { value: "supervised", label: "Supervised" },
                { value: "strict", label: "Strict" },
              ]}
            />
            <span className={s.help}>
              {value.mode === "strict" ? "Each scan also runs a liveness check, for doors without staff watching. Costs one more check per scan." : "A host stands by the kiosk. Face match only."}
            </span>
          </div>
          <div className={s.block}>
            <span className={s.blockTitle} id={`${ids}-th`}>
              Matching strictness
            </span>
            <Segmented
              name={`${ids}-th`}
              label="Matching strictness"
              className={s.segmented}
              value={String(threshold)}
              onChange={(v) => onChange({ ...value, match_threshold: Number(v) })}
              options={presets.map((p) => ({ value: String(p.value), label: p.label }))}
            />
            <span className={s.help}>How sure the kiosk must be before it welcomes someone.</span>
            {errors.threshold ? <span className={s.error}>{errors.threshold}</span> : null}
          </div>
        </>
      ) : (
        <p className={s.note}>Guests still verify email and face before they can ask to join. Manual check-in never skips those checks.</p>
      )}
    </div>
  );
}
