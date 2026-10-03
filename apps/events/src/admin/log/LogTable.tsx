"use client";

import { Suspense, lazy, useMemo, useState, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { DataTable, Tag, cx, type Column } from "@didit-events/ui";
import { drawerGo, useDrawerUrl } from "../drawer/url";
import { GuestDrawerHost, type GuestDrawerHostProps } from "../guests/GuestDrawerHost";
import type { GuestPreview } from "../guests/GuestDrawer";
import type { LogRowView, MissingRowView } from "./helpers";
import s from "./Log.module.css";

/* Columns are defined here (render functions can't cross from the server); rows arrive pre-formatted. */

/** A table row: the formatted scan plus its server-rendered GUEST cell (`LogGuestCell`). */
export type LogTableRow = LogRowView & { cell?: ReactNode };

/** The cell wrapper: a click anywhere in it (or Enter on the name link) opens the row's drawer through one client push. */
function GuestCell({ row, open }: { row: LogTableRow; open?: (row: LogRowView, e?: MouseEvent) => void }) {
  return (
    <span className={s.guestCell} onClick={open ? (e) => open(row, e) : undefined}>
      {row.cell ?? <span className={cx(s.guest, row.anonymous && s.none)}>{row.guest}</span>}
    </span>
  );
}

const scanColumns = (open?: (row: LogRowView, e?: MouseEvent) => void): Column<LogTableRow>[] => [
  { key: "time", header: "Time", width: ".7fr", render: (r) => <span className={s.muted}>{r.time}</span>, skeleton: { width: "60%" } },
  {
    key: "result",
    header: "Result",
    width: "1.2fr",
    render: (r) => (
      <span className={s.result}>
        <Tag tone={r.tone}>{r.result}</Tag>
        {r.test ? <Tag tone="neutral">Test</Tag> : null}
      </span>
    ),
    skeleton: { shape: "pill", width: "90px" },
  },
  { key: "guest", header: "Guest", width: "1.6fr", render: (r) => <GuestCell row={r} open={open} />, skeleton: { width: "70%" } },
  { key: "match", header: "Match", width: ".7fr", render: (r) => <span className={cx(r.lowMatch && s.low)}>{r.match}</span>, skeleton: { width: "40%" } },
  { key: "door", header: "Door", width: "1fr", render: (r) => <span className={s.muted}>{r.door}</span>, skeleton: { width: "60%" } },
  { key: "latency", header: "Latency", width: ".7fr", render: (r) => <span className={s.muted}>{r.latency}</span>, skeleton: { width: "40%" } },
];

const MISSING_COLUMNS: Column<MissingRowView>[] = [
  { key: "name", header: "Name", width: "1.4fr", render: (r) => <span className={s.name}>{r.name}</span> },
  { key: "email", header: "Email", width: "1.6fr", render: (r) => <span className={s.muted}>{r.email}</span> },
  {
    key: "phone",
    header: "Phone",
    width: "1fr",
    render: (r) =>
      r.phoneHref ? (
        <a className={s.phone} href={r.phoneHref}>
          {r.phone}
        </a>
      ) : (
        <span className={s.none}>{r.phone}</span>
      ),
  },
  { key: "verified", header: "Verified", width: "1fr", render: (r) => <span className={s.muted}>{r.verified}</span> },
  {
    key: "actions",
    header: <span className={s.srOnly}>Actions</span>,
    width: "180px",
    align: "end",
    render: (r) => (
      <span className={s.actions}>
        <a href={r.emailHref} aria-label={`Email ${r.name}`}>
          Email
        </a>
        {r.phoneHref ? (
          <>
            {" · "}
            <a href={r.phoneHref} aria-label={`Call ${r.name}`}>
              Call
            </a>
          </>
        ) : null}
        {" · "}
        <a href={r.checkInHref} aria-label={`Check in ${r.name}`}>
          Check in
        </a>
      </span>
    ),
  },
];

/**
 * The row drawers load on demand (they still server-render when the URL opens them): the Guests drawer as on the
 * Guests tab (through its host), or the scan panel. Hosted from this module so the page and loading.tsx keep one
 * shared client chunk (a new client module referenced only by the page splits it, and the table ships twice).
 * React.lazy, not next/dynamic: its loader runtime would add ~1.5 KB to that chunk.
 */
const LazyScanDrawer = lazy(() => import("./ScanDrawer").then((m) => ({ default: m.ScanDrawer })));

export interface LogDrawers {
  eventId: string;
  /** Where "close" goes (the log with its filters). */
  closeHref: string;
  /** "Add as guest" target; null without guests.invite. */
  addHref: string | null;
  /** `?scan=` on a deep link: that scan of this event, whatever the filters (the rows may not list it). */
  scan?: LogRowView | null;
  /** `?guest=` on a deep link or a refresh: the page streams that guest. */
  guest?: GuestDrawerHostProps["seed"];
}

const SCAN_PARAMS = ["scan"] as const;
const param = (href: string, name: string) => new URLSearchParams(href.split("?")[1] ?? "").get(name);

/**
 * `?guest=` / `?scan=` → the row's drawer. Opening and closing only move the URL: the guest drawer's header and the
 * whole scan panel come from the row already on screen, so nothing reloads and each panel comes in once.
 */
function Drawers({ rows, eventId, closeHref, addHref, scan, guest }: LogDrawers & { rows: readonly LogRowView[] }) {
  const id = useDrawerUrl(SCAN_PARAMS).get("scan");
  const found = id ? (rows.find((r) => r.id === id && param(r.href, "scan") === id) ?? (scan?.id === id ? scan : null)) : null;
  // The panel keeps its last scan while it leaves.
  const [last, setLast] = useState(found);
  if (found && found !== last) setLast(found);
  const row = found ?? last;
  // Rows that open the guest drawer, as its header before the detail arrives (one per guest: the newest scan).
  const guests = useMemo(() => {
    const byId = new Map<string, GuestPreview>();
    for (const r of rows) {
      const reg = param(r.href, "guest");
      if (reg && !byId.has(reg)) byId.set(reg, { id: reg, name: r.guest, email: r.email, person: r.person });
    }
    return [...byId.values()];
  }, [rows]);
  return (
    <>
      <GuestDrawerHost eventId={eventId} closeHref={closeHref} rows={guests} className={s.sheet} seed={guest} />
      {row ? (
        <Suspense fallback={null}>
          <LazyScanDrawer open={!!found} row={row} date={row.date} closeHref={closeHref} addHref={addHref} go={drawerGo} />
        </Suspense>
      ) : null}
    </>
  );
}

const PersonBadge = lazy(() => import("../person/PersonBadge").then((m) => ({ default: m.PersonBadge })));

/** The rows' blue badge + tooltip, on demand (it still server-renders with the row; hydration waits for its chunk). */
export function LogPersonBadge(props: ComponentProps<typeof PersonBadge>) {
  return (
    <Suspense fallback={null}>
      <PersonBadge {...props} />
    </Suspense>
  );
}

/** Row → its drawer (`?guest=` or `?scan=` on the log URL): the URL moves, the page stays. A link click stops here so the row doesn't open twice. */
function openRow(row: LogRowView, e?: MouseEvent) {
  if (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }
  drawerGo(row.href);
}

export type LogTableProps =
  | { view: "all"; rows: LogTableRow[]; loading?: false; empty?: ReactNode; drawers?: LogDrawers }
  | { view: "all"; rows?: undefined; loading: true; empty?: undefined; drawers?: undefined }
  | { view: "missing"; rows: MissingRowView[]; loading?: false; empty?: ReactNode; drawers?: LogDrawers };

const NO_ROWS: LogRowView[] = [];

/** The A-09 table: scans (A-09a/c/d/e) or the missing guests (A-09b). */
export function LogTable(props: LogTableProps) {
  if (props.view === "missing") {
    return (
      <>
        <DataTable label="Verified guests not checked in" className={cx(s.table, s.missing)} columns={MISSING_COLUMNS} rows={props.rows} getRowId={(r) => r.id} empty={props.empty} />
        {props.drawers ? <Drawers rows={NO_ROWS} {...props.drawers} /> : null}
      </>
    );
  }
  return (
    <>
      <DataTable
        label="Check-in log"
        className={s.table}
        columns={scanColumns(props.loading ? undefined : openRow)}
        rows={props.rows ?? []}
        getRowId={(r) => r.id}
        onRowClick={props.loading ? undefined : (r) => openRow(r)}
        loading={props.loading}
        skeletonRows={8}
        empty={props.empty}
      />
      {props.drawers ? <Drawers rows={props.rows ?? NO_ROWS} {...props.drawers} /> : null}
    </>
  );
}
