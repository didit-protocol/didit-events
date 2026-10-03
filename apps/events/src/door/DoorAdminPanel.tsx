import { endDoorSessionAction, setDoorPinAction } from "../../app/admin/(door)/events/[id]/door/actions";
import { DoorPinForm, RunningDoors } from "./DoorAdmin";
import { formatClock } from "./kiosk/format";

/** Server half of the launcher page: binds the actions to this event and formats times in its zone. */
export function DoorAdmin({ eventId, timeZone, sessions, pinSet, canManage, canPin }: {
  eventId: string; timeZone: string; pinSet: boolean; canManage: boolean; canPin: boolean;
  sessions: Array<{ id: string; station: string; email: string; created_at: Date; last_seen_at: Date }>;
}) {
  const doors = sessions.map((d) => ({ id: d.id, station: d.station, email: d.email, since: formatClock(d.created_at, timeZone), lastSeen: formatClock(d.last_seen_at, timeZone) }));
  return (
    <>
      <RunningDoors doors={doors} canManage={canManage} end={endDoorSessionAction.bind(null, eventId)} />
      {canPin ? <DoorPinForm pinSet={pinSet} save={setDoorPinAction.bind(null, eventId)} /> : null}
    </>
  );
}
