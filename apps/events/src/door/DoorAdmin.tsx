"use client";

import { useActionState } from "react";
import { Button, ButtonLink, TextField } from "@didit-events/ui";
import { adminLinks } from "../admin/links";
import { CsrfField } from "../auth/CsrfField";
import type { DoorAdminResult } from "../../app/admin/(door)/events/[id]/door/actions";
import s from "./Door.module.css";

/**
 * This device already runs the event's door (it holds the door cookie): the Door tab offers the way back into the
 * kiosk and the way out, instead of starting a second door. Resume is a full page load: the kiosk has no admin shell.
 */
export function DoorRunningHere({ eventId, station, end }: { eventId: string; station: string; end: (form: FormData) => Promise<DoorAdminResult> }) {
  const [state, action, pending] = useActionState(async (_: DoorAdminResult | null, form: FormData) => end(form), null);
  return (
    <section className={s.launcher} aria-labelledby="door-here-title">
      <h2 id="door-here-title" className={s.title}>Door mode is running on this device</h2>
      <p className={s.lead}>
        This device is the door <b>{station}</b>. Resume to go back to the full-screen check-in, or end it here to start again or hand the device back.
      </p>
      {state && "error" in state ? <p className={s.error} role="alert">{state.error}</p> : null}
      <form action={action} className={s.actions}>
        <CsrfField />
        <ButtonLink href={adminLinks.kiosk(eventId)}>Resume door mode</ButtonLink>
        <Button type="submit" variant="secondary" loading={pending}>End door mode on this device</Button>
      </form>
    </section>
  );
}

export interface RunningDoor { id: string; station: string; email: string; since: string; lastSeen: string }

/** The doors running now; staff and hosts can end one remotely. */
export function RunningDoors({ doors, canManage, end }: { doors: RunningDoor[]; canManage: boolean; end: (id: string, form: FormData) => Promise<DoorAdminResult> }) {
  // Nothing running: one line, not a card around a sentence.
  if (!doors.length) return <p className={s.meta}>No door is running. Start one on the device at the entrance.</p>;
  return (
    <section className={s.card} aria-labelledby="doors-running-title">
      <h2 id="doors-running-title" className={s.title}>Doors running now</h2>
      <ul className={s.stations}>
        {doors.map((d) => <DoorRow key={d.id} door={d} canManage={canManage} end={end} />)}
      </ul>
    </section>
  );
}

function DoorRow({ door, canManage, end }: { door: RunningDoor; canManage: boolean; end: (id: string, form: FormData) => Promise<DoorAdminResult> }) {
  const [state, action, pending] = useActionState(async (_: DoorAdminResult | null, form: FormData) => end(door.id, form), null);
  return (
    <li className={s.station}>
      <span>
        <b>{door.station}</b>
        <br />
        <span className={s.meta}>Started by {door.email} · {door.since} · last seen {door.lastSeen}</span>
        {state && "error" in state ? <span className={s.error} role="alert"> {state.error}</span> : null}
      </span>
      {canManage ? (
        <form action={action}>
          <CsrfField />
          <Button type="submit" variant="secondary" size="sm" loading={pending}>End door</Button>
        </form>
      ) : null}
    </li>
  );
}

/** The door PIN (staff): ends door mode on a device without a sign-in. Stored hashed; never shown again. */
export function DoorPinForm({ pinSet, save }: { pinSet: boolean; save: (form: FormData) => Promise<DoorAdminResult> }) {
  const [state, action, pending] = useActionState(async (_: DoorAdminResult | null, form: FormData) => save(form), null);
  return (
    <section className={s.card} aria-labelledby="door-pin-title">
      <h2 id="door-pin-title" className={s.title}>Door PIN</h2>
      <p className={s.lead}>{pinSet ? "A PIN is set. Anyone with it can end door mode on a device (they are not signed in)." : "No PIN. Leaving door mode needs a sign-in by a team member with door access."}</p>
      <form action={action} className={s.pinRow}>
        <CsrfField />
        <TextField label={pinSet ? "New PIN" : "PIN"} name="pin" inputMode="numeric" pattern="[0-9]{6,8}" maxLength={8} autoComplete="off" hint="6 to 8 digits" />
        <Button type="submit" variant="secondary" loading={pending}>{pinSet ? "Change PIN" : "Set PIN"}</Button>
        {pinSet ? <Button type="submit" variant="secondary" name="clear" value="1">Remove PIN</Button> : null}
      </form>
      {state && "error" in state ? <p className={s.error} role="alert">{state.error}</p> : state ? <p className={s.lead} role="status">Saved.</p> : null}
    </section>
  );
}
