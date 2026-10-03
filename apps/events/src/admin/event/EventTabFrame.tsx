import type { ReactNode } from "react";
import { ALBERTO } from "../fixtures";
import { OverviewHeaderActions, OverviewMeta } from "../overview/HeaderExtras";
import { AdminShell } from "../shell/AdminShell";
import shell from "../shell/AdminShell.module.css";
import type { EventHeaderInfo, EventTab } from "../types";
import { EventHeader } from "./EventHeader";

/**
 * Frame-gallery twin of the /admin/events/[id] layout: shell + event header (with the A-04 meta and actions on the
 * overview) + the tab content, and an optional overlay (modal scrim) over the whole frame.
 */
export function EventTabFrame({ event, tab, children, overlay, mobileBack }: { event: EventHeaderInfo; tab: EventTab; children: ReactNode; overlay?: ReactNode; mobileBack?: { href: string; label: string } }) {
  const overview = tab === "overview";
  return (
    <>
      <AdminShell fill active="events" user={ALBERTO} mobileBack={mobileBack}>
        <div className={shell.pageTight}>
          <EventHeader event={event} tab={tab} meta={overview ? <OverviewMeta event={event} /> : undefined} actions={overview ? <OverviewHeaderActions event={event} /> : undefined} />
          {children}
        </div>
      </AdminShell>
      {overlay}
    </>
  );
}
