"use client";

import { useActionState } from "react";
import { Banner, Button, TextField } from "@didit-events/ui";
import { CsrfField } from "../../../../src/auth/CsrfField";
import { createTokenAction } from "./actions";
import s from "./tokens.module.css";

/** "Create a personal token": name + button; the new secret is shown once, right under the form. */
export function TokenForm() {
  const [state, action, pending] = useActionState(createTokenAction, {});
  return (
    <section className={s.section} aria-labelledby="create-token">
      <h2 id="create-token" className={s.title}>
        Create a personal token
      </h2>
      <form action={action} className={s.form}>
        <CsrfField />
        <TextField label="Token name" name="name" required maxLength={100} placeholder="Claude Code on my laptop" autoComplete="off" className={s.name} />
        <Button type="submit" loading={pending} disabled={pending} className={s.submit}>
          {pending ? "Creating…" : "Create token"}
        </Button>
      </form>
      {state.error ? (
        <Banner tone="danger" className={s.banner}>
          {state.error}
        </Banner>
      ) : null}
      {state.token ? (
        <div className={s.secret} role="status">
          <p className={s.note}>Copy this token now. It will not be shown again after you leave this page.</p>
          <TextField label="Your new token" readOnly value={state.token} autoComplete="off" spellCheck={false} onFocus={(event) => event.currentTarget.select()} />
          <p className={s.note}>It grants your current staff permissions and expires in 365 days.</p>
        </div>
      ) : null}
    </section>
  );
}
