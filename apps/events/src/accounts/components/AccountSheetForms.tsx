"use client";

import { CsrfField } from "../../auth/CsrfField";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, TextField, cx } from "@didit-events/ui";
import { Callout, SheetFooter } from "./Screen";
import s from "./Screen.module.css";

export interface SheetState {
  error?: string;
}
export type SheetAction = (prev: SheetState, form: FormData) => Promise<SheetState>;

/** U-22: typing DELETE enables the button. `secondary`: the way out, over the button in the sheet's footer. */
export function DeleteAccountForm({ action, typed = "", secondary }: { action: SheetAction; typed?: string; secondary?: ReactNode }) {
  const [state, dispatch, pending] = useActionState(action, {});
  const [value, setValue] = useState(typed);
  const form = useRef<HTMLFormElement>(null);
  // Focus the field on the desktop modal only: on a phone the keyboard would cover the warning and "Keep my account".
  useEffect(() => {
    if (window.matchMedia?.("(min-width: 768px)").matches) form.current?.querySelector<HTMLInputElement>('input[name="confirm"]')?.focus();
  }, []);
  return (
    <form ref={form} action={dispatch} className={cx(s.form, s.fill)}><CsrfField />
      {state.error ? <Callout tone="danger">{state.error}</Callout> : null}
      <TextField name="confirm" label="Type DELETE to confirm" size="xl" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} state={typed ? "focus" : undefined} />
      <SheetFooter>
        {secondary}
        <Button type="submit" variant="destructive" size="xl" block disabled={value.trim() !== "DELETE"} loading={pending}>
          {pending ? "Deleting…" : "Delete account"}
        </Button>
      </SheetFooter>
    </form>
  );
}

/** U-37: the new name. `secondary`: the way out, over the button in the sheet's footer. */
export function NameChangeForm({ action, initialName = "", secondary }: { action: SheetAction; initialName?: string; secondary?: ReactNode }) {
  const [state, dispatch, pending] = useActionState(action, {});
  return (
    <form action={dispatch} className={cx(s.form, s.fill)}><CsrfField />
      <TextField name="fullName" label="New name" size="xl" defaultValue={initialName} autoComplete="name" autoFocus required error={state.error} state={initialName ? "focus" : undefined} />
      <SheetFooter>
        {secondary}
        <Button type="submit" size="xl" block loading={pending}>
          {pending ? "Saving…" : "Change and re-verify later"}
        </Button>
      </SheetFooter>
    </form>
  );
}
