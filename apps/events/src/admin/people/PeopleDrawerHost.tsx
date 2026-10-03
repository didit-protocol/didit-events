"use client";

import { useEffect, useMemo, useState } from "react";
import { createDetailCache, fetchDetail, useDetail } from "../drawer/detailCache";
import { drawerGo, useDrawerUrl } from "../drawer/url";
import { LazyPeopleDrawer, preloadPeopleDrawer } from "./LazyDrawer";
import type { PeopleDetail, PeopleRow } from "./types";

export interface PeopleDrawerHostProps {
  /** Where "close" goes (the list with its filters). */
  closeHref: string;
  /** The rows on screen: the drawer's header before the detail arrives. A new array = the list was refreshed. */
  rows: readonly PeopleRow[];
  /** One clock read per request (relative times render the same on the server and at hydration). */
  now: string;
  /** A deep link or a refresh with the drawer open: the page streams that account, so the drawer does not ask again. */
  seed?: { id: string; detail: Promise<PeopleDetail | null> };
}

const PARAMS = ["person"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `?person=<accountId>` → the profile drawer. One drawer stays mounted while a person is open: it comes in once and
 * leaves once, the header is the row's data at once and the sections fill from the detail route.
 */
export function PeopleDrawerHost({ closeHref, rows, now, seed }: PeopleDrawerHostProps) {
  const raw = useDrawerUrl(PARAMS).get("person");
  const id = raw && UUID.test(raw) ? raw.toLowerCase() : undefined;
  const cache = useMemo(() => createDetailCache<PeopleDetail>((account) => fetchDetail(`/api/admin/people/${encodeURIComponent(account)}`)), []);
  const entry = useDetail(cache, id);
  const detail = entry?.data ?? null;
  const preview = id ? (rows.find((r) => r.id === id) ?? null) : null;

  // Refreshed rows mean cached drawers may be behind: shown as they are, loaded again when opened.
  useEffect(() => cache.invalidate(), [cache, rows]);
  useEffect(() => {
    if (seed) cache.adopt(seed.id, seed.detail);
  }, [cache, seed]);
  useEffect(() => {
    if (id) cache.load(id);
  }, [cache, id, rows, seed]);
  // An unknown account just closes the drawer.
  const missing = !!id && entry?.data === null && !entry.loading;
  useEffect(() => {
    if (missing) drawerGo(closeHref, "replace");
  }, [missing, closeHref]);

  useEffect(() => {
    const timer = window.setTimeout(preloadPeopleDrawer, 600);
    return () => window.clearTimeout(timer);
  }, []);

  // Mounted from the first open on, and kept while closed so the panel can leave.
  const [used, setUsed] = useState(false);
  if (id && !used) setUsed(true);
  if (!used) return null;
  return <LazyPeopleDrawer open={!!id && !missing} detail={detail} preview={preview} closeHref={closeHref} now={now} go={drawerGo} loadError={!!entry?.error && !detail} onRetry={() => id && cache.load(id)} />;
}
