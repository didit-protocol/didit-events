import { EventsList } from "../../../../src/admin/list/EventsList";

// A-02b. The counts are not known yet, so the chips show their labels only. The viewer's role is not known either:
// the skeleton never offers "New event" (event team members cannot create events).
export default function EventsLoading() {
  return <EventsList events={null} q="" status="all" canCreate={false} />;
}
