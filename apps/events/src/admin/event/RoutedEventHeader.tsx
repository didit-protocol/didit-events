"use client";

import { useEffect, type ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import type { EventHeaderInfo, EventTab } from "../types";
import { EventHeader } from "./EventHeader";

const TABS: EventTab[] = ["guests", "applicants", "log", "door", "team", "settings"];

/**
 * The event header inside /admin/events/[id]/layout.tsx: the active tab comes from the URL segment, and the A-04
 * meta line and actions show on the overview only; the applicants tab (U3) has its own meta and actions (AP-01). Kept tiny: it only picks which server-rendered pieces to show.
 */
export function RoutedEventHeader({ event, meta, actions, applicants, tab: fixed }: { event: EventHeaderInfo; meta?: ReactNode; actions?: ReactNode; applicants?: { meta: ReactNode; actions: ReactNode }; /** A page outside the tabs layout (the Door launcher) names its tab. */ tab?: EventTab }) {
  const segment = useSelectedLayoutSegment();
  const tab: EventTab = fixed ?? TABS.find((t) => t === segment) ?? "overview";
  // Narrow widths scroll the tab strip sideways: keep the open tab in view (only the strip moves, never the page).
  useEffect(() => {
    const current = document.querySelector<HTMLElement>('nav[aria-label="Event sections"] [aria-current="page"]');
    const strip = current?.parentElement;
    // The browser clamps scrollLeft, so a strip that fits does not move.
    if (strip) strip.scrollLeft += current.getBoundingClientRect().left - strip.getBoundingClientRect().left - (strip.clientWidth - current.offsetWidth) / 2;
  }, [tab]);
  // Link, kiosk and Publish/Cancel stay top right on every tab; the applicants tab adds its invite actions first.
  if (tab === "applicants" && applicants) return <EventHeader event={event} tab={tab} meta={applicants.meta} actions={<>{applicants.actions}{actions}</>} />;
  return <EventHeader event={event} tab={tab} meta={meta} actions={actions} />;
}
