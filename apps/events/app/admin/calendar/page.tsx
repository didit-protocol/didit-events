import type { Metadata } from "next";
import { ButtonLink } from "@didit-events/ui";
import { requireStaffAccess } from "../../../src/auth/access";
import { adminLinks } from "../../../src/admin/links";
import { CalendarProfileForm } from "../../../src/admin/calendar/CalendarProfileForm";
import { SystemMessage } from "../../../src/admin/system/SystemMessage";
import { removeCalendarImageAction, saveCalendarAction, uploadCalendarImageAction } from "./actions";
import { getCalendarProfile } from "@didit-events/core/calendar";
import { calendarAdminModel } from "../../../src/admin/calendar/model";
import { calendarSubscribers, publishedEvents } from "../../../src/server/b4-views";

export const metadata: Metadata = { title: "Calendar · Didit Events" };

// The public calendar header (P-03): owners and admins edit it; staff get the 403 page.
export default async function CalendarAdminPage() {
  const viewer = await requireStaffAccess("calendar.view", adminLinks.calendar());
  if (viewer.role !== "owner" && viewer.role !== "admin") {
    return (
      <SystemMessage
        code="403"
        title="Owners and admins only"
        help="Only owners and admins can change the public calendar page. Ask one of them to update it."
        action={<ButtonLink href={adminLinks.home()}>Back to events</ButtonLink>}
      />
    );
  }
  await requireStaffAccess("calendar.edit", adminLinks.calendar());
  // The preview's stats line uses the same counts as the public /events header.
  const [row, subscribers, published] = await Promise.all([getCalendarProfile(), calendarSubscribers(), publishedEvents()]);
  const model = calendarAdminModel(row);
  return (
    <CalendarProfileForm
      model={model}
      counts={{ subscribers, events: published.length }}
      save={saveCalendarAction}
      upload={uploadCalendarImageAction}
      remove={removeCalendarImageAction}
    />
  );
}
