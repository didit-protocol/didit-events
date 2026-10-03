"use client";
import { actionCsrf } from "../../auth/client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { Avatar, Banner, Button, Checkbox, Skeleton, Tag, assetSrc, toast } from "@didit-events/ui";
import google from "@didit-events/ui/assets/google.svg";
import { LazyPersonBadge } from "../person/LazyBadge";
import { personPhoto } from "../person/PersonCell";
import { closedNote } from "./closed";
import { reopenRequestsAction } from "../../../app/admin/(events)/events/[id]/(tabs)/applicants/actions";
import { toCsv } from "../guests/csv";
import { drawerGo } from "../drawer/url";
import { adminLinks } from "../links";
import { handleSessionExpired } from "../system/session";
import { useAdminRouter } from "../useAdminRouter";
import { actionsFor, cellsFor, HEADS, signInLabel, TAG_TONE } from "./present";
import { ApplicantDrawerHost, type ApplicantDrawerHostProps } from "./ApplicantDrawerHost";
import { applicantsHref, listState, reviewKey } from "./query";
import { applyMoves, keyIntent, modalOpen, moveCursor, NO_MOVES, recordMoves, type Moves } from "./reviewFlow";
import { CountsContext } from "./SegCount";
import type { ApplicantCounts, ApplicantQuery, ApplicantRow, ApplicantsEvent } from "./types";
import { useReview, type ReviewFrameState } from "./useReview";
import s from "./Applicants.module.css";

export interface ApplicantsFrameState extends ReviewFrameState {
  selected?: string[];
  hover?: string;
}

export interface ApplicantsReviewProps {
  eventId: string;
  query: ApplicantQuery;
  /** Null while loading (AP-23). */
  rows: ApplicantRow[] | null;
  event: ApplicantsEvent;
  /** The segment counts; decided rows move out of them at once (optimistic) until the refreshed rows arrive. */
  counts?: ApplicantCounts;
  /** Without `counts` (render tests): the pending number for the closed banner. */
  pendingCount?: number;
  toolbar: ReactNode;
  /** AP-21 / AP-22, server-rendered. */
  empty?: ReactNode;
  frame?: ApplicantsFrameState;
  /** Frame gallery: dialogs render in place. */
  inline?: boolean;
  /**
   * The page: `?applicant=` opens the drawer over this list. Hosted from this island (not as a second client entry of
   * the page, which would ship the table's modules twice); `seed` is the applicant the page streams on a deep link.
   */
  drawer?: Pick<ApplicantDrawerHostProps, "seed">;
}

const MAIL = (
  <svg viewBox="0 0 24 24" fill="none" stroke="#6E6E73" strokeWidth="1.5" aria-hidden="true">
    <path d="M4 6h16v12H4zM4 7l8 6 8-6" />
  </svg>
);

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** AP-01…AP-25 list: banner, toolbar, table with selection + bulk bar, row actions, keyboard review, dialogs. */
export function ApplicantsReview({ eventId, query, rows: serverRows, event, counts, pendingCount = 0, toolbar, empty, frame, inline, drawer }: ApplicantsReviewProps) {
  // A decided row leaves this tab and the counts move at once; the refreshed server rows (a new array) replace the overlay.
  const [moves, setMoves] = useState<Moves>(NO_MOVES);
  const view = applyMoves(serverRows, counts ?? { pending: pendingCount, waitlist: 0, approved: 0, rejected: 0, cancelled: 0 }, moves);
  const rows = view.rows;
  const router = useAdminRouter();
  const [selected, setSelected] = useState<string[]>(frame?.selected ?? []);
  // The cursor follows the row id, so a refreshed list never moves A/W/R onto another applicant.
  const [cursorId, setCursorId] = useState<string>();
  const [, start] = useTransition();
  const tableRef = useRef<HTMLDivElement>(null);
  const review = useReview({ eventId, event, frame, onMoved: (ids, decision) => setMoves((m) => recordMoves(m, serverRows, ids, decision)), onDone: (ids) => setSelected((sel) => sel.filter((id) => !ids.includes(id))) });
  const list = rows ?? [];
  const byId = (ids: string[]) => list.filter((r) => ids.includes(r.id));
  // The drawer host swaps its content in place: opening a row only moves the URL.
  const open = (id: string) => drawerGo(applicantsHref(eventId, { ...listState(query), applicant: id }));

  const cursor = list.findIndex((r) => r.id === cursorId);

  // J/K move the review cursor, Enter opens the drawer, A/W/R decide on the cursor row (AP-03 note).
  useEffect(() => {
    if (inline) return;
    const onKey = (e: KeyboardEvent) => {
      const intent = keyIntent(reviewKey(e), { row: list[cursor], registration: event.registration, blocked: review.dialogOpen || modalOpen(document), busy: review.pending });
      if (!intent) return;
      e.preventDefault();
      if (intent.kind === "move") {
        const id = moveCursor(
          list.map((r) => r.id),
          cursorId,
          intent.dir,
        );
        if (id === undefined) return;
        setCursorId(id);
        tableRef.current?.querySelector<HTMLElement>(`[data-index="${list.findIndex((r) => r.id === id)}"]`)?.focus();
        return;
      }
      review.act(intent.decision, [intent.row]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const reopen = () =>
    start(async () => {
      const r = await reopenRequestsAction(eventId, actionCsrf(), event.editVersion).catch(() => ({ error: "invalid" as const }));
      if (handleSessionExpired(r)) return;
      toast("error" in r ? { message: r.error === "conflict" ? "This event changed since you opened it. Refresh and try again." : (("message" in r ? r.message : undefined) ?? "Couldn’t reopen requests. Try again."), tone: "danger" } : { message: "Requests are open again" });
      router.refresh();
    });

  const closed = closedNote(event, view.counts.pending);
  const failed = byId(review.errors);
  const banner =
    failed.length > 0 ? (
      <Banner
        tone="danger"
        className={s.banner}
        action={
          <button type="button" className={s.bannerCta} onClick={() => review.retry(failed)}>
            Retry all
          </button>
        }
      >
        Didit did not respond for {failed.length === 1 ? "1 applicant" : `${failed.length} applicants`}. Nothing was sent to them.
      </Banner>
    ) : query.tab === "pending" && event.registration === "full" ? (
      <Banner
        tone="warning"
        className={s.banner}
        action={
          <Link className={s.bannerCta} href={adminLinks.editEvent(eventId)}>
            Raise capacity
          </Link>
        }
      >
        You are at capacity. New requests go to the waitlist automatically.
      </Banner>
    ) : query.tab === "pending" && event.registration === "closed" ? (
      <Banner
        tone="neutral"
        className={s.banner}
        action={
          closed.reopen ? (
            <button type="button" className={s.bannerCta} onClick={reopen}>
              Reopen requests
            </button>
          ) : undefined
        }
      >
        {closed.text}
      </Banner>
    ) : query.tab === "waitlist" && event.autoPromote ? (
      <Banner
        tone="neutral"
        className={s.banner}
        action={
          <Link className={s.bannerCta} href={adminLinks.tab(eventId, "settings")}>
            Change
          </Link>
        }
      >
        Auto-promote is on: when someone cancels, #1 is approved and emailed automatically.
      </Banner>
    ) : null;

  const all = list.length > 0 && list.every((r) => selected.includes(r.id));
  const some = selected.length > 0;
  const toggle = (id: string) => setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
  const selectedRows = byId(selected);
  const exportCsv = () =>
    download(
      `applicants-${query.tab}.csv`,
      toCsv([["Name", "Email", "Sign-in", "Company", "Role", "Why", "Requested"], ...selectedRows.map((r) => [r.name, r.email, signInLabel(r.signIn), r.company, r.role, r.why, r.requested])]),
    );

  return (
    <>
      {banner}
      <CountsContext.Provider value={counts ? view.counts : null}>{toolbar}</CountsContext.Provider>
      <div className={s.table} ref={tableRef}>
        {some ? (
          <div className={s.bulk} role="region" aria-label="Bulk actions">
            <span aria-live="polite">{selected.length} selected</span>
            <span className={s.spacer} />
            {query.tab === "pending" ? (
              <>
                <button type="button" className={s.bulkBtn} data-primary="" disabled={event.registration === "full"} onClick={() => review.act("approve", selectedRows)}>
                  Approve
                </button>
                <button type="button" className={s.bulkBtn} onClick={() => review.act("waitlist", selectedRows)}>
                  Waitlist
                </button>
                <button type="button" className={s.bulkBtn} onClick={() => review.act("reject", selectedRows)}>
                  Reject
                </button>
              </>
            ) : null}
            <button type="button" className={s.bulkBtn} onClick={exportCsv}>
              Export
            </button>
            <button type="button" className={s.bulkClose} aria-label="Clear selection" onClick={() => setSelected([])}>
              ×
            </button>
          </div>
        ) : null}
        <div role="table" aria-label="Applicants" aria-busy={rows === null || undefined} aria-rowcount={list.length + 1}>
          <div role="rowgroup">
            <div role="row" className={`${s.row} ${s.head}`}>
              <span role="columnheader" className={s.cb}>
                <Checkbox aria-label="Select all applicants" checked={all ? true : some ? "mixed" : false} disabled={!list.length} onChange={() => setSelected(all ? [] : list.map((r) => r.id))} />
              </span>
              {HEADS[query.tab].map((h) => (
                <span key={h} role="columnheader">
                  {h}
                </span>
              ))}
              <span role="columnheader">
                <span className={s.sr}>Actions</span>
              </span>
            </div>
          </div>
          <div role="rowgroup" className={s.body}>
            {list.map((r, i) => {
              const c = cellsFor(r);
              const isBusy = review.busy === r.id;
              const isErr = review.errors.includes(r.id);
              return (
                <div
                  key={r.id}
                  role="row"
                  tabIndex={-1}
                  data-index={i}
                  data-cursor={cursor === i ? "" : undefined}
                  data-state={frame?.hover === r.id ? "hover" : undefined}
                  data-error={isErr ? "" : undefined}
                  aria-selected={selected.includes(r.id)}
                  className={s.row}
                  onFocus={() => setCursorId(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.target === e.currentTarget) open(r.id);
                  }}
                >
                  <span role="cell" className={s.cb}>
                    <Checkbox aria-label={`Select ${r.name}`} checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
                  </span>
                  <span role="cell" className={s.who}>
                    <Avatar name={r.name} email={r.email} src={personPhoto(r.person?.photoUrl)} size={32} tone={r.signIn === "google" ? "brand" : "neutral"} className={s.avatar} />
                    <span className={s.whoText}>
                      <span className={s.nameRow}>
                        <a className={s.name} href={applicantsHref(eventId, { ...listState(query), applicant: r.id })}>
                          {r.name}
                        </a>
                        <LazyPersonBadge verified={r.person?.verified} timeZone={r.person?.timeZone ?? "UTC"} size={15} />
                      </span>
                      <span className={s.sub}>{r.email}</span>
                    </span>
                  </span>
                  <span role="cell" className={s.signIn}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a 14px inlined SVG icon, nothing to optimise */}
                    {r.signIn === "google" ? <img src={assetSrc(google as string | { src: string })} alt="" /> : MAIL}
                    {signInLabel(r.signIn)}
                  </span>
                  <span role="cell" className={s.company}>
                    <span>{r.company}</span>
                    <span className={s.sub}>{r.role}</span>
                  </span>
                  <span role="cell" className={s.why}>
                    {c.why}
                  </span>
                  <span role="cell" className={s.tags}>
                    {c.tags.map((t) => (
                      <Tag key={t.label} tone={TAG_TONE[t.tone]} className={s.tag}>
                        {t.label}
                      </Tag>
                    ))}
                  </span>
                  <span role="cell" className={s.time}>
                    {c.time}
                  </span>
                  <span role="cell" className={s.acts}>
                    {isBusy ? (
                      <Button size="xs" loading className={s.busy}>
                        Approving
                      </Button>
                    ) : isErr ? (
                      <>
                        <span className={s.rowErr} role="alert">
                          Couldn’t create Didit link
                        </span>
                        <Button size="xs" onClick={() => review.retry([r])}>
                          Retry
                        </Button>
                      </>
                    ) : (
                      actionsFor(r, event).map((a) => (
                        <Button
                          key={a.label}
                          size="xs"
                          variant={a.kind === "primary" ? "primary" : "secondary"}
                          data-kind={a.kind}
                          aria-label={`${a.label} ${r.name}`}
                          onClick={() => (a.decision === "open" ? open(r.id) : review.act(a.decision, [r]))}
                        >
                          {a.label}
                        </Button>
                      ))
                    )}
                  </span>
                </div>
              );
            })}
            {rows === null ? Array.from({ length: 8 }, (_, i) => <SkeletonRow key={i} />) : null}
          </div>
        </div>
        {rows !== null && rows.length === 0 ? empty : null}
      </div>
      {review.dialogs()}
      {review.progressToast}
      {drawer && serverRows ? <ApplicantDrawerHost eventId={eventId} query={query} rows={serverRows} event={event} seed={drawer.seed} /> : null}
    </>
  );
}

/** AP-23 skeleton row. */
function SkeletonRow() {
  return (
    <div role="row" aria-hidden="true" className={s.row}>
      <Skeleton width={16} height={16} />
      <span className={s.skWho}>
        <Skeleton width={32} height={32} shape="pill" />
        <Skeleton width="60%" />
      </span>
      <Skeleton width="60%" />
      <Skeleton width="70%" />
      <Skeleton width="85%" />
      <Skeleton width={80} height={20} shape="pill" />
      <Skeleton width="50%" />
      <Skeleton height={28} shape="pill" className={s.skAct} />
    </div>
  );
}
