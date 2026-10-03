import type { ReactNode } from "react";
import { preload } from "react-dom";
import { Avatar, AvatarStack, ButtonLink, DateBadge, EventCover, IconTile, Logo, cx } from "@didit-events/ui";
import { agendaTime, badge, clock as clockLabel, COVER_EYEBROW, COVER_TAG, dayMonthYear, fullShortDate, longDate, time, timeRange, venueLabel, zoneName } from "../format";
import { links } from "../links";
import { coverAt, coverPhoto, coverSrc, HERO_COVER_SIZES, heroCoverSrcSet } from "../photos";
import type { CardState, Person, PublicEvent, Viewer } from "../types";
import type { CardActions } from "./CardButton";
import { RegistrationCard, RequestCard } from "./RegistrationCard";
import { SiteHeader } from "./SiteHeader";
import { VenueMap } from "./VenueMap";
import s from "./EventPage.module.css";

export interface EventPageProps {
  event: PublicEvent;
  /** Past events featured at the bottom (event.related, resolved). */
  related: PublicEvent[];
  viewer: Viewer | null;
  /** Signed-in staff (admin session), shown in the header. */
  staff?: { email: string } | null;
  card: CardState;
  now: Date;
  actions: CardActions;
  /** Flow v3: the join modal launcher (a client island; the modal itself loads on open). */
  join?: ReactNode;
  /** "Presented by": the calendar's name and tagline as saved in /admin/calendar (built-in Didit copy when absent). */
  presenter?: { name: string; tagline: string };
}

// A title that already ends with its accent ("…in the AI Era" + "AI Era") would print the accent twice.
const titleWithoutAccent = (e: PublicEvent) =>
  e.accent && e.title.trimEnd().endsWith(e.accent) ? e.title.trimEnd().slice(0, -e.accent.length).trimEnd() : e.title;
const coverTitle = (e: PublicEvent) => (
  <>
    {titleWithoutAccent(e)}
    {e.accent ? (
      <>
        {" "}
        <span className={s.accent}>{e.accent}</span>
      </>
    ) : null}
  </>
);

function Photo({ person, size }: { person: Person; size: 28 | 32 | 56 }) {
  return <Avatar name={person.name} src={person.photoUrl} size={size} className={s.photo} />;
}

/**
 * The hero cover. Both layouts carry the same `src`, `srcset` and `sizes`, so they resolve to one candidate URL: the
 * visible layout and the hidden one share a single download (preloaded by the page). Only one asks for high priority.
 */
function Cover({ event, size, priority }: { event: PublicEvent; size: "desktop" | "mobile"; priority?: boolean }) {
  const panels = event.panels.map((p) => p.title);
  const src = event.cover.src;
  return (
    <div className={size === "desktop" ? s.coverDesktop : s.coverMobile}>
      <EventCover
        src={src ? coverAt(src, 1080) : src}
        srcSet={src ? heroCoverSrcSet(src) : undefined}
        sizes={HERO_COVER_SIZES}
        alt={event.cover.alt}
        format="square"
        theme={event.cover.theme}
        title={titleWithoutAccent(event)}
        accent={event.accent ?? ""}
        date={fullShortDate(event.startsAt, event.timeZone)}
        doors={`${time(event.startsAt, event.timeZone)} ${zoneName(event.startsAt, event.timeZone)}`}
        venue={venueLabel(event.venue)}
        eyebrow={event.cover.eyebrow ?? COVER_EYEBROW}
        tag={event.cover.tag ?? COVER_TAG}
        panels={panels}
        priority={priority}
        eager
        className={s.coverArt}
      />
    </div>
  );
}

const goingLine = (e: PublicEvent) => {
  const [a, b] = e.goingPreview.names;
  const others = e.going - e.goingPreview.names.length;
  return a && b ? `${a}, ${b} and ${others} others` : `${e.going} going`;
};

const priceLine = (e: PublicEvent) => (e.registration === "request" ? "Free · approval required" : e.registration === "invite_only" ? "Free · invite only" : "Free");

/** An event without a description has no "About event" section (no orphan heading over an empty rule). */
const hasAbout = (e: PublicEvent) => Boolean(e.descriptionHtml?.trim()) || e.about.some((p) => p.trim());

/** A past event's cover as a lazy image: below the fold, so it loads when it is scrolled to. */
function PastThumb({ event, className, width, children }: { event: PublicEvent; className?: string; width: 192 | 720; children?: ReactNode }) {
  return (
    <span className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={coverSrc(event.cover, width)} alt="" loading="lazy" decoding="async" className={s.thumbImg} />
      {children}
    </span>
  );
}

/* The blocks below are shared by both layouts, so the phone page offers everything the desktop side rail does. */

/** "Presented by": the calendar (Subscribe is hidden for now). */
function Presenter({ presenter }: { presenter: { name: string; tagline: string }; event?: PublicEvent; actions?: CardActions }) {
  return (
    <div className={s.presenter}>
      <span className={s.presenterMark}>
        <Logo variant="mark" height={24} alt="" className={s.markImg} />
      </span>
      <div className={s.presenterText}>
        <span className={s.presenterName}>{presenter.name}</span>
        {presenter.tagline ? <span className={s.presenterTag}>{presenter.tagline}</span> : null}
      </div>
    </div>
  );
}

/** Who is going, as far as the event's guest-list setting allows (`count`: the number only). */
function Going({ event }: { event: PublicEvent }) {
  return (
    <>
      {event.guestList === "names" ? <AvatarStack initials={event.goingPreview.initials} label={`${event.going} going`} /> : null}
      {event.guestList === "names" ? <span className={s.goingLine}>{goingLine(event)}</span> : null}
    </>
  );
}

function SideLinks({ event }: { event: PublicEvent }) {
  return (
    <nav className={s.sideLinks} aria-label="Event contact">
      <a href={links.contact()}>Contact the hosts</a>
      <a href={links.report(event.slug)}>Report event</a>
    </nav>
  );
}

/** The event's Markdown description (sanitised server-side), else its plain paragraphs. Same content in both layouts. */
function About({ event, className }: { event: PublicEvent; className?: string }) {
  if (event.descriptionHtml) return <div className={className} dangerouslySetInnerHTML={{ __html: event.descriptionHtml }} />;
  return (
    <>
      {event.about.map((p, i) => (
        <p key={i} className={className}>
          {p}
        </p>
      ))}
    </>
  );
}

/**
 * The agenda as a two-column table: the time ("19:10", or "19:10–20:00" where an item has an end) and the item. The
 * time column takes the width of its longest time, so items line up and wrap inside their own column. Same component
 * in both layouts.
 */
function Agenda({ event }: { event: PublicEvent }) {
  return (
    <table className={s.agenda}>
      <thead className={s.srOnly}>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Item</th>
        </tr>
      </thead>
      <tbody>
        {event.agenda.map((a) => (
          <tr key={a.at + a.label} className={s.agendaRow}>
            <td className={s.agendaTime}>{agendaTime(a, event.timeZone)}</td>
            <td className={cx(s.agendaLabel, a.emphasis && s.agendaStrong)}>{a.label}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** P-01 public event page (feature template): desktop 1440 two columns, mobile 390 single column + sticky bar. */
/**
 * Both layouts are rendered and a container query on the page width picks one, so a 390px frame gets the mobile
 * layout even inside a wide window. The hidden layout costs no downloads: both covers resolve to one sized URL (one
 * request, preloaded below), the map embed mounts only in the layout that is displayed (VenueMapFrame), and lazy
 * thumbnails never load while they are `display: none`.
 */
export function EventPage({ event, related, viewer, staff, card, now, actions, join, presenter = { name: "Didit Events", tagline: "AI, identity and startups" } }: EventPageProps) {
  const tz = event.timeZone;
  const next = links.event(event.slug);
  const d = badge(event.startsAt, tz);
  // The cover is the page's largest image. An upload is preloaded at the width this viewport needs (the same srcset
  // and sizes as both <img>s, so they reuse it); the theme art is a CSS background, which the preload scanner cannot see.
  const uploaded = event.cover.src;
  if (uploaded) preload(coverAt(uploaded, 1080), { as: "image", fetchPriority: "high", imageSrcSet: heroCoverSrcSet(uploaded), imageSizes: HERO_COVER_SIZES });
  else preload(coverPhoto(event.cover.theme), { as: "image", fetchPriority: "high" });
  const cardEl = (mobile: boolean) =>
    card.kind === "request" && !mobile ? (
      <RequestCard event={event} viewer={card.viewer} actions={actions} />
    ) : (
      <RegistrationCard event={event} state={card} actions={actions} className={mobile ? s.mobileCard : undefined} />
    );

  return (
    <div className={s.page}>
      <div className={s.desktop}>
          <SiteHeader viewer={viewer} staff={staff} clock={clockLabel(now, tz)} next={next} />
          <main className={s.grid}>
            <aside className={s.side} aria-label="About the hosts">
              <Cover event={event} size="desktop" priority />
              <section className={s.sideBlock}>
                <h2 className={s.eyebrow}>PRESENTED BY</h2>
                <Presenter presenter={presenter} event={event} actions={actions} />
              </section>
              {event.hosts.length ? (<section className={s.sideBlock}>
                <h2 className={s.eyebrow}>HOSTED BY</h2>
                <ul className={s.hosts}>
                  {event.hosts.map((h) => (
                    <li key={h.name} className={s.host}>
                      <Photo person={h} size={28} />
                      <span className={s.hostName}>{h.name}</span>
                      <span className={s.hostRole}>{h.role}</span>
                    </li>
                  ))}
                </ul>
              </section>) : null}
              {event.guestList !== "hidden" ? (
                <section className={cx(s.sideBlock, s.goingBlock)}>
                  <h2 className={s.eyebrow}>{event.going} GOING</h2>
                  <Going event={event} />
                </section>
              ) : null}
              <SideLinks event={event} />
            </aside>

            <div className={s.main}>
              <div className={s.head}>
                {event.featuredLabel ? <span className={s.featured}>{event.featuredLabel}</span> : null}
                <h1 className={s.title}>{coverTitle(event)}</h1>
              </div>
              <div className={s.meta}>
                <div className={s.metaRow}>
                  <DateBadge month={d.month} day={d.day} />
                  <div className={s.metaText}>
                    <span className={s.metaMain}>{longDate(event.startsAt, tz)}</span>
                    <span className={cx(s.metaSub, s.tnum)}>{timeRange(event.startsAt, event.endsAt, tz)}</span>
                  </div>
                </div>
                <div className={s.metaRow}>
                  <IconTile icon="pin" />
                  <div className={s.metaText}>
                    <a className={s.metaMain} href="#location">
                      {event.venue.name || event.venue.address}
                    </a>
                    <span className={s.metaSub}>{event.venue.address}</span>
                  </div>
                </div>
              </div>

              {cardEl(false)}

              {hasAbout(event) ? (
                <section className={s.section}>
                  <h2 className={s.sectionTitle}>About event</h2>
                  <About event={event} className={s.about} />
                </section>
              ) : null}

              {event.agenda.length ? (
                <section className={cx(s.section, s.agendaSection)}>
                  <h2 className={s.sectionTitle}>Agenda</h2>
                  <Agenda event={event} />
                </section>
              ) : null}

              {event.panels.map((p) => (
                <section key={p.kicker} className={s.panel} aria-label={`${p.kicker}: ${p.title}`}>
                  <div className={s.panelTop}>
                    <span className={s.panelKicker}>{p.kicker}</span>
                    <span className={s.panelTime}>{`${time(p.startsAt, tz)} – ${time(p.endsAt, tz)}`}</span>
                  </div>
                  <h3 className={s.panelTitle}>{p.title}</h3>
                  <p className={s.panelBody}>{p.description}</p>
                  <ul className={s.people}>
                    {p.people.map((person, i) => (
                      <li key={i} className={s.person}>
                        <Photo person={person} size={56} />
                        <div className={s.personText}>
                          <span className={s.personName}>{person.name}</span>
                          <span className={s.personRole}>{person.role}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}

              <section className={cx(s.section, s.locationSection)} id="location" aria-labelledby="location-title">
                <h2 className={s.sectionTitle} id="location-title">Location</h2>
                <span className={s.venueName}>{event.venue.name}</span>
                <span className={s.venueLine}>{[event.venue.address, event.venue.transit].filter(Boolean).join(" · ")}</span>
                <VenueMap venue={event.venue} />
              </section>

              {related.length ? (
                <section className={cx(s.section, s.pastSection)}>
                  <div className={s.pastHead}>
                    <h2 className={s.pastTitle}>Past Didit events</h2>
                    <a href={links.past()} className={s.seeAll}>
                      See all
                    </a>
                  </div>
                  <ul className={s.pastGrid}>
                    {related.map((e) => (
                      <li key={e.slug}>
                        <a href={links.event(e.slug)} className={s.pastCard}>
                          <PastThumb event={e} className={s.pastThumb} width={720}>
                            <span className={s.pastThumbTitle} aria-hidden="true">
                              {e.title}
                            </span>
                          </PastThumb>
                          <span className={s.pastName}>{e.title}</span>
                          <span className={s.pastMeta}>{`${dayMonthYear(e.startsAt, e.timeZone)} · ${e.attended ?? 0} attended`}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          </main>
      </div>

      <div className={s.mobile}>
          <SiteHeader viewer={viewer} next={next} />
          <main className={s.mBody}>
            <Cover event={event} size="mobile" />
            <h1 className={s.mTitle}>{coverTitle(event)}</h1>
            <div className={s.mMeta}>
              <div className={s.mMetaRow}>
                <DateBadge month={d.month} day={d.day} size="md" />
                <div className={s.mMetaText}>
                  <span className={s.mMetaMain}>{longDate(event.startsAt, tz)}</span>
                  <span className={s.mMetaSub}>{timeRange(event.startsAt, event.endsAt, tz)}</span>
                </div>
              </div>
              <div className={s.mMetaRow}>
                <IconTile icon="pin" size="md" />
                <div className={s.mMetaText}>
                  <a className={s.mMetaMain} href="#location-m">
                    {event.venue.name || event.venue.address}
                  </a>
                  <span className={s.mMetaSub}>{event.venue.shortAddress}</span>
                </div>
              </div>
            </div>
            {card.kind === "signed_out" || card.kind === "request" ? (
              <div className={s.notice}>
                <span className={s.noticeTitle}>
                  {event.registration === "request" ? "Approval required · face check-in" : "Face check-in"}
                </span>
                <span className={s.noticeBody}>Request a place. Once approved, verify with Didit and just walk in on the night.</span>
              </div>
            ) : (
              cardEl(true)
            )}
            {hasAbout(event) ? (
              <section className={s.mSection}>
                <h2 className={s.mSectionTitle}>About event</h2>
                <About event={event} className={s.mAbout} />
              </section>
            ) : null}
            {event.agenda.length ? (
              <section className={s.mSection}>
                <h2 className={s.mSectionTitle}>Agenda</h2>
                <Agenda event={event} />
              </section>
            ) : null}
            {event.panels.map((p) => (
              <section key={p.kicker} className={s.mPanel} aria-label={`${p.kicker}: ${p.title}`}>
                <span className={s.panelKicker}>{`${p.kicker} · ${time(p.startsAt, tz)} – ${time(p.endsAt, tz)}`}</span>
                <h3 className={s.mPanelTitle}>{p.title}</h3>
                <ul className={s.mPeople} aria-label="Speakers">
                  {p.people.map((person, i) => (
                    <li key={i}>
                      <Photo person={person} size={32} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <section className={s.mSection} id="location-m" aria-labelledby="location-m-title">
              <h2 className={s.mSectionTitle} id="location-m-title">Location</h2>
              <span className={s.mVenue}>
                <span className={s.venueName}>{event.venue.name}</span>
                <span className={s.venueLine}>{[event.venue.address, event.venue.transit].filter(Boolean).join(" · ")}</span>
              </span>
              <VenueMap venue={event.venue} size="mobile" />
            </section>
            {event.hosts.length ? (
              <section className={s.mSection}>
                <h2 className={s.mSectionTitle}>Hosted by</h2>
                <ul className={s.mHosts}>
                  {event.hosts.map((h) => (
                    <li key={h.name} className={s.mHost}>
                      <Photo person={h} size={28} />
                      <span className={s.hostName}>{h.name}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {event.guestList !== "hidden" ? (
              <section className={s.mSection}>
                <h2 className={s.mSectionTitle}>{event.going} going</h2>
                <Going event={event} />
              </section>
            ) : null}
            <section className={s.mSection}>
              <h2 className={s.mSectionTitle}>Presented by</h2>
              <Presenter presenter={presenter} event={event} actions={actions} />
            </section>
            {related.length ? (
              <section className={s.mSection}>
                <h2 className={s.mSectionTitle}>Past Didit events</h2>
                <ul className={s.mPast}>
                  {related.map((e) => (
                    <li key={e.slug}>
                      <a href={links.event(e.slug)} className={s.mPastRow}>
                        <PastThumb event={e} className={s.mPastThumb} width={192} />
                        <span className={s.mPastText}>
                          <span className={s.pastName}>{e.title}</span>
                          <span className={s.mPastMeta}>{`${dayMonthYear(e.startsAt, e.timeZone)} · ${e.attended ?? 0} attended`}</span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <SideLinks event={event} />
          </main>
          {card.kind === "signed_out" || card.kind === "request" ? (
            <div className={s.bar}>
              <div className={s.barText}>
                <span className={s.barMain}>{priceLine(event)}</span>
                <span className={s.barSub}>{`${event.going} going · ${Math.max(0, event.capacity - event.going)} places left`}</span>
              </div>
              <ButtonLink href={links.register(event.slug)} size="lg" className={s.barCta}>
                Request to join
              </ButtonLink>
            </div>
          ) : null}
      </div>
      {join}
    </div>
  );
}
