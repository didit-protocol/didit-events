"use client";

import { useEffect, useMemo, useState } from "react";
import { createDetailCache, fetchDetail, useDetail } from "../drawer/detailCache";
import { drawerGo, useDrawerUrl } from "../drawer/url";
import { LazyApplicantDrawer, preloadApplicantDrawer } from "./LazyOverlays";
import { applicantsHref, listState } from "./query";
import type { ApplicantDetail, ApplicantQuery, ApplicantRow, ApplicantsEvent } from "./types";

/** What the loader (`getApplicantDetail`) answers for one applicant: the drawer and its place in the filtered list. */
export interface ApplicantFound {
  detail: ApplicantDetail;
  row: ApplicantRow;
  index: number;
  total: number;
  prevId?: string;
  nextId?: string;
}

export interface ApplicantDrawerHostProps {
  eventId: string;
  /** The list under the drawer (tab, search, filters), as the server rendered it. */
  query: ApplicantQuery;
  rows: ApplicantRow[];
  event: ApplicantsEvent;
  /** A deep link or a refresh with the drawer open: the page streams that applicant, so the drawer does not ask again. */
  seed?: { id: string; found: Promise<ApplicantFound | null> };
}

const PARAMS = ["applicant"] as const;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `?applicant=<id>` → the drawer. One drawer stays mounted while any applicant is open: it slides in once and out
 * once, and ‹ › / J / K / the advance after a decision only swap its content. The header comes from the list row at
 * once; the sections come from the detail route, with the previous and next applicants fetched ahead.
 */
export function ApplicantDrawerHost({ eventId, query, rows, event, seed }: ApplicantDrawerHostProps) {
  const raw = useDrawerUrl(PARAMS).get("applicant");
  const id = raw && ID_RE.test(raw) ? raw : undefined;
  const list = useMemo(() => listState(query), [query]);
  const listHref = applicantsHref(eventId, list);
  const cache = useMemo(() => {
    const filters = listHref.split("?")[1];
    return createDetailCache<ApplicantFound>((applicant) => fetchDetail(`/api/admin/events/${encodeURIComponent(eventId)}/applicants/${encodeURIComponent(applicant)}/detail${filters ? `?${filters}` : ""}`));
  }, [eventId, listHref]);
  const entry = useDetail(cache, id);
  const found = entry?.data ?? null;

  // The list knows the applicant's row and neighbours at once; an applicant outside it (another tab) waits for the loader.
  const at = id ? rows.findIndex((r) => r.id === id) : -1;
  const row = at >= 0 ? rows[at]! : (found?.row ?? null);
  const prevId = at >= 0 ? rows[at - 1]?.id : found?.prevId;
  const nextId = at >= 0 ? rows[at + 1]?.id : found?.nextId;
  const href = (applicant?: string) => (applicant ? applicantsHref(eventId, { ...list, applicant }) : undefined);

  // Refreshed rows (a decision, a live update) mean cached drawers may be behind: shown as they are, loaded again when opened.
  useEffect(() => cache.invalidate(), [cache, rows]);
  useEffect(() => {
    if (seed) cache.adopt(seed.id, seed.found);
  }, [cache, seed]);
  useEffect(() => {
    if (!id) return;
    cache.load(id);
    cache.prefetch([prevId, nextId].filter((x): x is string => !!x));
  }, [cache, id, prevId, nextId, rows, seed]);
  // An unknown id just closes the drawer.
  const missing = !!id && at < 0 && entry?.data === null && !entry.loading;
  useEffect(() => {
    if (missing) drawerGo(listHref, "replace");
  }, [missing, listHref]);

  useEffect(() => {
    const timer = window.setTimeout(preloadApplicantDrawer, 600);
    return () => window.clearTimeout(timer);
  }, []);

  // Mounted from the first open on, and kept while closed so the panel can slide out.
  const [used, setUsed] = useState(false);
  if (id && !used) setUsed(true);
  if (!used) return null;
  const open = !!id && !missing;
  return (
    <LazyApplicantDrawer
      eventId={eventId}
      open={open}
      detail={found?.detail ?? null}
      row={row}
      event={event}
      index={at >= 0 ? at + 1 : (found?.index ?? 0)}
      total={at >= 0 ? rows.length : (found?.total ?? 0)}
      prevHref={href(prevId)}
      nextHref={href(nextId)}
      closeHref={listHref}
      go={drawerGo}
      onDecided={cache.invalidate}
      loadError={!!entry?.error && !found}
      onRetry={() => id && cache.load(id)}
    />
  );
}
