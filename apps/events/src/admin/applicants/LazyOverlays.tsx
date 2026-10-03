"use client";

import dynamic from "next/dynamic";

/**
 * The drawer (AP-03…) and the invite modal (AP-16…) open on demand, so their code loads on demand too: this keeps
 * them out of the applicants tab's first-load JS. Both still server-render when the URL opens them.
 */
const loadDrawer = () => import("./ApplicantDrawer");
export const LazyApplicantDrawer = dynamic(() => loadDrawer().then((m) => m.ApplicantDrawer));
/** Fetches the drawer's code ahead of the first open, so that open is immediate. */
export const preloadApplicantDrawer = () => void loadDrawer();
export const LazyInviteModal = dynamic(() => import("./InviteModal").then((m) => m.InviteModal));
