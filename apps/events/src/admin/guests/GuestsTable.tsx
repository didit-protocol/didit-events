"use client";
import { actionCsrf } from "../../auth/client";

import { useState, useTransition, type ReactNode } from "react";
import { DataTable, DropdownMenu, MenuPanel, Spinner, StatusPill, toast, type Column, type MenuEntry } from "@didit-events/ui";
import { PersonCell } from "../person/PersonCell";
import { drawerGo } from "../drawer/url";
import { GuestDrawerHost, type GuestDrawerHostProps } from "./GuestDrawerHost";
import { useAdminRouter } from "../useAdminRouter";
import { bulkGuestsAction } from "../../../app/admin/(events)/events/[id]/(tabs)/guests/actions";
import { handleSessionExpired } from "../system/session";
import { canCheckIn, canSendLink } from "./checkin";
import { checkedInLabel, guestsHref, listState } from "./query";
import type { GuestQuery, GuestRow, GuestSortKey } from "./types";
import s from "./Guests.module.css";

export interface GuestsTableFrameState {
  selected?: string[];
  hover?: string;
  /** Draw the row menu open (A-05a) with this row's entries. */
  menuFor?: string;
}

const CHECK = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0E7A3D" strokeWidth="2" aria-label="Verified email" role="img">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

type Bulk = "approve" | "send" | "revoke";

/** The CSV export is a file download from a route handler, not a page. */
function download(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = "";
  a.click();
}

/**
 * The "⋯" row actions. `manage` (guests.invite / requests.decide) adds the link and revoke actions; check-in and undo
 * stay for every event role (checkin.manual), and the server action re-checks each capability.
 */
export function rowMenu(row: GuestRow, open: (dialog?: "checkin" | "undo" | "revoke") => void, act: (a: Bulk, ids: string[]) => void, copy: (url: string) => void, { manage = true }: { manage?: boolean } = {}): MenuEntry[] {
  const checked = row.status === "checked-in";
  const gone = row.status === "revoked";
  return [
    { id: "profile", label: "Open profile", onSelect: () => open() },
    ...(manage
      ? ([
          { id: "copy", label: "Copy verification link", onSelect: () => copy(row.verifyUrl) },
          { id: "send", label: "Send link by email", disabled: !canSendLink(row.status), onSelect: () => act("send", [row.id]) },
          { id: "resend", label: "Resend link", disabled: !canSendLink(row.status) || row.status === "approved", onSelect: () => act("send", [row.id]) },
        ] satisfies MenuEntry[])
      : []),
    { id: "didit", label: "View in Didit ↗", href: row.diditUrl, disabled: !row.diditUrl },
    { type: "separator", id: "sep" },
    { id: "checkin", label: "Manual check-in", disabled: !canCheckIn(row.status), onSelect: () => open("checkin") },
    { id: "undo", label: "Undo check-in", disabled: !checked, onSelect: () => open("undo") },
    ...(manage ? ([{ id: "revoke", label: "Revoke invite", danger: true, disabled: gone || checked, onSelect: () => open("revoke") }] satisfies MenuEntry[]) : []),
  ];
}

/** "Approved 2 guests. 1 skipped: Already checked in: undo the check-in first." */
export function bulkToast(action: Bulk, { changed, skipped }: { changed: string[]; skipped: { id: string; reason: string }[] }): { message: string; tone?: "danger" } {
  const n = changed.length;
  const done = action === "revoke" ? `Revoked ${n} invite${n === 1 ? "" : "s"}.` : action === "send" ? `Sending ${n} link${n === 1 ? "" : "s"}.` : `Approved ${n} guest${n === 1 ? "" : "s"}.`;
  if (!skipped.length) return { message: done };
  const reasons = [...new Set(skipped.map((x) => x.reason))].join("; ");
  const skip = `${skipped.length} skipped: ${reasons}.`;
  return n ? { message: `${done} ${skip}` } : { message: `Nothing changed. ${skip}`, tone: "danger" };
}

export type GuestsDrawer = Pick<GuestDrawerHostProps, "closeHref" | "seed">;

/** A-05 desktop table: selection + bulk bar, sort, row menu, density and pages (all in the URL except selection). */
export function GuestsTable({ eventId, query, rows, total, loading, empty, frame, manage = true, drawer }: { eventId: string; query: GuestQuery; rows: GuestRow[]; total: number; loading: boolean; empty?: ReactNode; frame?: GuestsTableFrameState; manage?: boolean; /** The page: `?guest=` opens the drawer over this list. Hosted from this island (a second client entry of the page would ship the table's modules twice). */ drawer?: GuestsDrawer }) {
  const router = useAdminRouter();
  const [selected, setSelected] = useState<string[]>(frame?.selected ?? []);
  const [, start] = useTransition();
  const list = listState(query);
  const go = (patch: Partial<GuestQuery>) => router.push(guestsHref(eventId, { ...list, ...patch }), { scroll: false });
  // The drawer host keeps one drawer mounted: opening a guest only moves the URL.
  const openGuest = (id: string, dialog?: "checkin" | "undo" | "revoke") => drawerGo(guestsHref(eventId, { ...list, guest: id, dialog }));
  const act = (action: Bulk, ids: string[], overCapacity = false) =>
    start(async () => {
      const result = await bulkGuestsAction(eventId, action, ids, actionCsrf(), { overCapacity });
      if (handleSessionExpired(result)) return;
      if ("error" in result) {
        if (result.error === "capacity") {
          setSelected(current => current.filter(id => !result.changed.includes(id)));
          router.refresh();
          toast({ message: "This event is at capacity.", tone: "danger", ...(result.canOverride ? { action: { label: "Approve over capacity", onClick: () => act("approve", result.remaining, true) } } : {}) });
        } else toast({ message: "Couldn’t update the guests. Try again.", tone: "danger" });
        return;
      }
      toast(bulkToast(action, result));
      setSelected([]);
      router.refresh();
    });
  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url).then(
      () => toast({ message: "Verification link copied." }),
      () => toast({ message: "Couldn’t copy. Open the guest to see the link.", tone: "danger" }),
    );
  };

  const columns: Column<GuestRow>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (r) => <PersonCell name={r.name} email={r.email} summary={r.person} sub={r.registeredAs ? `Registered as ${r.registeredAs}` : undefined} />,
      skeleton: { width: "70%" },
    },
    {
      key: "email",
      header: "Email",
      sortable: true,
      render: (r) => (
        <span className={s.email}>
          {r.email}
          {r.emailVerified ? CHECK : null}
        </span>
      ),
      skeleton: { width: "80%" },
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (r) =>
        r.sending ? (
          <span className={s.sending} aria-live="polite">
            <Spinner size={12} /> Sending…
          </span>
        ) : (
          <StatusPill status={r.status} />
        ),
      skeleton: { shape: "pill", width: "72px" },
    },
    {
      key: "verification",
      header: "Verification",
      render: (r) =>
        r.bounced ? (
          <span className={s.ver} data-bounced="">
            Email bounced ·{" "}
            <a href={guestsHref(eventId, { ...list, guest: r.id })} onClick={(e) => e.stopPropagation()}>
              Edit email
            </a>
          </span>
        ) : (
          <span className={s.ver}>{r.verification}</span>
        ),
      skeleton: { width: "60%" },
    },
    {
      key: "checkedIn",
      header: "Checked in",
      sortable: true,
      render: (r) => (
        <span className={s.ci} data-kind={r.checkedIn.kind}>
          {checkedInLabel(r.checkedIn)}
        </span>
      ),
      skeleton: { width: "50%" },
    },
    { key: "source", header: "Source", render: (r) => <span className={s.src}>{r.source}</span>, skeleton: { width: "60%" } },
    {
      key: "menu",
      header: <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Actions</span>,
      render: (r) => (
        <span className={s.more} onClick={(e) => e.stopPropagation()}>
          <DropdownMenu align="end" trigger="⋯" triggerProps={{ variant: "icon", size: "sm", "aria-label": `Actions for ${r.name}` }} items={rowMenu(r, (d) => openGuest(r.id, d), act, copy, { manage })} />
        </span>
      ),
    },
  ];

  const sort = query.sort ? { key: query.sort.key, direction: query.sort.dir } : { key: "name", direction: "asc" as const };
  const menuRow = frame?.menuFor ? rows.find((r) => r.id === frame.menuFor) : undefined;

  return (
    <>
      <DataTable
        label="Guests"
        className={s.table}
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        selectedIds={selected}
        onSelectionChange={setSelected}
        bulkActions={[
          { id: "approve", label: "Approve", onClick: (ids) => act("approve", ids) },
          { id: "send", label: "Send links by email", onClick: (ids) => act("send", ids) },
          { id: "revoke", label: "Revoke", onClick: (ids) => act("revoke", ids) },
          { id: "export", label: "Export", onClick: (ids) => download(`${guestsHref(eventId, {}).split("?")[0]}/export?ids=${encodeURIComponent(ids.join(","))}`) },
        ]}
        sort={sort}
        onSortChange={(next) => go({ sort: { key: next.key as GuestSortKey, dir: next.direction }, page: 1 })}
        density={query.density}
        onDensityChange={(density) => go({ density })}
        loading={loading}
        skeletonRows={10}
        empty={empty}
        onRowClick={(r) => openGuest(r.id)}
        pagination={loading || rows.length === 0 ? undefined : { page: query.page, pageSize: 15, total, onPageChange: (page) => go({ page }) }}
        rowStates={frame?.hover ? { [frame.hover]: "hover" } : undefined}
      />
      {drawer && !loading ? <GuestDrawerHost eventId={eventId} closeHref={drawer.closeHref} rows={rows} dialogs seed={drawer.seed} /> : null}
      {menuRow ? <MenuPanel className={s.frameMenu} label={`Actions for ${menuRow.name}`} highlighted={0} items={rowMenu(menuRow, () => {}, () => {}, () => {}, { manage })} /> : null}
    </>
  );
}
