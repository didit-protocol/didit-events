"use client";

import { useEffect, useState } from "react";
import { ButtonLink, Modal } from "@didit-events/ui";
import { adminLinks } from "../links";
import { SYSTEM_COPY } from "./copy";
import { SESSION_EXPIRED_EVENT } from "./session";
import s from "./System.module.css";

/**
 * A-13f. Opens on `notifySessionExpired()`. "Continue with Google" signs in again in a new tab (so the unsaved
 * changes on this page stay put) and the modal closes when the user comes back to this tab.
 */
export function SessionExpiredModal({ open: forced, inline }: { open?: boolean; inline?: boolean }) {
  const [open, setOpen] = useState(Boolean(forced));
  const [next, setNext] = useState<string>();
  const [away, setAway] = useState(false);

  useEffect(() => {
    const onExpired = () => {
      setNext(window.location.pathname + window.location.search);
      setOpen(true);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => {
    if (!away) return;
    const onBack = () => {
      setAway(false);
      setOpen(false);
    };
    window.addEventListener("focus", onBack);
    return () => window.removeEventListener("focus", onBack);
  }, [away]);

  const copy = SYSTEM_COPY.sessionExpired;
  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      dismissible={false}
      inline={inline}
      width={420}
      title={copy.title}
      description={copy.body}
      className={s.modal}
      footer={
        <ButtonLink size="lg" block href={adminLinks.login(next)} target="_blank" rel="noopener" onClick={() => setAway(true)}>
          {copy.cta}
        </ButtonLink>
      }
    />
  );
}
