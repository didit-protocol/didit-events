"use client";

import { useEffect, useRef } from "react";
import { SubmitButton } from "@didit-events/ui";
import { VerificationCsrfField } from "./CsrfField";
import s from "../public/components/InviteScreen.module.css";

/** Retry through the same authenticated, CSRF-protected POST as the initial start. */
export function VerificationPreparing({ slug, token, retryKey, action }: {
  slug: string; token?: string; retryKey: string; action: (form: FormData) => Promise<void>;
}) {
  const form = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  useEffect(() => {
    submitting.current = false;
    const timer = setTimeout(() => { if (!submitting.current) form.current?.requestSubmit(); }, 1000);
    return () => clearTimeout(timer);
  }, [retryKey]);
  return <main className={s.body}>
    <h1 className={s.title} role="status">Preparing your verification…</h1>
    <form ref={form} action={action} className={s.bottom} onSubmit={event => {
      // The timer and a manual click must not dispatch two concurrent actions.
      if (submitting.current) event.preventDefault();
      submitting.current = true;
    }}>
      <VerificationCsrfField />
      <input type="hidden" name="slug" value={slug} />
      {token && <input type="hidden" name="token" value={token} />}
      <SubmitButton pendingLabel="Preparing your verification…">Try again</SubmitButton>
    </form>
  </main>;
}
