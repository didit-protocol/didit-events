import type { Metadata } from "next";
import { Banner } from "@didit-events/ui";
import { can } from "@didit-events/core/access/capabilities";
import { roleOn } from "@didit-events/core/access/principal";
import { doorService } from "@didit-events/core/door/service";
import { adminLinks } from "../../../../../../../src/admin/links";
import { eventAccess } from "../../../../../../../src/auth/access";
import { DoorAdmin } from "../../../../../../../src/door/DoorAdminPanel";
import { DoorLauncher } from "../../../../../../../src/door/DoorLauncher";
import { DoorRunningHere } from "../../../../../../../src/door/DoorAdmin";
import { doorPageSession } from "../../../../../../../src/door/http";
import { endDoorHereAction } from "../../../../../(door)/events/[id]/door/actions";
import s from "../../../../../../../src/door/Door.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Door · Didit Events" };

const ENDED: Record<string, string> = {
  DoorSessionExpired: "The door session on this device expired. Start it again to keep checking guests in.",
  DoorSessionEnded: "Door mode ended on this device.",
  DoorAccessRevoked: "The person who started this door no longer has access. Start it again with your account.",
  DoorSessionOtherEvent: "This device was running the door of another event.",
  FaceOff: "Face check-in is off for this event, so the door can’t scan. A host can turn it on in the event’s Door settings.",
};

/**
 * /admin/events/{id}/door: the Door tab of the event, always, for anyone with door.operate: start door mode on this
 * device, the doors running now and the staff PIN. A device that already runs this event's door (its door cookie) gets
 * "Resume door mode" instead of the start form; the full-screen kiosk itself lives at /door/kiosk and never loads here.
 */
export default async function DoorTabPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { actor, event, viewer } = await eventAccess(id, "door.operate", adminLinks.tab(id, "door"));
  // A cancelled event has no door: nothing to start, resume or pair.
  if (event.status === "cancelled") return <div className={s.page}><Banner tone="info">This event was cancelled. The door can’t be opened.</Banner></div>;
  const role = roleOn(viewer, event.id);
  const [here, overview] = await Promise.all([doorPageSession(event.id), doorService.overview(actor, event.id)]);
  const notice = here.door ? undefined : here.ended ? ENDED[here.ended] : undefined;
  const station = typeof sp.station === "string" ? sp.station.slice(0, 40) : undefined;
  return (
    <div className={s.page}>
      {here.door
        ? <DoorRunningHere eventId={event.slug} station={overview.sessions.find((d) => d.id === here.door.doorSessionId)?.station ?? "Door"} end={endDoorHereAction.bind(null, event.slug)} />
        : <DoorLauncher eventId={event.slug} eventName={event.name} initialStation={station} resume={sp.resume === "1" && !!station} notice={notice ?? (event.door.kiosk ? undefined : ENDED.FaceOff)} />}
      <DoorAdmin eventId={event.slug} timeZone={event.timezone} sessions={overview.sessions} pinSet={overview.pinSet} canManage={can(role, "door.manage")} canPin={can(role, "door.pin")} />
    </div>
  );
}
