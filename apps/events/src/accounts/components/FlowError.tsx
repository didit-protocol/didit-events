"use client";

import { CONTACT_EMAIL } from "../../config";

import { Button, ButtonLink, StatusIcon } from "@didit-events/ui";
import s from "./FlowError.module.css";

// Kept light on purpose: error boundaries ship with the route's first-load JS.
export function FlowError({ reset }: { reset: () => void }) {
  return (
    <div className={s.page}>
      <main className={s.card} role="alert">
        <StatusIcon tone="error" icon="warning" size={56} />
        <h1 className={s.title}>Something went wrong</h1>
        <p className={s.lead}>
          We couldn’t load this page. Try again, or write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> if it keeps happening.
        </p>
        <div className={s.actions}>
          <Button size="lg" onClick={reset}>
            Try again
          </Button>
          <ButtonLink href="/" variant="secondary" size="lg">
            Back to events
          </ButtonLink>
        </div>
      </main>
    </div>
  );
}
