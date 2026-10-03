import { ButtonLink } from "@didit-events/ui";
import { EventMeta } from "../event/EventHeader";
import type { EventHeaderInfo } from "../types";
import { applicantsHref } from "./query";
import s from "./Applicants.module.css";

// Server-only pieces the shared event layout renders for the applicants tab (kept apart from the client table so
// the other tabs don't load it).

/** AP-01 header actions: "Share request link" (AP-20) and "+ Invite guests" (AP-16). */
export function ApplicantsHeaderActions({ eventId }: { eventId: string }) {
  return (
    <div className={s.headActions}>
      <ButtonLink variant="secondary" className={s.shareBtn} href={applicantsHref(eventId, { invite: "link" })}>
        Share request link
      </ButtonLink>
      <ButtonLink className={s.inviteBtn} href={applicantsHref(eventId, { invite: "email" })}>
        <span aria-hidden="true" className={s.plus}>
          +
        </span>
        Invite guests
      </ButtonLink>
    </div>
  );
}

/** AP-01 meta line: date · time · venue, plus "Approval required" for request-mode events. */
export function ApplicantsMeta({ event }: { event: EventHeaderInfo }) {
  return <EventMeta>{event.mode === "request" ? `${event.when} · Approval required` : event.when}</EventMeta>;
}
