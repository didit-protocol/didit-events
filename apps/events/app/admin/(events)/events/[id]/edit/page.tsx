import { requireEventAccess } from "../../../../../../src/auth/access";
import { requireEvent } from "../data";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { placesEnabled } from "../../../../../../src/server/places";
import { EventForm } from "../../../../../../src/admin/form/EventForm";
import { adminLinks } from "../../../../../../src/admin/links";
import { updateEventAction } from "./actions";
import { getEventForEdit } from "./data";

export const metadata: Metadata = { title: "Edit event · Didit Events" };

/** A-03 Edit event (A-03d saved). Outside the (tabs) group: the form has its own header, no event tabs. */
export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEventAccess((await params).id, "event.edit");
  const { id: idOrSlug } = await params;
  const { slug: id, status } = await requireEvent(idOrSlug);
  const event = await getEventForEdit(id);
  if (!event) notFound();
  return (
    <EventForm
      mode="edit"
      crumb={event.name}
      cancelHref={adminLinks.event(id)}
      action={updateEventAction}
      initialState={{ status: "idle", values: event.values }}
      eventId={event.editor.eventId}
      editVersion={event.editor.editVersion}
      capabilities={event.editor.capabilities}
      acceptedPolicyCounts={event.editor.acceptedPolicyCounts}
      emailTemplates={event.editor.emails}
      coverUrl={event.editor.coverUrl}
      status={status}
      placesEnabled={placesEnabled()}
    />
  );
}
