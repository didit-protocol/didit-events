/**
 * Shared deterministic fixtures for the admin (design/01 Admin + 01b Admin). Area fixtures live next to their
 * components (`list/fixtures.ts`, `guests/fixtures.ts`, …); these are the pieces every admin frame shares.
 */
import type { EventHeaderInfo, StaffUser } from "./types";

/** The frame clock (plan: 2026-10-08T17:30:00+02:00). Frames that show the live door use their own instant. */
export const FIXED_NOW = new Date("2026-10-08T17:30:00+02:00");

/** The sidebar user drawn in design/Admin Sidebar.dc.html. */
export const ALBERTO: StaffUser = { name: "Alberto", email: "events.team@didit.me", initials: "AL", role: "owner" };

/** "Barcelona Office Opening", the event every admin frame shows. */
export const BCN_OPENING: EventHeaderInfo = {
  id: "bcn-opening",
  name: "Barcelona Office Opening",
  status: "live",
  when: "Fri 23 Oct 2026 · 19:00–23:00 CEST · Didit HQ, Carrer de Pallars 99, Barcelona",
  requestLink: "events.didit.me/r/bcn-opening",
  guestCount: 124,
  requestCount: 7,
};

export const withStatus = (status: EventHeaderInfo["status"]): EventHeaderInfo => ({ ...BCN_OPENING, status });
