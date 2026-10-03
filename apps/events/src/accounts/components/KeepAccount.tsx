"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button, cx } from "@didit-events/ui";
import { CsrfField } from "../../auth/CsrfField";
import { fullDate } from "../format";
import { Callout, FlowIcon, Lead, SheetFooter, Title, styles as s } from "./Screen";
import k from "./KeepAccount.module.css";

export interface KeepState {
  error?: string;
  kept?: boolean;
}
export type KeepAction = (prev: KeepState, form: FormData) => Promise<KeepState>;

/**
 * "Keep my account" as one form around the screen (`children`: its text; `secondary`: the quiet action over the
 * button in the footer): with `next` the action returns there; without it `onKept` carries on in place.
 */
function KeepForm({ action, next, onKept, secondary, children }: { action: KeepAction; next?: string; onKept?: () => void; secondary?: React.ReactNode; children: React.ReactNode }) {
  const [state, dispatch, pending] = useActionState(action, {});
  useEffect(() => {
    if (state.kept) onKept?.();
  }, [state.kept, onKept]);
  return (
    <form action={dispatch} className={s.fill}>
      <CsrfField />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className={cx(s.fill, s.fillCenter)}>
        {children}
        {state.error ? <Callout tone="danger">{state.error}</Callout> : null}
      </div>
      <SheetFooter>
        {secondary}
        <Button type="submit" size="xl" block loading={pending || state.kept}>
          {pending || state.kept ? "Keeping your account…" : "Keep my account"}
        </Button>
      </SheetFooter>
    </form>
  );
}

/** Kept in place (the join modal): the server re-renders the page, and the modal carries on with the request. */
function KeepInPlace(props: { action: KeepAction; secondary?: React.ReactNode; children: React.ReactNode }) {
  const router = useRouter();
  return <KeepForm {...props} onKept={router.refresh} />;
}

/**
 * The account is being deleted (v5 grace period): one calm screen, one action. Used by /me/deleting and the join
 * modal; keeping it puts back the profile, the face check and every place, then the guest carries on.
 */
export function KeepAccountPanel({ titleId, graceUntil, action, next, eventName, onKept, secondary }: { titleId: string; graceUntil: string; action: KeepAction; next?: string; eventName?: string; onKept?: () => void; secondary?: React.ReactNode }) {
  const text = (
    <div className={k.panel}>
      <FlowIcon status="warning" />
      <Title id={titleId} size={24}>
        Your account is being deleted
      </Title>
      <Lead>
        {`It will be deleted for good on ${fullDate(graceUntil)}. Keep it and everything comes back: your profile, your face check and your places${eventName ? `, and you carry on joining ${eventName}` : ""}.`}
      </Lead>
    </div>
  );
  return next || onKept ? (
    <KeepForm action={action} next={next} onKept={onKept} secondary={secondary}>
      {text}
    </KeepForm>
  ) : (
    <KeepInPlace action={action} secondary={secondary}>
      {text}
    </KeepInPlace>
  );
}
