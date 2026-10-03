/** A-03 New / edit event frames (design/01 Admin, 1440×1320), rendered with the route's EventForm. */
import type { FrameDef } from "@didit-events/ui/frames/registry";
import { updateEventAction } from "../../../app/admin/(events)/events/[id]/edit/actions";
import { createEventAction } from "../../../app/admin/(events)/events/new/actions";
import { adminFrame } from "../frame";
import { ALBERTO, BCN_OPENING, FIXED_NOW } from "../fixtures";
import { adminLinks } from "../links";
import { AdminShell } from "../shell/AdminShell";
import { EventForm } from "./EventForm";
import { BCN_WELCOME, DEFAULT_WELCOME, FORM_STATES } from "./fixtures";

const W = 1440;
const H = 1320;

const newForm = (state: keyof typeof FORM_STATES, pending?: boolean) =>
  function NewEventFrame() {
    return (
      <AdminShell fill active="events" user={ALBERTO}>
        <EventForm mode="new" crumb="New event" cancelHref={adminLinks.home()} action={createEventAction} initialState={FORM_STATES[state]} welcome={DEFAULT_WELCOME("")} forcePending={pending} />
      </AdminShell>
    );
  };

export const formFrames: FrameDef[] = [
  adminFrame("A-03a", "A-03 New event / empty", W, H, newForm("empty")),
  adminFrame("A-03b", "A-03 New event / validation errors", W, H, newForm("errors")),
  adminFrame("A-03c", "A-03 New event / saving", W, H, newForm("saving", true)),
  adminFrame("A-03d", "A-03 Edit event / saved", W, H, () => (
    <AdminShell fill active="events" user={ALBERTO}>
      <EventForm
        mode="edit"
        crumb={BCN_OPENING.name}
        cancelHref={adminLinks.event(BCN_OPENING.id)}
        action={updateEventAction}
        initialState={FORM_STATES.saved}
        eventId={BCN_OPENING.id}
        welcome={BCN_WELCOME}
        now={FIXED_NOW}
      />
    </AdminShell>
  )),
];
