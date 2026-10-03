"use client";
import { actionCsrf } from "../../auth/client";

import { useState, useTransition } from "react";
import { Button } from "@didit-events/ui";
import { resendInviteAction } from "../../../app/admin/team/actions";
import { handleSessionExpired } from "../system/session";
import { RESEND_COPY } from "./labels";
import s from "./Team.module.css";

/** A-19 "Resend invite" on a row nobody has signed in with yet; the outcome is announced next to the button. */
export function ResendInvite({ email, name }: { email: string; name: string }) {
  const [status, setStatus] = useState<string>();
  const [pending, start] = useTransition();
  const resend = () =>
    start(async () => {
      const result = await resendInviteAction(email, actionCsrf());
      if (handleSessionExpired(result)) return;
      if ("ok" in result) return setStatus(RESEND_COPY.sent);
      setStatus(result.error === "cooldown" || result.error === "signed_in" ? RESEND_COPY[result.error] : RESEND_COPY.failed);
    });
  return (
    <span className={s.resend}>
      <span aria-live="polite" className={s.resendStatus}>{status}</span>
      <Button variant="secondary" size="sm" onClick={resend} loading={pending} aria-label={`Resend invite to ${name}`}>
        Resend invite
      </Button>
    </span>
  );
}
