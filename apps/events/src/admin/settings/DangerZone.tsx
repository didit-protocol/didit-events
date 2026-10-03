"use client";
import { actionCsrf } from "../../auth/client";

import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { Button, ConfirmDialog, toast } from "@didit-events/ui";
import { endEventAction } from "../../../app/admin/(events)/events/[id]/(tabs)/settings/actions";
import { handleSessionExpired } from "../system/session";
import s from "./Settings.module.css";

/** A-11b loads when Delete is pressed: its code stays out of the settings tab's first-load JS. */
const LazyDeleteEventDialog = dynamic(() => import("./DeleteEventDialog").then((m) => m.DeleteEventDialog));

/** A-11 Danger zone: End event (confirm) and Delete event (A-11b: type the name). */
export function DangerZone({ eventId, name, guestCount, ended, editVersion }: { eventId: string; name: string; guestCount: number; ended: boolean; editVersion?: number }) {
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  const end = () =>
    start(async () => {
      const result = await endEventAction(eventId, actionCsrf(), editVersion).catch(() => ({ error: "not_found" as const }));
      setConfirmEnd(false);
      if (handleSessionExpired(result)) return;
      if ("error" in result) toast({ message: "Couldn’t end the event. Try again.", tone: "danger" });
      else toast({ message: `${name} has ended. Kiosks stopped.` });
    });
  return (
    <>
      <div className={s.dangerRow}>
        <div className={s.dangerText}>
          <strong>End event</strong>
          Stops all kiosks and locks the check-in log.
        </div>
        <Button variant="danger-outline" disabled={ended} onClick={() => setConfirmEnd(true)}>
          {ended ? "Ended" : "End event"}
        </Button>
      </div>
      <div className={s.dangerRow}>
        <div className={s.dangerText}>
          <strong>Delete event</strong>
          Removes guests, links and logs. Didit sessions stay in Didit.
        </div>
        <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
          Delete event
        </Button>
      </div>
      <ConfirmDialog
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title={`End ${name} now?`}
        description="Kiosks stop scanning and the check-in log is locked. Guests can’t check in after this."
        confirmLabel="End event"
        destructive
        loading={pending}
        onConfirm={end}
      />
      {confirmDelete ? <LazyDeleteEventDialog eventId={eventId} name={name} guestCount={guestCount} open onClose={() => setConfirmDelete(false)} /> : null}
    </>
  );
}
