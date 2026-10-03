"use client";

import type { ReactNode } from "react";
import { DataTable, Tag, type Column } from "@didit-events/ui";
import { fmtWhen } from "../person/format";
import { PersonCell } from "../person/PersonCell";
import { drawerGo } from "../drawer/url";
import { PeopleDrawerHost, type PeopleDrawerHostProps } from "./PeopleDrawerHost";
import { useAdminRouter } from "../useAdminRouter";
import { listState, PAGE_SIZE, PEOPLE_TZ, peopleHref, relativeWhen } from "./query";
import type { PeopleQuery, PeopleRow, PeopleSortKey } from "./types";
import { VerificationTag } from "./VerificationTag";
import s from "./People.module.css";

const CHECK = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0E7A3D" strokeWidth="2" aria-label="Verified email" role="img">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

const ROLE_LABEL = { owner: "Owner", admin: "Admin", staff: "Staff" } as const;

export type PeopleDrawerSeed = Pick<PeopleDrawerHostProps, "seed">;

/** People desktop table: sort, density and pages live in the URL; a row (or its name link) opens the drawer. */
export function PeopleTable({ query, rows, total, loading, empty, now, drawer }: { query: PeopleQuery; rows: PeopleRow[]; total: number; loading: boolean; empty?: ReactNode; now: string; /** The page: `?person=` opens the drawer over this list. Hosted from this island (a second client entry of the page would ship the table's modules twice). */ drawer?: PeopleDrawerSeed }) {
  const router = useAdminRouter();
  const list = listState(query);
  const go = (patch: Partial<PeopleQuery>) => router.push(peopleHref({ ...list, ...patch }), { scroll: false });
  const at = new Date(now);

  const columns: Column<PeopleRow>[] = [
    {
      key: "name",
      header: "Name",
      width: "1.6fr",
      sortable: true,
      render: (r) => (
        <PersonCell
          name={r.name}
          email={r.email}
          summary={{ ...(r.photoUrl ? { photoUrl: r.photoUrl } : {}), ...(r.verified ? { verified: r.verified } : {}), timeZone: PEOPLE_TZ }}
          href={peopleHref({ ...list, person: r.id })}
          // No name on the account: the row's name falls back to the email, which the next column already shows.
          unnamed={r.name === r.email ? "No name yet" : undefined}
          sub={r.staffRole ? `${ROLE_LABEL[r.staffRole]} · Didit staff` : r.memberships ? `Event team · ${r.memberships} event${r.memberships === 1 ? "" : "s"}` : undefined}
        />
      ),
      skeleton: { width: "70%" },
    },
    {
      key: "email",
      header: "Email",
      width: "1.6fr",
      sortable: true,
      render: (r) => (
        <span className={s.email}>
          <span className={s.ellipsis}>{r.email}</span>
          {r.emailVerified ? CHECK : null}
        </span>
      ),
      skeleton: { width: "80%" },
    },
    {
      key: "work",
      header: "Headline / company",
      width: "1.4fr",
      render: (r) => {
        const work = [r.headline, r.company].filter(Boolean).join(" · ");
        return work ? <span className={s.work}>{work}</span> : <span className={s.muted}>—</span>;
      },
      skeleton: { width: "60%" },
    },
    { key: "verification", header: "Verification", width: "0.9fr", render: (r) => <VerificationTag row={r} />, skeleton: { shape: "pill", width: "72px" } },
    { key: "registered", header: "Events", width: "0.55fr", sortable: true, tnum: true, render: (r) => <span className={s.num}>{r.registered}</span>, skeleton: { width: "30%" } },
    {
      key: "attended",
      header: "Attended",
      width: "0.6fr",
      sortable: true,
      tnum: true,
      render: (r) => (r.attended ? <Tag tone="success">{r.attended}</Tag> : <span className={s.muted}>0</span>),
      skeleton: { width: "30%" },
    },
    { key: "lastActive", header: "Last active", width: "0.85fr", sortable: true, render: (r) => <span className={s.when}>{relativeWhen(r.lastActiveAt, at)}</span>, skeleton: { width: "60%" } },
    {
      key: "createdAt",
      header: "Signed up",
      width: "0.85fr",
      sortable: true,
      render: (r) => (
        <time className={s.when} dateTime={r.createdAt}>
          {fmtWhen(r.createdAt, PEOPLE_TZ)}
        </time>
      ),
      skeleton: { width: "60%" },
    },
  ];

  const sort = query.sort ? { key: query.sort.key, direction: query.sort.dir } : { key: "createdAt", direction: "desc" as const };

  return (
    <>
      <DataTable
        label="People"
        className={s.table}
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        sort={sort}
        onSortChange={(next) => go({ sort: { key: next.key as PeopleSortKey, dir: next.direction }, page: 1 })}
        density={query.density}
        onDensityChange={(density) => go({ density })}
        loading={loading}
        skeletonRows={10}
        empty={empty}
        // The drawer host keeps one drawer mounted: opening a person only moves the URL.
        onRowClick={(r) => drawerGo(peopleHref({ ...list, person: r.id }))}
        pagination={loading || rows.length === 0 ? undefined : { page: query.page, pageSize: PAGE_SIZE, total, onPageChange: (page) => go({ page }) }}
      />
      {drawer && !loading ? <PeopleDrawerHost closeHref={peopleHref(list)} rows={rows} now={now} seed={drawer.seed} /> : null}
    </>
  );
}
