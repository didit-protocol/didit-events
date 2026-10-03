import { requireStaffAccess } from "../../../../../src/auth/access";
import type { Metadata } from "next";
import { placesEnabled } from "../../../../../src/server/places";
import { EventForm } from "../../../../../src/admin/form/EventForm";
import { adminLinks } from "../../../../../src/admin/links";
import { createEventAction } from "./actions";
import { getNewEventDefaults } from "./data";

export const metadata: Metadata = { title: "New event · Didit Events" };

/** A-03 New event (A-03a empty → A-03b errors → A-03c saving). */
export default async function NewEventPage() {
  await requireStaffAccess("events.create", "/admin/events/new");
  const { values, capabilities, emailTemplates } = await getNewEventDefaults();
  return <EventForm mode="new" crumb="New event" cancelHref={adminLinks.home()} action={createEventAction} initialState={{ status: "idle", values }} placesEnabled={placesEnabled()} capabilities={capabilities} emailTemplates={emailTemplates} />;
}
