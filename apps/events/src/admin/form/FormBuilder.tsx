"use client";

import { useId, useRef, useState } from "react";
import { Button, Checkbox, DatePicker, Segmented, Select, TextField, Textarea, TimeField, Switch, cx, normalizeTime } from "@didit-events/ui";
import type { EventForm, FieldRule, FormQuestion, QuestionKind, RegistrationMode } from "../model/contract";
import { CONSENT_MAX, MAX_OPTIONS, MAX_V2_QUESTIONS, OPTION_LABEL_MAX, QUESTION_LABEL_MAX, uuid, type V2Errors } from "./editor";
import s from "./Sections.module.css";

export interface FormBuilderProps {
  value: EventForm;
  onChange: (next: EventForm) => void;
  closesAtLocal: string;
  onClosesAt: (next: string) => void;
  /** Phone is a verification check: the guest verifies one number, the contact field reuses it. */
  phoneIsCheck: boolean;
  errors: V2Errors;
  readOnly?: boolean;
  /** Edit mode after requests exist: changes apply to new requests only. */
  appliesToNew?: boolean;
}

export const QUESTION_KINDS: { kind: QuestionKind; label: string; example: string }[] = [
  { kind: "short", label: "Short text", example: "Hooli" },
  { kind: "long", label: "Long text", example: "I lead fraud tooling and want to compare notes on onboarding." },
  { kind: "url", label: "Link (https)", example: "https://example.com/portfolio" },
  { kind: "yes_no", label: "Yes / no", example: "Yes" },
  { kind: "single", label: "One choice", example: "" },
  { kind: "multi", label: "Several choices", example: "" },
];

const MODES: { value: RegistrationMode; label: string; help: string }[] = [
  { value: "request", label: "Request", help: "Anyone with the link can ask to attend. You approve each request." },
  { value: "open", label: "Open", help: "Guests who complete the form and checks get a place straight away, until it is full." },
  { value: "invite_only", label: "Invite only", help: "Only people you invite can join. They still complete the form and checks." },
];

/** Profile fields every request shares with hosts (docs/event-model-v2.md: an event cannot turn these off). */
export const PROFILE_FIELDS: { label: string; rule: "Required" | "Optional" }[] = [
  { label: "Full name", rule: "Required" },
  { label: "Headline", rule: "Required" },
  { label: "Company", rule: "Required" },
  { label: "Role", rule: "Optional" },
  { label: "Short bio", rule: "Required" },
  { label: "LinkedIn or website", rule: "Required" },
  { label: "Profile photo", rule: "Optional" },
];

const RULES: { value: FieldRule; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "optional", label: "Optional" },
  { value: "required", label: "Required" },
];

function withKind(q: FormQuestion, kind: QuestionKind): FormQuestion {
  const base = { id: q.id, label: q.label, required: q.required };
  if (kind === "single" || kind === "multi") {
    const options = "options" in q && q.options.length ? q.options : [{ id: uuid(), label: "" }, { id: uuid(), label: "" }];
    return { ...base, kind, options };
  }
  return { ...base, kind };
}

/** Example answer for the guest preview. */
function example(q: FormQuestion): string {
  if (q.kind === "single") return q.options[0]?.label || "First choice";
  if (q.kind === "multi") return q.options.slice(0, 2).map((o) => o.label || "Choice").join(", ");
  return QUESTION_KINDS.find((k) => k.kind === q.kind)!.example;
}

/**
 * Registration form builder: who can join, waitlist, closing time, the fixed profile block, the phone contact
 * field (off / optional / required) and up to 20 custom questions of six kinds with stable IDs, reordering and
 * bounded choices, plus a guest preview with example answers. A question keeps its ID for life; changing its
 * kind gives it a new ID (docs/event-model-v2.md: kinds never change under the same ID).
 */
export function FormBuilder({ value, onChange, closesAtLocal, onClosesAt, phoneIsCheck, errors, readOnly, appliesToNew }: FormBuilderProps) {
  const ids = useId();
  const list = useRef<HTMLOListElement>(null);
  const set = (p: Partial<EventForm>) => onChange({ ...value, ...p });
  const setQ = (id: string, next: FormQuestion) => set({ questions: value.questions.map((q) => (q.id === id ? next : q)) });
  const focusQ = (id: string, part = "label") => requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-q="${id}"] [data-part="${part}"] :is(input,select,textarea,button)`)?.focus());

  const add = () => {
    if (value.questions.length >= MAX_V2_QUESTIONS) return;
    const q: FormQuestion = { id: uuid(), label: "", kind: "short", required: false };
    set({ questions: [...value.questions, q] });
    focusQ(q.id);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.questions.length) return;
    const qs = [...value.questions];
    [qs[i], qs[j]] = [qs[j]!, qs[i]!];
    set({ questions: qs });
    focusQ(qs[j]!.id, dir === -1 ? "up" : "down");
  };
  const mode = MODES.find((m) => m.value === value.mode)!;

  // Requests close: "YYYY-MM-DDTHH:MM" in the event zone, edited as a date and a time. The draft keeps what was typed
  // (a time is normalised on blur); the value goes up once both parts are valid, and empties when either is missing.
  const [draft, setDraft] = useState<{ date: string; time: string } | null>(null);
  const [savedDate = "", savedTime = ""] = closesAtLocal.split("T");
  const closes = draft ?? { date: savedDate, time: savedTime.slice(0, 5) };
  const setCloses = (next: { date: string; time: string }) => {
    setDraft(next);
    const time = normalizeTime(next.time);
    onClosesAt(next.date && time ? `${next.date}T${time}` : "");
  };
  const closesMissing = closes.date && !closes.time.trim() ? "Add a time" : !closes.date && closes.time.trim() ? "Pick a date" : undefined;

  return (
    <div className={s.stack}>
      {appliesToNew ? <p className={s.note}>Changes apply to new requests. People who already asked keep the form they answered.</p> : null}
      <div className={s.block}>
        <span className={s.blockTitle} id={`${ids}-mode`}>
          Who can join
        </span>
        <Segmented name={`${ids}-mode`} label="Who can join" className={s.segmented} value={value.mode} onChange={(v) => set({ mode: v as RegistrationMode })} options={MODES.map((m) => ({ value: m.value, label: m.label }))} />
        <span className={s.help}>{mode.help}</span>
      </div>

      <div className={s.toggleRow}>
        <div className={s.toggleText}>
          <label htmlFor={`${ids}-wl`} className={s.rowTitle}>
            Waitlist when full
          </label>
          <span className={s.help}>Guests can join a waitlist once every place is taken.</span>
        </div>
        <Switch id={`${ids}-wl`} checked={value.waitlist} disabled={readOnly} onChange={(e) => set({ waitlist: e.target.checked })} />
      </div>

      <div className={s.block} role="group" aria-labelledby={`${ids}-closes`}>
        <span className={s.blockTitle} id={`${ids}-closes`}>
          Requests close<span className={s.opt}> · optional</span>
        </span>
        <div className={s.closeRow}>
          {/* A date picked first closes requests at the end of that day until a time is chosen. */}
          <DatePicker label="Closing date" value={closes.date} readOnly={readOnly} error={errors.closesAt} onChange={(date) => setCloses({ date, time: date && !closes.time.trim() ? "23:59" : closes.time })} />
          <TimeField label="Closing time" value={closes.time} readOnly={readOnly} error={closesMissing === "Add a time" ? closesMissing : undefined} onChange={(time) => setCloses({ ...closes, time })} />
        </div>
        <div className={s.closeFoot}>
          <span className={s.help}>{closesMissing === "Pick a date" ? "Pick a date to set when requests close. " : null}Event time zone. Empty = when the event starts.</span>
          {closes.date || closes.time ? (
            <button type="button" className={s.link} disabled={readOnly} onClick={() => setCloses({ date: "", time: "" })}>
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className={s.block}>
        <span className={s.blockTitle}>Profile · always shared with hosts</span>
        <ul className={s.fixedList} aria-label="Profile fields">
          {PROFILE_FIELDS.map((f) => (
            <li key={f.label}>
              <span aria-hidden="true" className={s.lock}>
                🔒
              </span>
              <span className={s.fixedLabel}>{f.label}</span>
              <span className={s.fixedRule}>{f.rule}</span>
            </li>
          ))}
        </ul>
        <span className={s.help}>Guests fill their profile once and reuse it for every event. Email is verified at sign-in.</span>
      </div>

      <div className={s.block}>
        <span className={s.blockTitle} id={`${ids}-phone`}>
          Phone number
        </span>
        {phoneIsCheck ? (
          <span className={s.help}>Required and verified: phone is one of this event’s checks, so guests confirm one number by SMS.</span>
        ) : (
          <>
            <Segmented name={`${ids}-phone`} label="Phone number" size="sm" className={s.segmented} value={value.fields.phone_number} onChange={(v) => set({ fields: { phone_number: v as FieldRule } })} options={RULES} />
            <span className={s.help}>A contact number the guest types. It is not verified; add Phone under Verification for that.</span>
          </>
        )}
      </div>

      <div className={s.block}>
        <span className={s.blockTitle} id={`${ids}-q`}>
          Custom questions <span className={s.opt}>· {value.questions.length}/{MAX_V2_QUESTIONS}</span>
        </span>
        {value.questions.length ? (
          <ol ref={list} className={s.qList} aria-labelledby={`${ids}-q`}>
            {value.questions.map((q, i) => (
              <li key={q.id} className={s.qCard} data-q={q.id}>
                <div className={s.qHead}>
                  <span className={s.qNum} aria-hidden="true">
                    {i + 1}
                  </span>
                  <div className={s.qLabel} data-part="label">
                    <TextField
                      label={`Question ${i + 1}`}
                      hideLabel
                      placeholder="e.g. What do you want to get out of the evening?"
                      value={q.label}
                      maxLength={QUESTION_LABEL_MAX + 20}
                      readOnly={readOnly}
                      error={errors[`q:${q.id}:label`]}
                      onChange={(e) => setQ(q.id, { ...q, label: e.target.value })}
                    />
                  </div>
                  <div className={s.qKind} data-part="kind">
                    <Select
                      label={`Answer type for question ${i + 1}`}
                      hideLabel
                      value={q.kind}
                      disabled={readOnly}
                      options={QUESTION_KINDS.map((k) => ({ value: k.kind, label: k.label }))}
                      onChange={(e) => {
                        const kind = e.target.value as QuestionKind;
                        // A different kind is a different question: new stable ID.
                        setQ(q.id, { ...withKind(q, kind), id: kind === q.kind ? q.id : uuid() });
                      }}
                    />
                  </div>
                </div>
                {q.kind === "single" || q.kind === "multi" ? (
                  <fieldset className={s.options}>
                    <legend className={s.srOnly}>Choices for question {i + 1}</legend>
                    {q.options.map((o, oi) => (
                      <div key={o.id} className={s.optionRow}>
                        <span aria-hidden="true" className={s.optionMark}>
                          {q.kind === "single" ? "○" : "☐"}
                        </span>
                        <TextField
                          label={`Choice ${oi + 1}`}
                          hideLabel
                          placeholder={`Choice ${oi + 1}`}
                          value={o.label}
                          maxLength={OPTION_LABEL_MAX + 10}
                          readOnly={readOnly}
                          onChange={(e) => setQ(q.id, { ...q, options: q.options.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)) })}
                        />
                        <button type="button" className={s.iconBtn} aria-label={`Remove choice ${oi + 1}`} disabled={readOnly || q.options.length <= 2} onClick={() => setQ(q.id, { ...q, options: q.options.filter((x) => x.id !== o.id) })}>
                          ×
                        </button>
                      </div>
                    ))}
                    {errors[`q:${q.id}:options`] ? <span className={s.error}>{errors[`q:${q.id}:options`]}</span> : null}
                    {q.options.length < MAX_OPTIONS ? (
                      <button type="button" className={s.link} disabled={readOnly} onClick={() => setQ(q.id, { ...q, options: [...q.options, { id: uuid(), label: "" }] })}>
                        + Add choice
                      </button>
                    ) : null}
                  </fieldset>
                ) : null}
                <div className={s.qFoot}>
                  <Checkbox label="Required" checked={q.required} disabled={readOnly} onChange={(e) => setQ(q.id, { ...q, required: e.target.checked })} />
                  <span className={s.qTools}>
                    <span data-part="up">
                      <button type="button" className={s.iconBtn} aria-label={`Move question ${i + 1} up`} disabled={readOnly || i === 0} onClick={() => move(i, -1)}>
                        ↑
                      </button>
                    </span>
                    <span data-part="down">
                      <button type="button" className={s.iconBtn} aria-label={`Move question ${i + 1} down`} disabled={readOnly || i === value.questions.length - 1} onClick={() => move(i, 1)}>
                        ↓
                      </button>
                    </span>
                    <button type="button" className={cx(s.link, s.danger)} disabled={readOnly} onClick={() => set({ questions: value.questions.filter((x) => x.id !== q.id) })}>
                      Remove
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className={s.help}>No custom questions. Guests only share their profile.</p>
        )}
        {errors.questions ? <span className={s.error}>{errors.questions}</span> : null}
        <Button variant="secondary" size="sm" className={s.addBtn} onClick={add} disabled={readOnly || value.questions.length >= MAX_V2_QUESTIONS}>
          + Add question
        </Button>
      </div>

      <Textarea
        label={<>Event consent{<span className={s.opt}> · optional</span>}</>}
        placeholder="e.g. Photos and video are taken during the evening."
        rows={3}
        value={value.consent_text ?? ""}
        readOnly={readOnly}
        maxLength={CONSENT_MAX + 50}
        hint={value.consent_text ? `${Array.from(value.consent_text).length}/${CONSENT_MAX} · guests tick a box to accept it` : "Guests tick a box to accept it before sending their request."}
        error={errors.consent}
        onChange={(e) => set({ consent_text: e.target.value ? e.target.value : null })}
      />

      {value.questions.length ? (
        <details className={s.previewBox}>
          <summary>Preview with example answers</summary>
          <dl className={s.kv}>
            {value.questions.map((q) => (
              <div key={q.id} className={s.kvRow}>
                <dt>
                  {q.label.trim() || "Untitled question"}
                  {q.required ? " *" : ""}
                </dt>
                <dd>{example(q)}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}
