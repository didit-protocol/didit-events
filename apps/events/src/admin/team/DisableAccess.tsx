"use client";
import { actionCsrf } from "../../auth/client";

import { useState, useTransition } from "react";
import { Button, ConfirmDialog } from "@didit-events/ui";
import { disableStaffAction } from "../../../app/admin/team/actions";
import { handleSessionExpired } from "../system/session";

const FAILED = "Couldn’t disable access. Reload the page and try again.";

/** A-19 "Disable" → A-19c confirm → A-19d disabled row (the action revalidates the page). */
export function DisableAccess({ email, name, open: forced, inline }: { email: string; name: string; open?: boolean; inline?: boolean }) {
  const [open, setOpen] = useState(Boolean(forced));
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const confirm = () =>
    start(async () => {
      const result = await disableStaffAction(email, actionCsrf());
      if (handleSessionExpired(result)) return setOpen(false);
      if ("error" in result) return setError(FAILED);
      setOpen(false);
    });
  return (
    <>
      {inline ? null : (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)} aria-label={`Disable access for ${name}`}>
          Disable
        </Button>
      )}
      <ConfirmDialog
        open={open}
        inline={inline}
        onClose={() => {
          setOpen(false);
          setError(undefined);
        }}
        title={`Disable access for ${name}?`}
        description={error ?? `${name} is signed out everywhere and can’t open the admin until an owner or admin restores access. Their events and check-ins stay.`}
        confirmLabel="Disable access"
        destructive
        loading={pending}
        onConfirm={confirm}
      />
    </>
  );
}
