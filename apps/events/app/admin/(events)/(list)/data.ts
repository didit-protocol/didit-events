import { eventService } from "@didit-events/core";
import { requireGlobalAccess } from "../../../../src/auth/access";
import { adminModel, adminStatus, fmt } from "../../../../src/server/b4-views";
import type { AdminEventRow } from "../../../../src/admin/list/types";

/** A-02 rows. Staff see every event; an event team member only the events they are on. */
export async function listEvents(): Promise<{ rows: AdminEventRow[]; canCreate: boolean }> {
  const { viewer, actor } = await requireGlobalAccess("admin.enter", "/admin");
  const mine = viewer.kind === "member" ? new Set(viewer.memberships.map(m => m.eventId)) : null;
  const events = (await eventService.list()).filter(event => !mine || mine.has(event.id));
  // Each event's counts are independent: read together (the list order is kept), not one event after another.
  const rows = await Promise.all(events.map(async (event): Promise<AdminEventRow> => {
    const model = (await adminModel(event.id))!;
    return { id: event.id, name: event.name, status: adminStatus(event), month: fmt(event, event.startsAt, { month: "short" }).toUpperCase(), day: fmt(event, event.startsAt, { day: "numeric" }), when: fmt(event, event.startsAt, { dateStyle: "medium", timeStyle: "short" }), where: [event.venue, event.address].filter(Boolean).join(", "), invited: model.approvedCount, verified: model.views.filter(v => v.eligible && v.registration.admission === "approved").length, checkedIn: model.checkins.filter(c => !c.undoneAt).length };
  }));
  return { rows, canCreate: !!actor && ["owner", "admin", "staff"].includes(actor.role) && !actor.scope };
}
