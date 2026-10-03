"use client";

import dynamic from "next/dynamic";

/**
 * Settings → Event details editor (date picker, time fields, leave guard) loads as its own chunk: it still
 * server-renders with the page, but its code stays out of the settings tab's first-load JS.
 */
export const LazyDetailsForm = dynamic(() => import("./DetailsForm").then((m) => m.DetailsForm));
