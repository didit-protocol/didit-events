/**
 * Admin view models (lane U2). F1's domain services are not merged yet, so the admin renders these typed props;
 * every route reads them through its own `data.ts`, which is the single swap point when the services land.
 */

/** The signed-in account with staff access derived from its verified email. */
export interface StaffUser {
  photoUrl?: string;
  name: string;
  email: string;
  initials: string;
  role: "owner" | "admin" | "staff";
  /** An event team member (host or door operator of some events): the admin shows only their events, no global sections. */
  member?: "host" | "operator";
}

import type { AccessRole } from "@didit-events/core/access/capabilities";

/**
 * Event lifecycle as the admin shows it (plan §2 `events.status`, with `published` split into open/live by time).
 * A cancelled event is "cancelled" before and after its date: never "ended", which reads as if it had taken place.
 */
export type AdminEventStatus = "draft" | "open" | "live" | "ended" | "cancelled";

/** Tabs of /admin/events/[id]. `applicants` is owned by lane U3 (link only here). */
export type EventTab = "overview" | "guests" | "applicants" | "log" | "door" | "team" | "settings";

/** What the event header (breadcrumb, title, pill, tabs) needs. */
export interface EventHeaderInfo {
  id: string;
  name: string;
  status: AdminEventStatus;
  /** "Fri 23 Oct 2026 · 19:00–23:00 CEST · Didit HQ, Carrer de Pallars 99, Barcelona" */
  when: string;
  /** Public request link, shown without scheme ("events.didit.me/r/bcn-opening"). */
  requestLink: string;
  /** The same link as an absolute URL built from APP_URL (http on localhost). Absent in fixtures: https is assumed. */
  publicUrl?: string;
  guestCount: number;
  requestCount: number;
  /** Plan §2 `registration_mode`; "request" adds "· Approval required" to the applicants meta line (AP-01). */
  mode?: "request" | "invite_only" | "open";
  /** An open event at capacity or past its close date shows FULL / CLOSED instead of OPEN (AP-24, AP-25). */
  registration?: "open" | "full" | "closed";
  /** Tabs the viewer's role may open (capability matrix); absent = every tab. */
  tabs?: EventTab[];
  /** The viewer's role on this event, for role-aware actions. */
  role?: AccessRole;
  /** Optimistic edit version the lifecycle actions (Publish, Cancel event) are sent with. */
  editVersion?: number;
}
