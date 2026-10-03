import { ButtonLink, EmptyState, StatusPill } from "@didit-events/ui";
import { coverSrc } from "../../public/photos";
import { accountLinks } from "../links";
import type { GuestAccount, MyEvent } from "../types";
import { eventName } from "./Screen";
import { Eyebrow, Foot, GuestScreen, Title } from "./Screen";
import { initialsOf } from "./StatusScreen";
import a from "./Account.module.css";
import { displayName } from "../../public/viewer-name";
import { hasStarted, withdrawalForBadge } from "../withdrawal";

/** "Hi María"; "Hi there" when the account has no first name yet. */
export const greeting = (account: Pick<GuestAccount, "firstName">) => (account.firstName.trim() ? `Hi ${account.firstName.trim()}` : "Hi there");

const PAST: ReadonlySet<MyEvent["badge"]> = new Set(["attended", "no-show", "cancelled"]);

/**
 * Under "Past": attended, missed and cancelled events. A request the hosts did not approve stays with the upcoming
 * events (pill "Not approved") until the event ends: the event is still ahead, only the answer is in.
 */
export const isPastEvent = (e: Pick<MyEvent, "badge"> & { event: Pick<MyEvent["event"], "endsAt"> }, now: Date) =>
  e.badge === "not-approved" ? Date.parse(e.event.endsAt) <= now.getTime() : PAST.has(e.badge);

/**
 * 05 U-20: every event the guest requested, with its status; empty state before the first request. `now` is required
 * (request time on the page, the frame clock in the gallery): Withdraw / Cancel never show after doors open by omission.
 */
export function MyEventsScreen({ account, events, now }: { account: GuestAccount; events: MyEvent[]; now: Date }) {
  // What is still ahead comes first (soonest on top); attended, missed, cancelled and ended not-approved events follow under "Past".
  const byStart = (x: MyEvent, y: MyEvent) => x.event.startsAt.localeCompare(y.event.startsAt);
  const live = events.filter((e) => !isPastEvent(e, now)).sort(byStart);
  const past = events.filter((e) => isPastEvent(e, now)).sort((x, y) => byStart(y, x));
  const row = (e: MyEvent) => {
    const withdrawal = withdrawalForBadge(e.badge, e.event.slug, hasStarted(e.event.startsAt, now));
    const name = eventName(e.event);
    return (
      <li key={e.event.slug} className={a.eventItem}>
        <a href={accountLinks.myEvent(e.event.slug)} className={a.event}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coverSrc(e.event.cover, 192)} alt="" width={52} height={52} loading="lazy" decoding="async" className={a.thumb} />
          <span className={a.eventText}>
            <span className={a.eventName}>{name}</span>
            <span className={a.eventDetail}>{e.detail}</span>
            <StatusPill status={e.badge} />
          </span>
          <span className={a.chev} aria-hidden="true">
            ›
          </span>
        </a>
        {withdrawal ? (
          <a href={withdrawal.href} className={a.eventAction} data-withdrawal={withdrawal.kind} aria-label={`${withdrawal.label}: ${name}`}>
            {withdrawal.label}
          </a>
        ) : e.again ? (
          <a href={e.again.href} className={a.eventAction} data-rejoin="" aria-label={`${e.again.label}: ${name}`}>
            {e.again.label}
          </a>
        ) : null}
      </li>
    );
  };
  return (
    <GuestScreen header="account" initials={initialsOf(account)} accountName={displayName(account)} account={account} labelledBy="me-title" width="list">
      <Eyebrow>MY EVENTS</Eyebrow>
      <Title id="me-title" size={26}>{greeting(account)}</Title>
      {events.length ? (
        <>
          {live.length ? (
            <ul className={a.events} data-stagger="">
              {live.map(row)}
            </ul>
          ) : null}
          {past.length ? (
            <section className={a.eventGroup} aria-labelledby="me-past">
              <h2 id="me-past" className={a.eventGroupTitle}>
                PAST
              </h2>
              <ul className={a.events}>{past.map(row)}</ul>
            </section>
          ) : null}
          <a href={accountLinks.calendar()} className={a.explore}>
            <span className={a.eventText}>
              <span className={a.eventName}>Find your next event</span>
              <span className={a.eventDetail}>See what is coming up on the Didit Events calendar.</span>
            </span>
            <span className={a.chev} aria-hidden="true">
              ›
            </span>
          </a>
        </>
      ) : (
        <EmptyState
          title="No events yet"
          description="Request a place at an upcoming Didit event and it shows up here."
          action={
            <ButtonLink href={accountLinks.calendar()} variant="primary" size="md">
              Explore events
            </ButtonLink>
          }
        />
      )}
      <Foot>
        <a href={accountLinks.settings()} className={a.footLink}>
          Account settings
        </a>
      </Foot>
    </GuestScreen>
  );
}
