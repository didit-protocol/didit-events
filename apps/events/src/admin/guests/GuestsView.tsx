import { ButtonLink, EmptyState, FilterChips, SearchField, StatusPill, type FilterChipItem } from "@didit-events/ui";
import { adminLinks } from "../links";
import { GuestsTable, type GuestsDrawer, type GuestsTableFrameState } from "./GuestsTable";
import { checkedInLabel, DESKTOP_CHIPS, emptyCopy, guestInitials, guestsHref, listState, phoneSubline, PHONE_CHIPS } from "./query";
import type { GuestCounts, GuestPage, GuestQuery, GuestRow, StatusFilter } from "./types";
import s from "./Guests.module.css";

const PERSON_ADD_44 = "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 8v6M22 11h-6";
const SEARCH_44 = "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-3.5-3.5M8 11h6";

export interface GuestsViewProps {
  eventId: string;
  query: GuestQuery;
  /** Chip counts over the whole list; zeros while loading. */
  counts: GuestCounts;
  /** Null while loading (A-05b). */
  page: GuestPage | null;
  /** Frame gallery: row selection, hover and the open row menu as drawn in A-05a. */
  frame?: GuestsTableFrameState;
  /** False for door operators: no Add guests or CSV export (the server refuses both for them). */
  manage?: boolean;
  /** The page only: hosts the `?guest=` drawer over the list (see `GuestsTable`). */
  drawer?: GuestsDrawer;
}

function chipItems(eventId: string, query: GuestQuery, counts: GuestCounts, set: { key: StatusFilter; label: string }[]): FilterChipItem[] {
  return set.map((c) => ({ key: c.key, label: c.label, count: counts[c.key], href: guestsHref(eventId, { q: query.q, status: c.key, density: query.density }), current: query.status === c.key }));
}

/** A-05 Guests tab: toolbar, table (1440), compact table (1024), phone list (390); loading, empty, filtered empty. */
export function GuestsView({ eventId, query, counts, page, frame, manage = true, drawer }: GuestsViewProps) {
  const base = adminLinks.tab(eventId, "guests");
  const current = DESKTOP_CHIPS.find((c) => c.key === query.status) ?? PHONE_CHIPS.find((c) => c.key === query.status);
  const exportHref = `${base}/export${guestsHref(eventId, { q: query.q, status: query.status }).slice(base.length)}`;
  const addHref = guestsHref(eventId, { ...listState(query), add: "one" });
  const copy = page && page.rows.length === 0 ? emptyCopy(counts.all, query) : null;
  const empty = copy ? (
    <EmptyState
      className={s.empty}
      icon={
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
          <path d={copy.kind === "none" ? PERSON_ADD_44 : SEARCH_44} />
        </svg>
      }
      title={copy.title}
      description={copy.help}
      action={
        copy.kind === "none" ? (
          manage ? <ButtonLink href={addHref}>{copy.cta}</ButtonLink> : undefined
        ) : (
          <ButtonLink variant="secondary" href={guestsHref(eventId, {})}>
            {copy.cta}
          </ButtonLink>
        )
      }
    />
  ) : undefined;

  return (
    <>
      <div className={s.toolbar}>
        <form role="search" action={base} className={s.search}>
          {query.status !== "all" ? <input type="hidden" name="status" value={query.status} /> : null}
          <SearchField key={query.q} name="q" label="Search guests" placeholder="Search guests" defaultValue={query.q} />
        </form>
        <FilterChips label="Filter guests by status" className={s.chips} items={chipItems(eventId, query, counts, DESKTOP_CHIPS)} />
        <details className={s.filterMenu}>
          <summary>
            Filter · {current?.label ?? "All"} {counts[query.status]}
          </summary>
          <div className={s.filterPanel}>
            <FilterChips label="Filter guests by status" items={chipItems(eventId, query, counts, DESKTOP_CHIPS)} />
          </div>
        </details>
        {manage ? (
          <>
            <ButtonLink variant="secondary" href={exportHref} className={s.export} download>
              Export CSV
            </ButtonLink>
            {/* An empty list has its own "Add guests" in the empty state: one primary action, not two. */}
            {copy?.kind === "none" ? null : (
              <ButtonLink href={addHref} className={s.add}>
                <span className={s.addLabelFull}>Add guests</span>
                <span className={s.phoneAdd}>Add</span>
              </ButtonLink>
            )}
          </>
        ) : null}
      </div>
      {/* Wrapped: the kit's own chip styles load after this module and would override display:none. */}
      <div className={s.phoneChips}>
        <FilterChips label="Filter guests by status" items={chipItems(eventId, query, counts, PHONE_CHIPS)} />
      </div>

      <div className={s.desktop}>
        <GuestsTable eventId={eventId} query={query} rows={page?.rows ?? []} total={page?.total ?? 0} loading={!page} empty={empty} frame={frame} manage={manage} drawer={drawer} />
      </div>
      <div className={s.compact}>{page ? <CompactTable eventId={eventId} query={query} rows={page.rows} empty={empty} /> : null}</div>
      <div className={s.phoneList}>{page ? <PhoneList eventId={eventId} query={query} rows={page.rows} empty={empty} /> : null}</div>
    </>
  );
}

const rowHref = (eventId: string, query: GuestQuery, id: string) => guestsHref(eventId, { ...listState(query), guest: id });

/** A-05 1024: name + email stacked, status, checked in, menu. */
function CompactTable({ eventId, query, rows, empty }: { eventId: string; query: GuestQuery; rows: GuestRow[]; empty?: React.ReactNode }) {
  return (
    <div className={s.compactTable} role="table" aria-label="Guests">
      <div role="row" className={`${s.cRow} ${s.cHead}`}>
        <span role="columnheader">Name</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Checked in</span>
        <span role="columnheader" />
      </div>
      {rows.length === 0 ? empty : null}
      {rows.map((r) => (
        <div key={r.id} role="row" className={s.cRow}>
          <a role="cell" className={s.cName} href={rowHref(eventId, query, r.id)}>
            <b>{r.name}</b>
            <span>{r.email}</span>
          </a>
          <span role="cell">
            <StatusPill status={r.status} />
          </span>
          <span role="cell" className={s.ci} data-kind={r.checkedIn.kind}>
            {checkedInLabel(r.checkedIn)}
          </span>
          <span role="cell" className={s.cMore} aria-hidden="true">
            ⋯
          </span>
        </div>
      ))}
    </div>
  );
}

/** A-05 390: avatar, name, check-in line, status pill. */
function PhoneList({ eventId, query, rows, empty }: { eventId: string; query: GuestQuery; rows: GuestRow[]; empty?: React.ReactNode }) {
  if (rows.length === 0) return <>{empty}</>;
  return (
    <ul aria-label="Guests" style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {rows.map((r) => (
        <li key={r.id}>
          <a className={s.pRow} href={rowHref(eventId, query, r.id)}>
            <span className={s.pAvatar} aria-hidden="true">
              {guestInitials(r.name)}
            </span>
            <span className={s.pText}>
              <b>{r.name}</b>
              <span data-kind={r.checkedIn.kind}>{phoneSubline(r)}</span>
            </span>
            <StatusPill status={r.status} />
          </a>
        </li>
      ))}
    </ul>
  );
}
