import { ButtonLink, CopyField } from "@didit-events/ui";
import { EventMeta } from "../event/EventHeader";
import type { EventHeaderInfo } from "../types";
import s from "./HeaderExtras.module.css";

/** A-04 meta line: date · time · venue. */
export function OverviewMeta({ event }: { event: EventHeaderInfo }) {
  return <EventMeta>{event.when}</EventMeta>;
}

/** A-04 header actions: the public request link and "Open kiosk ↗". */
export function OverviewHeaderActions({ event }: { event: EventHeaderInfo }) {
  return (
    <div className={s.actions}>
      <CopyField className={s.link} label="Request link" value={event.publicUrl ?? `https://${event.requestLink}`} display={event.requestLink} />
      <ButtonLink href="/kiosk" target="_blank" rel="noopener">
        Open kiosk ↗
      </ButtonLink>
    </div>
  );
}
