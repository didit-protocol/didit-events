"use client";

import { useId } from "react";
import { Checkbox, NumberField, Select, Switch } from "@didit-events/ui";
import type { EditorCapabilities, EventChecks, ExtraCheck } from "../model/contract";
import { canonicalChecks, type V2Errors } from "./editor";
import s from "./Sections.module.css";

export interface VerificationSectionProps {
  value: EventChecks;
  onChange: (next: EventChecks) => void;
  capabilities: EditorCapabilities;
  errors: V2Errors;
  readOnly?: boolean;
  /** Edit mode: registrations per accepted policy revision ("Applies to new requests"). */
  acceptedPolicyCounts?: { policyVersion: number; registrations: number }[];
}

const DAY = 86_400;
const EXTRAS: { key: ExtraCheck; label: string; help: string; cap: keyof Omit<EditorCapabilities, "reason"> }[] = [
  { key: "phone", label: "Phone", help: "Guests confirm a mobile number with an SMS code.", cap: "phone" },
  { key: "id_document", label: "ID document", help: "Guests scan an ID and take a selfie that must match it (KYC).", cap: "document" },
  { key: "name_from_id", label: "Name from ID", help: "The name on the ID must match the guest’s profile name. Uses the same ID scan.", cap: "document" },
];

/** Freshness choices for a proof ("reuse an earlier check if it is newer than…"). */
const FRESHNESS = [
  { value: "", label: "Any valid proof" },
  { value: String(30 * DAY), label: "Newer than 30 days" },
  { value: String(90 * DAY), label: "Newer than 90 days" },
  { value: String(180 * DAY), label: "Newer than 6 months" },
];

/** What a guest does before sending a request, in order (the workflow plan table of docs/event-model-v2.md). */
export function guestSteps(c: EventChecks): string[] {
  const steps = ["Verify their email with a code or Google when they sign in", "Take a selfie once (reused for 6 months across events)"];
  const doc = c.required.includes("id_document") || c.required.includes("name_from_id");
  if (c.required.includes("phone")) steps.push("Confirm their phone number with an SMS code");
  if (doc) steps.push("Scan an ID document and take a matching selfie");
  if (c.required.includes("name_from_id")) steps.push("Have the name on the ID match their profile name");
  if (c.age_min !== undefined) steps.push(doc ? `Be ${c.age_min} or older (from the date of birth on the ID)` : `Pass an age check for ${c.age_min}+ (a quick selfie estimate; an ID is offered if it is borderline)`);
  return steps;
}

type MaxKey = keyof EventChecks["max_age"];
const maxKeyOf = (k: ExtraCheck): MaxKey => (k === "id_document" ? "document" : k);

/**
 * Verification: the fixed account baseline (email + face, always on), then independent extras (phone, ID document,
 * name from ID) and age ≥ N, with optional freshness, provider availability and what guests will be asked.
 */
export function VerificationSection({ value, onChange, capabilities, errors, readOnly, acceptedPolicyCounts }: VerificationSectionProps) {
  const ids = useId();
  const set = (next: EventChecks) => onChange(canonicalChecks(next));
  const toggle = (k: ExtraCheck, on: boolean) => set({ ...value, required: on ? [...value.required, k] : value.required.filter((x) => x !== k) });
  const setMax = (k: MaxKey, raw: string) => {
    const max = { ...value.max_age };
    if (raw) max[k] = Number(raw);
    else delete max[k];
    set({ ...value, max_age: max });
  };
  const ageOn = value.age_min !== undefined;
  const steps = guestSteps(value);
  const older = (acceptedPolicyCounts ?? []).filter((p) => p.registrations > 0);

  return (
    <div className={s.stack}>
      <div className={s.baseline} role="group" aria-labelledby={`${ids}-base`}>
        <span className={s.blockTitle} id={`${ids}-base`}>
          Always required
        </span>
        <ul className={s.fixedList}>
          <li>
            <span aria-hidden="true" className={s.lock}>
              🔒
            </span>
            <span className={s.fixedLabel}>Email</span>
            <span className={s.fixedRule}>Verified at sign-in</span>
          </li>
          <li>
            <span aria-hidden="true" className={s.lock}>
              🔒
            </span>
            <span className={s.fixedLabel}>Face · selfie with liveness</span>
            <span className={s.fixedRule}>Once per account, valid 6 months</span>
          </li>
        </ul>
        <span className={s.help}>Every guest has these before they can ask to join, whether or not you use a kiosk.</span>
      </div>

      <fieldset className={s.block}>
        <legend className={s.blockTitle}>Extra checks for this event</legend>
        {value.required.length === 0 && !ageOn ? <span className={s.help}>No extra checks. Guests only need the baseline above.</span> : null}
        <div className={s.checkList}>
          {EXTRAS.map((x) => {
            const available = capabilities[x.cap];
            const on = value.required.includes(x.key);
            const mk = maxKeyOf(x.key);
            return (
              <div key={x.key} className={s.checkRow} data-on={on ? "" : undefined}>
                <Checkbox
                  label={
                    <span className={s.checkText}>
                      <span className={s.rowTitle}>{x.label}</span>
                      <span className={s.help}>{available ? x.help : capabilities.reason ?? "Not available for this Didit application yet."}</span>
                    </span>
                  }
                  checked={on}
                  disabled={readOnly || (!available && !on)}
                  onChange={(e) => toggle(x.key, e.target.checked)}
                />
                {on && (x.key !== "name_from_id" || !value.required.includes("id_document")) ? (
                  <Select label={`${x.label} freshness`} hideLabel className={s.fresh} value={String(value.max_age[mk] ?? "")} disabled={readOnly} options={FRESHNESS} onChange={(e) => setMax(mk, e.target.value)} />
                ) : null}
              </div>
            );
          })}
          <div className={s.checkRow} data-on={ageOn ? "" : undefined}>
            <div className={s.toggleRow}>
              <div className={s.toggleText}>
                <label htmlFor={`${ids}-age`} className={s.rowTitle}>
                  Minimum age
                </label>
                <span className={s.help}>{capabilities.age ? "Checked from the ID’s date of birth, or a selfie age estimate." : capabilities.reason ?? "Not available for this Didit application yet."}</span>
              </div>
              <Switch id={`${ids}-age`} checked={ageOn} disabled={readOnly || (!capabilities.age && !ageOn)} onChange={(e) => set({ ...value, age_min: e.target.checked ? 18 : undefined })} />
            </div>
            {ageOn ? (
              <div className={s.ageRow}>
                <NumberField label="Age ≥" min={1} max={100} value={String(value.age_min ?? "")} readOnly={readOnly} error={errors.age} onChange={(v) => set({ ...value, age_min: v === "" ? 18 : Math.round(Number(v)) })} />
                <Select label="Age proof freshness" className={s.fresh} value={String(value.max_age.age ?? "")} disabled={readOnly} options={FRESHNESS} onChange={(e) => setMax("age", e.target.value)} />
              </div>
            ) : null}
          </div>
        </div>
      </fieldset>

      <div className={s.previewBox} aria-labelledby={`${ids}-steps`} role="group">
        <span className={s.blockTitle} id={`${ids}-steps`}>
          What guests will be asked
        </span>
        <ol className={s.steps}>
          {steps.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
        <span className={s.help}>Checks happen before the request is sent, so approving a guest never asks them to verify again. Valid proofs from earlier events are reused.</span>
      </div>

      {older.length ? (
        <p className={s.note}>
          Applies to new requests.{" "}
          {older.map((p) => `${p.registrations} ${p.registrations === 1 ? "guest" : "guests"} on version ${p.policyVersion}`).join(", ")} keep the checks they accepted.
        </p>
      ) : null}
    </div>
  );
}
