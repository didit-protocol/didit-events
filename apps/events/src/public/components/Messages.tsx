import { CONTACT_EMAIL } from "../../config";
import { ButtonLink } from "@didit-events/ui";
import { googleCalendarUrl } from "../ics";
import { links } from "../links";
import type { InviteState, OutcomeState, PublicEvent, SimpleEventGate, Viewer } from "../types";
import { MessageScreen, type MessageCta } from "./MessageScreen";
import s from "./MessageScreen.module.css";

type Verify = (form: FormData) => Promise<void>;

/** No message screen is a dead end: the way on is the calendar, or the event itself. */
const explore: MessageCta = { label: "Explore events", href: links.calendar(), secondary: true };
const seeEvent = (event: PublicEvent): MessageCta => ({ label: "See event", href: links.event(event.slug), secondary: true });

/** G-01f–h: the event page when requests are closed, the event is full or it has ended. */
export function GateMessage({ event, gate }: { event: PublicEvent; gate: Exclude<SimpleEventGate, "open"> }) {
  if (gate === "closed")
    return (
      <MessageScreen
        event={event}
        tone="neutral"
        title="Requests are closed"
        body="The team has stopped taking new requests for this event. If you were invited, check your email for your personal link."
        cta={explore}
      />
    );
  if (gate === "full")
    return <MessageScreen event={event} tone="warning" title="This event is full" body={`All ${event.capacity} places are taken. We’ll let you know about the next one.`} cta={explore} />;
  return <MessageScreen event={event} tone="neutral" icon="check" title="This event has ended" body="Thanks to everyone who came. See you at the next one." cta={explore} />;
}

/** G-01i: unknown slug (the /e/[slug] not-found page). */
export function EventNotFound() {
  return (
    <MessageScreen tone="neutral" icon="question" title="We can’t find this event" body="The link may be wrong or the event was removed. Check the link you received." cta={{ label: explore.label, href: links.calendar() }} inlineCta />
  );
}

/** G-02b–e: the personal link when it can't start a verification. */
export function InviteMessage({ event, state }: { event: PublicEvent; state: Exclude<InviteState, "valid"> }) {
  switch (state) {
    case "expired":
      return (
        <MessageScreen
          event={event}
          tone="warning"
          title="This link has expired"
          body="Personal links last 7 days. Ask the Didit team for a new one."
          cta={{ label: "Email the team", href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`New link for ${event.title}`)}`, secondary: true }}
        />
      );
    case "revoked":
      return (
        <MessageScreen
          event={event}
          tone="error"
          title="This invite is no longer active"
          body="The organiser cancelled this invite. If you think it’s a mistake, reply to your invitation email."
          cta={explore}
        />
      );
    case "verified":
      return <MessageScreen event={event} tone="success" title="You’re all set" body="See you at the door. Just look at the screen, no ticket needed." cta={seeEvent(event)} />;
    case "in_review":
      return <MessageScreen event={event} tone="review" title="We’re checking your verification" body="This usually takes under 2 hours. You’ll get an email." cta={seeEvent(event)} />;
  }
}

/** G-03a–d: the Didit callback page. It only displays the state our server already holds. */
export function OutcomeMessage({ event, state, attemptsLeft, verify, origin, viewer }: { event: PublicEvent; state: OutcomeState; attemptsLeft: number; verify: Verify; origin: string; viewer?: Viewer | null }) {
  const fields = { slug: event.slug };
  switch (state) {
    case "approved":
      return (
        <MessageScreen
          viewer={viewer}
          event={event}
          tone="success"
          iconSize={88}
          title="You’re verified"
          body="At the door, just look at the screen. No ticket needed."
          // Not a dead end on a phone (the header links live in the avatar menu there): the ticket, or the event.
          cta={viewer ? { label: "View my ticket", href: links.myEvent(event.slug) } : { label: "See event", href: links.event(event.slug) }}
          inlineCta
          extra={
            <div className={s.cal}>
              <ButtonLink href={googleCalendarUrl(event, origin)} variant="secondary" size="lg" className={s.calLink} target="_blank" rel="noopener noreferrer">
                Google Calendar
              </ButtonLink>
              <ButtonLink href={links.ics(event.slug)} variant="secondary" size="lg" className={s.calLink} download>
                Apple / .ics
              </ButtonLink>
            </div>
          }
        />
      );
    case "in_review":
      return <MessageScreen viewer={viewer} event={event} tone="review" title="We’re checking your verification" body="You’ll get an email when it’s done, usually within 2 hours." cta={seeEvent(event)} />;
    case "declined":
      return (
        <MessageScreen
          viewer={viewer}
          event={event}
          tone="error"
          title="We couldn’t verify you"
          body="The selfie didn’t pass our liveness check. Try again in good light, facing the camera."
          cta={attemptsLeft > 0 ? { label: "Try again", action: verify, fields, pendingLabel: "Opening Didit…" } : undefined}
          foot={
            <>
              {attemptsLeft > 0 ? `${attemptsLeft} ${attemptsLeft === 1 ? "attempt" : "attempts"} left · ` : "No attempts left · "}
              Questions? <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </>
          }
        />
      );
    case "not_finished":
      return (
        <MessageScreen
          viewer={viewer}
          event={event}
          tone="pending"
          title="You haven’t finished"
          body="You’re one step away: the selfie. It takes under a minute."
          cta={{ label: "Continue verification", action: verify, fields, pendingLabel: "Opening Didit…" }}
        />
      );
  }
}
