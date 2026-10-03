"use client";
import { actionCsrf } from "../../auth/client";
import { useState, useTransition } from "react";
import { Button, Modal, TextField, toast } from "@didit-events/ui";
import { lifecycleAction } from "../../../app/admin/(events)/events/[id]/(tabs)/settings/actions";
import { handleSessionExpired } from "../system/session";
import { useAdminRouter } from "../useAdminRouter";
import type { EventSettings } from "./types";

export function LifecycleControls({ eventId, status, editVersion }: { eventId: string; status: NonNullable<EventSettings["status"]>; editVersion?: number }) {
  const router = useAdminRouter(), [pending, start] = useTransition();
  const [open, setOpen] = useState(false), [reason, setReason] = useState(""), [error, setError] = useState("");
  if (status === "ended" || status === "cancelled") return null;
  const submit = (operation: "publish" | "cancel") => start(async () => {
    if (operation === "cancel" && !reason.trim()) { setError("Add a cancellation reason."); return; }
    try {
      const result = await lifecycleAction(eventId, operation, reason, actionCsrf(), editVersion);
      if (handleSessionExpired(result)) return;
      if ("error" in result) { setError(result.error === "conflict" ? "This event changed since you opened it. Refresh and try again." : "Couldn’t update the event. Refresh and try again."); return; }
      setOpen(false); router.refresh(); toast({ message: operation === "publish" ? "Event published." : "Event cancelled. Guest notifications queued." });
    } catch { setError("Couldn’t update the event. Try again."); }
  });
  return <div>
    {status === "draft" ? <Button loading={pending} onClick={() => submit("publish")}>Publish event</Button> : <Button variant="danger-outline" onClick={() => { setError(""); setOpen(true); }}>Cancel event</Button>}
    {error && !open ? <p role="alert">{error}</p> : null}
    <Modal open={open} onClose={() => setOpen(false)} title="Cancel this event?" description="All active registrations will be cancelled and guests will be notified." footer={<>
      <Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>Keep event</Button>
      <Button variant="destructive" loading={pending} onClick={() => submit("cancel")}>Confirm cancellation</Button>
    </>}>
      <TextField label="Cancellation reason" value={reason} maxLength={500} onChange={e => setReason(e.currentTarget.value)} />
      {error ? <p role="alert">{error}</p> : null}
    </Modal>
  </div>;
}
