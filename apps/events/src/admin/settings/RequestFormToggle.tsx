"use client";
import { actionCsrf } from "../../auth/client";

import { useOptimistic, useTransition } from "react";
import { Switch, toast } from "@didit-events/ui";
import { setRequestFormAction } from "../../../app/admin/(events)/events/[id]/(tabs)/settings/actions";
import { handleSessionExpired } from "../system/session";

/** A-11 "Request form" switch (optimistic). */
export function RequestFormToggle({ eventId, open, editVersion }: { eventId: string; open: boolean; editVersion?: number }) {
  const [on, setOn] = useOptimistic(open);
  const [pending, start] = useTransition();
  return (
    <Switch
      aria-label="Request form open"
      checked={on}
      disabled={pending}
      onChange={(e) => {
        const next = e.currentTarget.checked;
        start(async () => {
          setOn(next);
          const result = await setRequestFormAction(eventId, next, actionCsrf(), editVersion).catch(() => ({ error: "invalid" as const }));
          if (handleSessionExpired(result)) return;
          if ("error" in result) toast({ message: "Couldn’t update the request form. Try again.", tone: "danger" });
          else toast({ message: next ? "Request form is open." : "Request form is closed." });
        });
      }}
    />
  );
}
