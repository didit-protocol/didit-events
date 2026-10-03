"use client";

import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { createDetailCache, fetchDetail, useDetail } from "../drawer/detailCache";
import { drawerGo, useDrawerUrl } from "../drawer/url";
import { allowedDialog } from "./checkin";
import type { GuestPreview } from "./GuestDrawer";
import type { GuestDetail } from "./types";

/** On demand (it still server-renders when the URL opens it): the drawer stays out of the tab's first-load JS. */
const loadDrawer = () => import("./GuestDrawer");
const LazyGuestDrawer = lazy(() => loadDrawer().then((m) => ({ default: m.GuestDrawer })));

export interface GuestDrawerHostProps {
  eventId: string;
  /** Where "close" goes (the list with its filters). */
  closeHref: string;
  /** The rows on screen: the drawer's header before the detail arrives. A new array = the list was refreshed. */
  rows?: readonly GuestPreview[];
  /** `?checkin=1` / `?undo=1` / `?revoke=1` open the drawer's dialogs (Guests tab only). */
  dialogs?: boolean;
  /** Extra class on the panel (the check-in log's bottom sheet). */
  className?: string;
  /** A deep link or a refresh with the drawer open: the page streams that guest, so the drawer does not ask again. */
  seed?: { id: string; detail: Promise<GuestDetail | null> };
}

const PARAMS = ["guest", "checkin", "undo", "revoke"] as const;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `?guest=<id>` → the A-06 drawer (Guests tab and check-in log). One drawer stays mounted while a guest is open: it
 * comes in once and leaves once, the header is the row's data at once and the sections fill from the detail route.
 */
export function GuestDrawerHost({ eventId, closeHref, rows, dialogs, className, seed }: GuestDrawerHostProps) {
  const search = useDrawerUrl(PARAMS);
  const raw = search.get("guest");
  const id = raw && ID_RE.test(raw) ? raw : undefined;
  const asked = !dialogs || !id ? undefined : search.get("checkin") ? "checkin" : search.get("undo") ? "undo" : search.get("revoke") ? "revoke" : undefined;
  const cache = useMemo(() => createDetailCache<GuestDetail>((guest) => fetchDetail(`/api/admin/events/${encodeURIComponent(eventId)}/guests/${encodeURIComponent(guest)}`)), [eventId]);
  const entry = useDetail(cache, id);
  const detail = entry?.data ?? null;
  const preview = id ? (rows?.find((r) => r.id === id) ?? null) : null;

  // Refreshed rows (an action, a live update) mean cached drawers may be behind: shown as they are, loaded again when opened.
  useEffect(() => cache.invalidate(), [cache, rows]);
  useEffect(() => {
    if (seed) cache.adopt(seed.id, seed.detail);
  }, [cache, seed]);
  useEffect(() => {
    if (id) cache.load(id);
  }, [cache, id, rows, seed]);
  // An unknown id just closes the drawer.
  const missing = !!id && entry?.data === null && !entry.loading;
  useEffect(() => {
    if (missing) drawerGo(closeHref, "replace");
  }, [missing, closeHref]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDrawer(), 600);
    return () => window.clearTimeout(timer);
  }, []);

  // Mounted from the first open on, and kept while closed so the panel can leave.
  const [used, setUsed] = useState(false);
  if (id && !used) setUsed(true);
  if (!used) return null;
  return (
    <Suspense fallback={null}>
      <LazyGuestDrawer
        eventId={eventId}
        open={!!id && !missing}
        detail={detail}
        preview={preview}
        closeHref={closeHref}
        // `?checkin=1` only opens A-14 for a guest who may be checked in (the action re-checks the stored status too).
        dialog={detail ? allowedDialog(asked, detail.status) : undefined}
        go={drawerGo}
        onDetail={(next) => cache.set(next.id, next)}
        loadError={!!entry?.error && !detail}
        onRetry={() => id && cache.load(id)}
        className={className}
      />
    </Suspense>
  );
}
