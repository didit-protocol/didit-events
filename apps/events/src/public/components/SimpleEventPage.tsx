import { fullShortDate, time, zoneName } from "../format";
import { SecuredByDidit } from "../../accounts/components/SecuredByDidit";
import { mapsOpenHref } from "../map";
import { coverSrc } from "../photos";
import type { CardState, PublicEvent, RequestFormState, Viewer } from "../types";
import type { CardActions } from "./CardButton";
import { RegistrationCard } from "./RegistrationCard";
import { RequestForm, type RequestAction } from "./RequestForm";
import { SiteHeader } from "./SiteHeader";
import s from "./SimpleEventPage.module.css";

export interface SimpleEventPageProps {
  event: PublicEvent;
  action: RequestAction;
  initial?: RequestFormState;
  pending?: boolean;
  /** Signed-in guest: prefills the form and shows the email read-only. */
  viewer?: Viewer | null;
  /** Signed-in staff without a guest session. */
  staff?: { email: string } | null;
  /** The signed-in guest's registration status: replaces the form (P-02 card). */
  card?: CardState | null;
  /** Card buttons (verify, subscribe); required with `card`. */
  cardActions?: CardActions;
  signOut?: (form: FormData) => Promise<void>;
}

/**
 * G-01 event page with the request form (simple events): mobile 390 single column, desktop 1440 two columns
 * (details left, form card right). A container query on the page width picks the layout.
 */
export function SimpleEventPage({ event, action, initial, pending, viewer, staff, card, cardActions, signOut }: SimpleEventPageProps) {
  const tz = event.timeZone;
  const when = `${fullShortDate(event.startsAt, tz).toUpperCase()} · ${time(event.startsAt, tz)}–${time(event.endsAt, tz)}`;
  return (
    <div className={s.root}>
      <div className={s.page}>
        <SiteHeader signIn={false} />
        <main className={s.layout}>
          <div className={s.cover} style={{ backgroundImage: `url(${coverSrc(event.cover, 1080)})` }} role="img" aria-label={`${event.title} cover`} />
          <div className={s.details}>
            <span className={s.when}>
              {when}
              <span className={s.desktopInline}>{` ${zoneName(event.startsAt, tz)}`}</span>
            </span>
            <h1 className={s.title}>{event.title}</h1>
            <span className={s.venue}>
              <span className={s.mobileInline}>{`${event.venue.name} · ${event.venue.shortAddress} · `}</span>
              <span className={s.desktopInline}>{`${event.venue.name} · ${event.venue.address} · `}</span>
              <a href={mapsOpenHref(event.venue)} target="_blank" rel="noopener noreferrer">
                <span className={s.mobileInline}>Map ↗</span>
                <span className={s.desktopInline}>Open in Maps ↗</span>
              </a>
            </span>
            {event.descriptionHtml ? <div className={s.description} dangerouslySetInnerHTML={{__html:event.descriptionHtml}} /> : <p className={s.description}>{event.summary}</p>}
          </div>
          {card && cardActions ? (
            <div className={`${s.formBox} ${s.statusBox}`}>
              <RegistrationCard event={event} state={card} actions={cardActions} />
            </div>
          ) : (
            <div className={s.formBox}>
              <RequestForm slug={event.slug} action={action} initial={initial} pending={pending} viewer={viewer} staff={staff} signOut={signOut} />
              {/* Rendered on the server, next to the client form (keeps it out of the page's JS). */}
              <SecuredByDidit className={s.secured} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
