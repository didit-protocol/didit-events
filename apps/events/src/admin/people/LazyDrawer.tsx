"use client";

import dynamic from "next/dynamic";

/** The People drawer opens on demand, so its code loads on demand too (still server-rendered when the URL opens it). */
const loadDrawer = () => import("./PeopleDrawer");
export const LazyPeopleDrawer = dynamic(() => loadDrawer().then((m) => m.PeopleDrawer));
/** Fetches the drawer's code ahead of the first open, so that open is immediate. */
export const preloadPeopleDrawer = () => void loadDrawer();
