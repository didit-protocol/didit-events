"use client";

import { useActionState, useRef, useState } from "react";
import { Button, CodeInput } from "@didit-events/ui";
import { CsrfField } from "../../../src/auth/CsrfField";
import { GuestScreen, Lead, Title, styles as s } from "../../../src/accounts/components/Screen";
import { ResendTimer } from "../../../src/accounts/components/CodeParts";
import { reproveAction } from "./actions";

export function ReproofForm({ email, next }: { email: string; next: string }) {
  const [state, action, pending] = useActionState(reproveAction, {}), [code, setCode] = useState("");
  const resend = useRef<HTMLFormElement>(null);
  return <GuestScreen header="events" sheet={{ variant: "account" }} labelledBy="reproof-title" closeHref={next}>
    <Title id="reproof-title">Confirm it’s you</Title>
    <Lead>{state.sent ? `Enter the email code sent to ${email}. We’ll then complete your request.` : `For this change, please confirm your email. We’ll send a quick code to ${email}.`}</Lead>
    <form action={action} className={s.form}>
      <CsrfField />
      <input type="hidden" name="intent" value={state.sent ? "verify" : "send"} />
      {state.sent ? <CodeInput name="code" label="6-digit code" value={code} onChange={setCode} autoFocus /> : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
      <Button type="submit" size="lg" block loading={pending} disabled={state.sent && code.length !== 6}>{state.sent ? "Confirm and continue" : "Email me a code"}</Button>
    </form>
    {state.sent ? <>
      <form action={action} ref={resend} hidden><CsrfField /><input type="hidden" name="intent" value="resend" /></form>
      <ResendTimer key={state.sentAt ?? state.error} seconds={state.resendInSeconds ?? 0} onResend={() => { setCode(""); resend.current?.requestSubmit(); }} />
    </> : null}
  </GuestScreen>;
}
