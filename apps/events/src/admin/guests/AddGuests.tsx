"use client";
import { actionCsrf } from "../../auth/client";
import { CsrfField } from "../../auth/CsrfField";

import { useActionState, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Button, EmailField, Modal, ProgressBar, Tabs, Textarea, TextField, Switch, toast } from "@didit-events/ui";
import { useAdminRouter } from "../useAdminRouter";
import { addGuestAction, addGuestBatchAction, type AddOneState } from "../../../app/admin/(events)/events/[id]/(tabs)/guests/actions";
import { handleSessionExpired, notifySessionExpired } from "../system/session";
import { csvDataUrl, PASTE_REASON, skippedCsv } from "./csv";
import { doneSummary, parseGuestPaste, problemChips } from "./paste";
import type { PasteRow } from "./types";
import s from "./AddGuests.module.css";

const BATCH = 25;
const PREVIEW_ROWS = 6;
const PLACEHOLDER = "María, García, maria.garcia@gmail.com\nOliver, Bennett, oliver.bennett@lucerne.test";

export type AddStep = "one" | "paste" | "preview" | "adding" | "done";

export interface AddGuestsProps {
  eventId: string;
  closeHref: string;
  existingEmails: string[];
  /** Frame gallery: the drawn state, rendered in place. */
  initial?: { step: AddStep; text?: string; progress?: { done: number; total: number }; result?: { added: number; waitlisted?: number; skipped: PasteRow[] } };
  inline?: boolean;
}

/** A-07 Add guests: one guest, or paste a list → preview (with errors) → adding → done. */
export function AddGuests({ eventId, closeHref, existingEmails, initial, inline }: AddGuestsProps) {
  const router = useAdminRouter();
  const [step, setStep] = useState<AddStep>(initial?.step ?? "one");
  const [text, setText] = useState(initial?.text ?? "");
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState(initial?.progress ?? { done: 0, total: 0 });
  const [result, setResult] = useState(initial?.result ?? { added: 0, waitlisted: 0, skipped: [] as PasteRow[] });
  const [failure, setFailure] = useState<string>();
  const [oneState, oneAction, onePending] = useActionState<AddOneState, FormData>(addGuestAction.bind(null, eventId), { status: "idle" });
  const oneKey = oneState.status === "invalid" ? JSON.stringify([oneState.values, oneState.errors]) : oneState.status;
  // What was typed into the current form; a remounted form (new key) starts from the returned values.
  const [typed, setTyped] = useState<{ key: string; ready: boolean }>();
  const oneReady = typed?.key === oneKey ? typed.ready : oneState.status === "invalid" && Boolean(oneState.values.first && oneState.values.email);
  const formRef = useRef<HTMLFormElement>(null);
  const parsed = useMemo(() => parseGuestPaste(text, existingEmails), [text, existingEmails]);

  const close = () => router.push(closeHref, { scroll: false });
  const tab = step === "one" ? "one" : "paste";

  useEffect(() => {
    if (oneState.status === "added" || oneState.status === "waitlisted") {
      toast({ message: `${oneState.name} ${oneState.status}.` });
      router.push(closeHref, { scroll: false });
    }
    if (oneState.status === "error" && oneState.message === "session_expired") notifySessionExpired();
  }, [oneState, router, closeHref]);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1_000_000) return setFailure("That file is over 1 MB. Split it and try again.");
    setFailure(undefined);
    setText(await file.text());
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void readFile(e.dataTransfer.files[0]);
  };

  const add = async () => {
    const ready = parsed.rows.filter((r) => r.status === "ready");
    const skipped = parsed.rows.filter((r) => r.status !== "ready");
    setStep("adding");
    setProgress({ done: 0, total: ready.length });
    let added = 0, waitlisted = 0;
    for (let i = 0; i < ready.length; i += BATCH) {
      const chunk = ready.slice(i, i + BATCH);
      const res = await addGuestBatchAction(eventId, chunk.map(({ first, last, email }) => ({ first, last, email })), true, actionCsrf());
      if (handleSessionExpired(res)) return setStep("preview");
      if ("error" in res) {
        setFailure(`Stopped after ${added} guests. Try the rest again.`);
        break;
      }
      added += res.added;
      waitlisted += res.waitlisted;
      const invalid = new Map(res.invalid.map((x) => [x.row, x.reason]));
      chunk.forEach((r, row) => {
        const reason = invalid.get(row);
        if (reason) skipped.push({ ...r, status: reason });
        else if (res.duplicates.includes(r.email)) skipped.push({ ...r, status: "duplicate" });
      });
      setProgress({ done: Math.min(ready.length, i + chunk.length), total: ready.length });
    }
    setResult({ added, waitlisted, skipped });
    setStep("done");
    router.refresh();
  };

  const chips = problemChips(parsed);
  const summary = doneSummary(result.added, result.skipped);

  const footer =
    step === "one" ? (
      <>
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button onClick={() => formRef.current?.requestSubmit()} disabled={!oneReady || onePending} loading={onePending}>
          Add guest
        </Button>
      </>
    ) : step === "paste" ? (
      <>
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button disabled={!text.trim() || Boolean(parsed.error)} onClick={() => setStep("preview")}>
          Add guests
        </Button>
      </>
    ) : step === "preview" ? (
      <>
        <Button variant="secondary" onClick={() => setStep("paste")}>
          Back
        </Button>
        <Button disabled={parsed.ready === 0} onClick={() => void add()}>
          Add {parsed.ready} guest{parsed.ready === 1 ? "" : "s"}
        </Button>
      </>
    ) : step === "adding" ? (
      <>
        <Button variant="secondary" disabled>
          Cancel
        </Button>
        <Button disabled>Adding…</Button>
      </>
    ) : (
      <>
        <Button
          variant="secondary"
          onClick={() => {
            setText("");
            setStep("paste");
          }}
        >
          Add more
        </Button>
        <Button onClick={close}>Done</Button>
      </>
    );

  return (
    <Modal open inline={inline} onClose={close} title="Add guests" closeLabel="Close" width={640} className={s.modal} footer={footer} dismissible={step !== "adding"}>
      <Tabs
        label="How to add guests"
        className={s.tabs}
        value={tab}
        onChange={(id) => (step === "adding" ? undefined : setStep(id === "one" ? "one" : "paste"))}
        items={[
          { id: "one", label: "One guest" },
          { id: "paste", label: "Paste a list" },
        ]}
      />
      <div className={s.body}>
        {step === "one" ? (
          <form
            // Remount on each result so every field (incl. the note and the send toggle) starts from the returned values.
            key={oneKey}
            ref={formRef}
            action={oneAction}
            style={{ display: "contents" }}
            onInput={(e) => {
              const f = e.currentTarget;
              setTyped({ key: oneKey, ready: Boolean((f.elements.namedItem("first") as HTMLInputElement)?.value.trim() && (f.elements.namedItem("email") as HTMLInputElement)?.value.trim()) });
            }}
          ><CsrfField />
            <OneGuestFields state={oneState} inline={inline} />
            {oneState.status === "error" && oneState.message !== "session_expired" ? <p className={s.error}>{oneState.message}</p> : null}
          </form>
        ) : null}

        {step === "paste" ? (
          <>
            <div
              className={s.paste}
              data-drag={drag ? "" : undefined}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
            >
              <Textarea label="Paste CSV or rows: first, last, email" placeholder={PLACEHOLDER} value={text} spellCheck={false} onChange={(e) => setText(e.currentTarget.value)} error={parsed.error ?? failure} />
            </div>
            <p className={s.hint}>
              Or drop a .csv file here. Header row is optional.{" "}
              <label>
                Choose file
                <input type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => void readFile(e.currentTarget.files?.[0])} />
              </label>
            </p>
          </>
        ) : null}

        {step === "preview" ? (
          <>
            <div className={s.chips} aria-live="polite">
              <span className={`${s.chip} ${s.ok}`}>{parsed.ready} ready</span>
              {chips.map((c) => (
                <span key={c.label} className={`${s.chip} ${c.tone === "danger" ? s.bad : s.dup}`}>
                  {c.label}
                </span>
              ))}
            </div>
            <div className={s.preview} role="table" aria-label="Rows to add">
              <div role="row" className={`${s.pRow} ${s.pHead}`}>
                <span role="columnheader">First</span>
                <span role="columnheader">Last</span>
                <span role="columnheader">Email</span>
                <span role="columnheader">
                  <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Result</span>
                </span>
              </div>
              {parsed.rows.slice(0, PREVIEW_ROWS).map((r) => (
                <div key={r.line} role="row" className={s.pRow} data-status={r.status}>
                  <span role="cell">{r.first}</span>
                  <span role="cell">{r.last}</span>
                  <span role="cell">{r.email}</span>
                  <span role="cell" className={s.pNote}>
                    {PASTE_REASON[r.status]}
                  </span>
                </div>
              ))}
              {parsed.rows.length > PREVIEW_ROWS ? <div className={s.more}>+ {parsed.rows.length - PREVIEW_ROWS} more rows</div> : null}
            </div>
          </>
        ) : null}

        {step === "adding" ? (
          <div className={s.adding} aria-live="polite">
            <b>Adding guests…</b>
            <ProgressBar value={progress.done} max={progress.total || 1} label="Adding guests" valueText={`${progress.done} of ${progress.total}`} />
            <span>
              {progress.done} of {progress.total} · creating Didit verification links
            </span>
          </div>
        ) : null}

        {step === "done" ? (
          <div className={s.done} role="status">
            <span className={s.check} aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0E7A3D" strokeWidth="2">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <b>{summary.title}</b>
            <p>
              {summary.detail}{result.waitlisted ? ` ${result.waitlisted} waitlisted because the event is full.` : ""}
              {result.skipped.length ? (
                <>
                  {" "}
                  <a href={csvDataUrl(skippedCsv(result.skipped))} download="skipped-guests.csv">
                    Download skipped rows
                  </a>
                </>
              ) : null}
            </p>
            {result.skipped.length ? (
              <div className={`${s.preview} ${s.skipped}`} role="table" aria-label="Skipped rows">
                {result.skipped.slice(0, PREVIEW_ROWS).map((r) => (
                  <div key={r.line} role="row" className={s.pRow} data-status={r.status}>
                    <span role="cell">{r.first}</span>
                    <span role="cell">{r.last}</span>
                    <span role="cell">{r.email}</span>
                    <span role="cell" className={s.pNote}>
                      {PASTE_REASON[r.status]}
                    </span>
                  </div>
                ))}
                {result.skipped.length > PREVIEW_ROWS ? <div className={s.more}>+ {result.skipped.length - PREVIEW_ROWS} more rows</div> : null}
              </div>
            ) : null}
            {failure ? <p className={s.error}>{failure}</p> : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/** A-07 "One guest" fields. After an `invalid` result every field, the note and the send toggle keep what was sent. */
export function OneGuestFields({ state, inline }: { state: AddOneState; inline?: boolean }) {
  const v = state.status === "invalid" ? state.values : undefined;
  const errors = state.status === "invalid" ? state.errors : {};
  return (
    <>
      <div className={s.row2}>
        <TextField name="first" label="First name" autoComplete="off" autoFocus={!inline} state={inline ? "focus" : undefined} defaultValue={v?.first ?? ""} error={errors.first} />
        <TextField name="last" label="Last name" autoComplete="off" defaultValue={v?.last ?? ""} />
      </div>
      <EmailField name="email" label="Email" placeholder="name@company.com" defaultValue={v?.email ?? ""} error={errors.email} />
      <Textarea
        name="note"
        className={s.note}
        maxLength={280}
        defaultValue={v?.note ?? ""}
        label={
          <>
            Note <span style={{ color: "var(--mid-high)", fontWeight: 400 }}>· optional, only staff see it</span>
          </>
        }
      />
      <label className={s.sendBox}>
        <span className={s.sendText}>
          <b>Send the verification link now</b>
          <span>Emails the guest their personal Didit link.</span>
        </span>
        <Switch name="send" defaultChecked={v ? v.send : true} aria-label="Send the verification link now" />
      </label>
    </>
  );
}
