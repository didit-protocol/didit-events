import { EmptyState, FilterChips, SegmentedNav, Skeleton } from "@didit-events/ui";
import { logChips, logEmptyCopy, logHref, toLogRow, toMissingRow } from "./helpers";
import { LogFilterForm } from "./LogFilterForm";
import { LogGuestCell } from "./LogGuestCell";
import { LogTable, type LogDrawers } from "./LogTable";
import type { LogFilters, LogPage, LogSummary } from "./types";
import s from "./Log.module.css";

const FACE_SCAN_44 = (
  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 0 0 5 0" />
  </svg>
);

/** A-09 filter bar: "All scans / Missing · N", result chips, door, "Show only people". */
export function LogToolbar({ eventId, summary, filters }: { eventId: string; summary: LogSummary; filters: LogFilters }) {
  const keep = { door: filters.door, people: filters.people };
  return (
    <div className={s.toolbar}>
      <SegmentedNav
        label="Log view"
        className={s.seg}
        items={[
          { label: "All scans", href: logHref(eventId, keep), current: filters.view === "all" },
          { label: `Missing · ${summary.missing}`, href: logHref(eventId, { ...keep, view: "missing" }), current: filters.view === "missing" },
        ]}
      />
      {filters.view === "all" ? <FilterChips label="Filter scans by result" className={s.chips} items={logChips(eventId, summary, filters)} /> : <div className={s.chips} />}
      <LogFilterForm action={logHref(eventId).split("?")[0]!} filters={filters} doors={summary.doors} />
    </div>
  );
}

/** The route's loading.tsx toolbar, before the counts arrive: the segmented control and chip placeholders. */
export function LogToolbarPending() {
  return (
    <div className={s.toolbar} aria-hidden="true">
      <Skeleton width={196} height={32} className={s.seg} />
      <div className={s.chipsPending}>
        {[76, 104, 124, 124, 110, 116].map((w, i) => (
          <Skeleton key={i} width={w} height={32} shape="pill" />
        ))}
      </div>
    </div>
  );
}

/** The table for the current view; `page` null = rows still loading (A-09e). `drawers` hosts the rows' drawers (`?guest=`, `?scan=`). */
export function LogResults({ eventId, summary, filters, page, drawers }: { eventId: string; summary: LogSummary; filters: LogFilters; page: LogPage | null; drawers?: LogDrawers }) {
  if (!page) return <LogTable view="all" loading />;
  const count = page.view === "all" ? page.scans.length : page.guests.length;
  const copy = logEmptyCopy(summary, filters, count);
  const empty = copy ? <EmptyState className={s.empty} icon={FACE_SCAN_44} title={copy.title} description={copy.help} /> : undefined;
  if (page.view === "missing") {
    return <LogTable view="missing" rows={page.guests.map((g) => toMissingRow(g, eventId, summary.timeZone))} empty={empty} drawers={drawers} />;
  }
  return <LogTable view="all" rows={page.scans.map((x) => {
        const row = toLogRow(x, summary.doors, summary.timeZone, eventId, filters);
        return { ...row, cell: <LogGuestCell row={row} /> };
      })} empty={empty} drawers={drawers} />;
}
