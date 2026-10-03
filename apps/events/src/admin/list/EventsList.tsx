import Link from "next/link";
import { ButtonLink, ClientButtonLink, EmptyState, FilterChips, Icon, ProgressBar, SearchField, Skeleton, StatusPill } from "@didit-events/ui";
import { adminLinks } from "../links";
import { PageHeading } from "../shell/PageHeading";
import shell from "../shell/AdminShell.module.css";
import { countsLine, eventsHref, statusChips } from "./filter";
import type { AdminEventRow, StatusCounts, StatusFilter } from "./types";
import s from "./EventsList.module.css";

export type EventsListState = "loading" | "rows" | "empty" | "no-results";

/** Which A-02 state a result is: loading (b), rows (a), no events at all (c), nothing matches the filters (d). */
export function eventsListState(events: AdminEventRow[] | null, total: number): EventsListState {
  if (events === null) return "loading";
  if (events.length > 0) return "rows";
  return total === 0 ? "empty" : "no-results";
}

export interface EventsListProps {
  /** The filtered rows, or null while loading (A-02b). */
  events: AdminEventRow[] | null;
  /** Chip counts over every event; omitted while loading. */
  counts?: StatusCounts;
  q: string;
  status: StatusFilter;
  /** Staff create events; event team members only see the events they are on. */
  canCreate?: boolean;
}

const CALENDAR_48 = (
  <svg width="48" height="48" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="6" y="9" width="28" height="24" rx="4" />
    <path d="M6 16h28M13 5v7M27 5v7" />
  </svg>
);

/** A-02 Events list. One component for 1440, 1024 and 390: the page box's own width picks the layout. */
export function EventsList({ events, counts, q, status, canCreate = true }: EventsListProps) {
  const state = eventsListState(events, counts?.all ?? 0);
  return (
    <div className={`${shell.page} ${s.page}`}>
      <PageHeading
        title="Events"
        actions={
          canCreate ? (
            <ClientButtonLink href={adminLinks.newEvent()} className={s.newEvent}>
              <span className={s.plus} aria-hidden="true">
                +
              </span>
              New event
            </ClientButtonLink>
          ) : undefined
        }
      />
      <div className={s.toolbar}>
        <form role="search" action={adminLinks.home()} className={s.search}>
          {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
          <SearchField key={q} name="q" label="Search events" placeholder="Search events" defaultValue={q} className={s.searchField} />
        </form>
        <FilterChips label="Filter events by status" items={statusChips(status, q, counts)} className={s.chips} />
      </div>
      {state === "loading" ? <LoadingRows /> : null}
      {state === "rows" && events ? <EventRows events={events} /> : null}
      {state === "empty" ? (
        <EmptyState
          className={s.empty}
          icon={CALENDAR_48}
          title="No events yet."
          description={canCreate ? "Create your first event." : "You’re not on any event team yet."}
          action={canCreate ? <ClientButtonLink href={adminLinks.newEvent()}>New event</ClientButtonLink> : undefined}
        />
      ) : null}
      {state === "no-results" ? (
        <EmptyState
          className={s.empty}
          icon={CALENDAR_48}
          title={q ? `No events match “${q}”.` : "No events match this filter."}
          description="Try another name or clear the filters."
          action={
            <ButtonLink variant="secondary" href={eventsHref({})}>
              {q ? "Clear search" : "Clear filters"}
            </ButtonLink>
          }
        />
      ) : null}
    </div>
  );
}

function Metric({ label, value, of, tone }: { label: string; value: number; of: number; tone: "invited" | "verified" | "checked" }) {
  return (
    <div className={s.metric}>
      <div className={s.metricHead}>
        <span>{label}</span>
        <span className={s.metricValue}>{value}</span>
      </div>
      <ProgressBar value={value} max={of} label={label} valueText={`${value} of ${of} invited`} className={`${s.bar} ${s[tone]}`} />
    </div>
  );
}

function EventRows({ events }: { events: AdminEventRow[] }) {
  return (
    <ul className={s.list} aria-label="Events" data-stagger="">
      {events.map((e) => (
        <li key={e.id} className={s.row}>
          <span className={s.date} aria-hidden="true">
            <span className={s.month}>{e.month}</span>
            <span className={s.day}>{e.day}</span>
          </span>
          <div className={s.text}>
            <Link href={adminLinks.event(e.id)} className={s.name}>
              {e.name}
            </Link>
            <span className={s.meta}>
              {e.when}
              <span className={s.where}> · {e.where}</span>
            </span>
            <span className={s.counts}>{countsLine(e)}</span>
          </div>
          <StatusPill status={e.status} className={s.pill} />
          <div className={s.funnel}>
            <Metric label="Invited" value={e.invited} of={e.invited} tone="invited" />
            <Metric label="Verified" value={e.verified} of={e.invited} tone="verified" />
            <Metric label="Checked in" value={e.checkedIn} of={e.invited} tone="checked" />
          </div>
          <Icon name="chevron-right" size={16} className={s.chevron} />
        </li>
      ))}
    </ul>
  );
}

function LoadingRows() {
  return (
    <div className={s.list} role="status" aria-label="Loading events">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={`${s.row} ${s.skRow}`} aria-hidden="true">
          <Skeleton width={56} height={56} className={s.skTile} />
          <div className={s.skText}>
            <Skeleton width="45%" height={12} />
            <Skeleton width="65%" height={10} className={s.skLight} />
          </div>
          <Skeleton width={64} height={22} shape="pill" />
          <Skeleton height={8} shape="pill" className={s.skFunnel} />
        </div>
      ))}
    </div>
  );
}
