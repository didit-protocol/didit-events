"use client";

import { CsrfField } from "../../auth/CsrfField";

import { useActionState, useId, useState, type ReactNode } from "react";
import { Button, Textarea, cx } from "@didit-events/ui";
import { CANCEL_REASONS, WITHDRAW_REASONS, type CancelFormState } from "../types";
import { SheetFooter } from "./SheetFooter";
import s from "./Screen.module.css";
import a from "./Account.module.css";

export type CancelAction = (prev: CancelFormState, form: FormData) => Promise<CancelFormState>;

/** R-26: the one-button confirmation (no reason asked). `secondary`: the way out, over the button in the sheet's footer. */
export function CancelConfirmForm({ slug, action, initial = {}, secondary }: { slug: string; action: CancelAction; initial?: CancelFormState; secondary?: ReactNode }) {
  const [, dispatch, pending] = useActionState(action, initial);
  return (
    <form action={dispatch} className={cx(s.form, s.fill)}><CsrfField />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="mode" value="cancel" />
      <input type="hidden" name="reason" value="Not given" />
      <SheetFooter>
        {secondary}
        <Button type="submit" variant="destructive" size="xl" block loading={pending}>
          {pending ? "Cancelling…" : "Cancel my place"}
        </Button>
      </SheetFooter>
    </form>
  );
}

/**
 * U-26…U-28 / U-30: the reason radios, the "Other" note and the destructive button (the only interactive part).
 * `secondary`: the way out, over the button in the sheet's footer.
 */
export function CancelForm({ slug, mode, action, initial = {}, focusNote, secondary }: { slug: string; mode: "cancel" | "withdraw" | "leave_waitlist"; action: CancelAction; initial?: CancelFormState; focusNote?: boolean; secondary?: ReactNode }) {
  const groupId = useId();
  const errId = useId();
  const [state, dispatch, pending] = useActionState(action, initial);
  const [reason, setReason] = useState(initial.reason ?? "");
  const cancel = mode === "cancel";
  const reasons: readonly string[] = cancel ? CANCEL_REASONS : WITHDRAW_REASONS;
  const error = state.error;
  return (
    <form action={dispatch} className={cx(s.form, s.fill)}><CsrfField />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="mode" value={mode} />
      <fieldset className={s.group} aria-describedby={error ? errId : undefined}>
        <legend className={s.groupTitle} id={groupId} style={{ marginBottom: 6 }}>
          {cancel ? "WHY ARE YOU CANCELLING?" : "REASON · OPTIONAL"}
        </legend>
        <div className={s.box}>
          {reasons.map((r) => (
            <label key={r} className={cx(s.row, a.radioRow)}>
              <input className={s.radioInput} type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} required={cancel} />
              <span className={s.rowText}>
                <span className={`${s.rowLabel} ${s.rowLabelRegular}`}>{r}</span>
              </span>
              <span className={a.radioDot} aria-hidden="true" />
            </label>
          ))}
        </div>
      </fieldset>
      {error ? (
        <p id={errId} className={s.codeError} role="alert">
          {error}
        </p>
      ) : null}
      {reason === "Other" ? (
        <Textarea name="note" label="Tell the hosts (optional)" size="xl" maxLength={280} defaultValue={initial.note} autoFocus state={focusNote ? "focus" : undefined} />
      ) : null}
      <SheetFooter>
        {secondary}
        <Button type="submit" variant="destructive" size="xl" block loading={pending} disabled={cancel && !reason}>
          {pending ? (cancel ? "Cancelling…" : "Withdrawing…") : cancel ? "Cancel my place" : "Withdraw request"}
        </Button>
      </SheetFooter>
    </form>
  );
}
