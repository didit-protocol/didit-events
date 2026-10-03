import type { ReactNode } from "react";
import { Breadcrumbs, StatusPill } from "@didit-events/ui";
import { adminLinks } from "../links";
import type { EventHeaderInfo, EventTab } from "../types";
import { EventTabs } from "./EventTabs";
import s from "./EventHeader.module.css";

export interface EventHeaderProps {
  event: EventHeaderInfo;
  /** The active tab. Omit it inside the route layout: the tabs then follow the URL segment. */
  tab?: EventTab;
  /** A-04 only: the date/venue line under the title. */
  meta?: ReactNode;
  /** A-04 only: the request-link copy field and "Open kiosk". */
  actions?: ReactNode;
  /** Replaces the tab row (the route layout passes the URL-aware tabs). */
  tabs?: ReactNode;
}

/** Event page header (A-04, A-05, A-09…A-11): breadcrumb, name + status pill, optional meta/actions, then the tabs. */
export function EventHeader({ event, tab = "overview", meta, actions, tabs }: EventHeaderProps) {
  // An open event at capacity or past its close date shows FULL / CLOSED (05 AP-24, AP-25).
  const pill = event.status === "open" && event.registration && event.registration !== "open" ? event.registration : event.status;
  return (
    <>
      <div className={s.head} data-tab={tab}>
        <div className={s.text}>
          <Breadcrumbs className={s.crumbs} items={[{ label: "Events", href: adminLinks.home() }, { label: event.name }]} />
          <div className={s.titleRow}>
            <h1 className={s.title}>{event.name}</h1>
            <StatusPill status={pill} className={s.pill} />
          </div>
          {meta}
        </div>
        {actions ? <div className={s.side}>{actions}</div> : null}
      </div>
      {tabs ?? <EventTabs event={event} active={tab} />}
    </>
  );
}

/** A-04 meta line. */
export function EventMeta({ children }: { children: ReactNode }) {
  return <p className={s.meta}>{children}</p>;
}
