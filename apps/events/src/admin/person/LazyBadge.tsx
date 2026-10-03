"use client";

import dynamic from "next/dynamic";

/**
 * The table rows' badge (seal + tooltip + date formatting) loads as its own chunk: it still server-renders with the
 * row, but its code stays out of the Guests / Requests first-load JS (the guests loading skeleton and page each carry
 * a copy of the table).
 */
export const LazyPersonBadge = dynamic(() => import("./PersonBadge").then((m) => m.PersonBadge));
