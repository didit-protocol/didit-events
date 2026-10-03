import type { ReactNode } from "react";
import { can } from "@didit-events/core/access/capabilities";
import { notFound } from "next/navigation";
import { RoutedEventHeader } from "../../../../../../src/admin/event/RoutedEventHeader";
import { ApplicantsHeaderActions, ApplicantsMeta } from "../../../../../../src/admin/applicants/HeaderExtras";
import { OverviewMeta } from "../../../../../../src/admin/overview/HeaderExtras";
import { EventHeaderActions } from "../../../../../../src/admin/event/EventHeaderActions";
import s from "../../../../../../src/admin/shell/AdminShell.module.css";
import { getEventHeader } from "../data";
import { LiveRefresh } from "../../../../../../src/admin/LiveRefresh";

// Shared by every tab: the header stays put while a tab's loading.tsx streams its content (A-04d, A-05b, A-09e).
export default async function EventLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getEventHeader(id);
  if (!event) notFound();
  return (
    <div className={s.pageTight}>
      <LiveRefresh eventId={event.id} />
      <RoutedEventHeader
        event={event}
        meta={<OverviewMeta event={event} />}
        actions={<EventHeaderActions event={event} />}
        applicants={{ meta: <ApplicantsMeta event={event} />, actions: can(event.role ?? "staff", "guests.invite") ? <ApplicantsHeaderActions eventId={event.id} /> : null }}
      />
      {children}
    </div>
  );
}
