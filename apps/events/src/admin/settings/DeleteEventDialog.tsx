"use client";
import { actionCsrf } from "../../auth/client";

import { useState, useTransition } from "react";
import { Button, Modal, TextField } from "@didit-events/ui";
import { deleteEventAction } from "../../../app/admin/(events)/events/[id]/(tabs)/settings/actions";
import { handleSessionExpired } from "../system/session";
import s from "./Settings.module.css";

export interface DeleteEventDialogProps {
  eventId: string;
  name: string;
  guestCount: number;
  open: boolean;
  /** Optional so the frame gallery can render it from a server component. */
  onClose?: () => void;
  /** Frame gallery: rendered in place with a partly typed name and the focus ring. */
  inline?: boolean;
  typed?: string;
}

/** A-11b: "Delete Barcelona Office Opening?"; the button enables only when the exact name is typed. */
export function DeleteEventDialog({ eventId, name, guestCount, open, onClose, inline, typed = "" }: DeleteEventDialogProps) {
  const [value, setValue] = useState(typed);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const matches = value.trim() === name;
  const close = () => {
    setValue("");
    setError(undefined);
    onClose?.();
  };
  const confirm = () =>
    start(async () => {
      const result = await deleteEventAction(eventId, value, actionCsrf());
      if (!result) return;
      if (handleSessionExpired(result)) return close();
      if ("error" in result) setError("Couldn’t delete the event. Reload the page and try again.");
    });
  return (
    <Modal
      open={open}
      inline={inline}
      onClose={close}
      role="alertdialog"
      title={`Delete ${name}?`}
      description={error ?? `This removes ${guestCount} guests, their links and the check-in log. It can't be undone.`}
      width={480}
      className={s.deleteModal}
      footer={
        <>
          <Button variant="secondary" onClick={close} data-autofocus="">
            Cancel
          </Button>
          <Button variant="destructive" disabled={!matches} loading={pending} onClick={confirm}>
            Delete event
          </Button>
        </>
      }
    >
      <TextField
        label="Type the event name to confirm"
        value={value}
        autoComplete="off"
        spellCheck={false}
        state={inline ? "focus" : undefined}
        onChange={(e) => setValue(e.currentTarget.value)}
      />
    </Modal>
  );
}
