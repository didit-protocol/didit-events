import type { ReactNode } from "react";
import { Avatar, ButtonLink, EmptyState, FilterChips, SearchField, type FilterChipItem } from "@didit-events/ui";
import { adminLinks } from "../links";
import { LazyPersonBadge } from "../person/LazyBadge";
import { personPhoto } from "../person/PersonCell";
import { PageHeading } from "../shell/PageHeading";
import shell from "../shell/AdminShell.module.css";
import { PeopleTable, type PeopleDrawerSeed } from "./PeopleTable";
import { emptyCopy, listState, PEOPLE_CHIPS, PEOPLE_TZ, peopleHref, relativeWhen } from "./query";
import type { PeopleCounts, PeoplePage, PeopleQuery, PeopleRow } from "./types";
import { VerificationTag } from "./VerificationTag";
import s from "./People.module.css";

const PEOPLE_44 = "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M17 11a3 3 0 1 0 0-6M21 19v-1a4 4 0 0 0-3-3.87";
const SEARCH_44 = "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-3.5-3.5M8 11h6";

export interface PeopleViewProps {
  query: PeopleQuery;
  /** Chip counts over everyone; zeros while loading. */
  counts: PeopleCounts;
  /** Null while loading. */
  page: PeoplePage | null;
  now: Date;
  /** The page only: hosts the `?person=` drawer over the list (see `PeopleTable`). */
  drawer?: PeopleDrawerSeed;
}

function chipItems(query: PeopleQuery, counts: PeopleCounts): FilterChipItem[] {
  return PEOPLE_CHIPS.map((c) => ({ key: c.key, label: c.label, count: counts[c.key], href: peopleHref({ q: query.q, filter: c.key, density: query.density, sort: query.sort }), current: query.filter === c.key }));
}

const rowHref = (query: PeopleQuery, id: string) => peopleHref({ ...listState(query), person: id });

/** Owner-only People: search, filter chips, the table (1440), a compact table (1024) and a phone list (390). */
export function PeopleView({ query, counts, page, now, drawer }: PeopleViewProps) {
  const current = PEOPLE_CHIPS.find((c) => c.key === query.filter);
  const copy = page && page.rows.length === 0 ? emptyCopy(counts.all, query) : null;
  const empty: ReactNode = copy ? (
    <EmptyState
      className={s.empty}
      icon={
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
          <path d={copy.kind === "none" ? PEOPLE_44 : SEARCH_44} />
        </svg>
      }
      title={copy.title}
      description={copy.help}
      action={
        copy.cta ? (
          <ButtonLink variant="secondary" href={peopleHref({ density: query.density, ...(query.q ? { filter: query.filter } : {}) })}>
            {copy.cta}
          </ButtonLink>
        ) : undefined
      }
    />
  ) : undefined;

  return (
    <div className={`${shell.page} ${s.page}`}>
      <PageHeading title="People" description="Everyone with a Didit Events account: what they signed up for, attended and verified. Only owners see this page." />
      <div className={s.toolbar}>
        <form role="search" action={adminLinks.people()} className={s.search}>
          {query.filter !== "all" ? <input type="hidden" name="filter" value={query.filter} /> : null}
          {query.density === "compact" ? <input type="hidden" name="density" value="compact" /> : null}
          <SearchField key={query.q} name="q" label="Search people" placeholder="Search name, email or company" defaultValue={query.q} />
        </form>
        <FilterChips label="Filter people" className={s.chips} items={chipItems(query, counts)} />
        <details className={s.filterMenu}>
          <summary>
            Filter · {current?.label ?? "All"} {counts[query.filter]}
          </summary>
          <div className={s.filterPanel}>
            <FilterChips label="Filter people" items={chipItems(query, counts)} />
          </div>
        </details>
      </div>
      <div className={s.phoneChips}>
        <FilterChips label="Filter people" items={chipItems(query, counts)} />
      </div>

      <div className={s.desktop}>
        <PeopleTable query={query} rows={page?.rows ?? []} total={page?.total ?? 0} loading={!page} empty={empty} now={now.toISOString()} drawer={drawer} />
      </div>
      <div className={s.compact}>{page ? <CompactTable query={query} rows={page.rows} empty={empty} now={now} /> : null}</div>
      <div className={s.phoneList}>{page ? <PhoneList query={query} rows={page.rows} empty={empty} /> : null}</div>
      {page && page.total > page.pageSize ? <Pager query={query} page={page} /> : null}
    </div>
  );
}

/** The 1024 / 390 layouts page with links (the desktop table has its own pager). */
function Pager({ query, page }: { query: PeopleQuery; page: PeoplePage }) {
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));
  return (
    <nav aria-label="People pages" className={s.pager}>
      {page.page > 1 ? <a href={peopleHref({ ...listState(query), page: page.page - 1 })}>‹ Previous</a> : <span />}
      <span>
        Page {page.page} of {pages}
      </span>
      {page.page < pages ? <a href={peopleHref({ ...listState(query), page: page.page + 1 })}>Next ›</a> : <span />}
    </nav>
  );
}

function Name({ row }: { row: PeopleRow }) {
  return (
    <span className={s.nameLine}>
      <b>{row.name}</b>
      <LazyPersonBadge verified={row.verified ?? undefined} timeZone={PEOPLE_TZ} size={14} />
    </span>
  );
}

/** 1024: person (name + email), verification, events, last active. */
function CompactTable({ query, rows, empty, now }: { query: PeopleQuery; rows: PeopleRow[]; empty?: ReactNode; now: Date }) {
  return (
    <div className={s.compactTable} role="table" aria-label="People">
      <div role="row" className={`${s.cRow} ${s.cHead}`}>
        <span role="columnheader">Person</span>
        <span role="columnheader">Verification</span>
        <span role="columnheader">Events</span>
        <span role="columnheader">Last active</span>
      </div>
      {rows.length === 0 ? empty : null}
      {rows.map((r) => (
        <div key={r.id} role="row" className={s.cRow}>
          <a role="cell" className={s.cName} href={rowHref(query, r.id)}>
            <Avatar name={r.name} email={r.email} src={personPhoto(r.photoUrl)} size={32} />
            <span className={s.cText}>
              <Name row={r} />
              {/* Without a name the first line is already the email. */}
              {r.name === r.email ? null : <span>{r.email}</span>}
            </span>
          </a>
          <span role="cell">
            <VerificationTag row={r} />
          </span>
          <span role="cell" className={s.num}>
            {r.registered} · {r.attended} in
          </span>
          <span role="cell" className={s.muted}>
            {relativeWhen(r.lastActiveAt, now)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 390: avatar, name, email + events line, verification tag. */
function PhoneList({ query, rows, empty }: { query: PeopleQuery; rows: PeopleRow[]; empty?: ReactNode }) {
  if (rows.length === 0) return <>{empty}</>;
  return (
    <ul aria-label="People" className={s.pList}>
      {rows.map((r) => (
        <li key={r.id}>
          <a className={s.pRow} href={rowHref(query, r.id)}>
            <Avatar name={r.name} email={r.email} src={personPhoto(r.photoUrl)} size={40} />
            <span className={s.pText}>
              <Name row={r} />
              <span>
                {r.registered} event{r.registered === 1 ? "" : "s"} · {r.attended} attended
              </span>
            </span>
            <VerificationTag row={r} />
          </a>
        </li>
      ))}
    </ul>
  );
}
