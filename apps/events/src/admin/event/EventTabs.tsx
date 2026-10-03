import { Tabs } from "@didit-events/ui";
import { adminLinks } from "../links";
import type { EventHeaderInfo, EventTab } from "../types";
import s from "./EventHeader.module.css";

/** The event tabs as page navigation, limited to the viewer's role (`event.tabs`). Counts hide on phones, where the strip scrolls sideways so every tab stays reachable. */
export function EventTabs({ event, active }: { event: EventHeaderInfo; active: EventTab }) {
  const count = (n: number) => <span className={s.count}> {n}</span>;
  return (
    <Tabs
      label="Event sections"
      className={s.tabs}
      value={active}
      items={[
        { id: "overview", label: "Overview", href: adminLinks.event(event.id) },
        { id: "guests", label: <>Guests{count(event.guestCount)}</>, href: adminLinks.tab(event.id, "guests") },
        { id: "applicants", label: <>Requests{count(event.requestCount)}</>, href: adminLinks.tab(event.id, "applicants") },
        { id: "log", label: "Check-in log", href: adminLinks.tab(event.id, "log") },
        { id: "door", label: "Door", href: adminLinks.tab(event.id, "door") },
        { id: "team", label: "Team", href: adminLinks.tab(event.id, "team") },
        { id: "settings", label: "Settings", href: adminLinks.tab(event.id, "settings") },
      ].filter((t) => !event.tabs || event.tabs.includes(t.id as EventTab))}
    />
  );
}
