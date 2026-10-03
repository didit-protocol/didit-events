/** A-04 Overview + A-17 live door panel view models. `(tabs)/(overview)/data.ts` returns `OverviewData`. */
import type { ScanResult } from "../log/results";
import type { DoorMode as KioskMode } from "../../door/kiosk/types";
import type { AdminEventStatus } from "../types";

export interface OverviewCounts {
  /** Approved registrations: the guest list (tile "Guests", the Guests tab's count, the funnel's 100%). */
  approved: number;
  /** Requests waiting for a decision (the Requests tab's count). */
  pending: number;
  /** Registrations in every state (pending, waitlisted, approved, rejected, cancelled…). */
  registrations: number;
  /** Open invitations: sent, not yet used. They are not guests until the person joins. */
  invited: number;
  linksSent: number;
  verified: number;
  checkedIn: number;
  unknownFaces: number;
}

export interface Arrival {
  id: string;
  name: string;
  door: string;
  /** ISO instant of the check-in. */
  at: string;
}

/** One 15-minute bucket of check-ins, starting 15 minutes before doors. */
export interface ArrivalBucket {
  /** ISO start of the bucket. */
  start: string;
  count: number;
}

/** A-17: one kiosk on the live door panel. */
export interface DoorPanelKiosk {
  id: string;
  name: string;
  online: boolean;
  scanning: boolean;
  mode: KioskMode;
  /** The last five results, newest first. */
  recent: { id: string; result: ScanResult; at: string; guest: string | null }[];
}

export interface OverviewData {
  eventId: string;
  status: AdminEventStatus;
  /** Why a cancelled event was cancelled (the reason the host gave); shown in its banner. */
  cancelReason?: string | null;
  timeZone: string;
  startsAt: string;
  endsAt: string;
  counts: OverviewCounts;
  /** Check-ins in the last 15 minutes ("+8 in last 15 min"). */
  checkedInLast15: number;
  /** Doors where unknown faces were seen ("at Main door"). */
  unknownDoors: string[];
  buckets: ArrivalBucket[];
  /** Newest first. */
  arrivals: Arrival[];
  /** Paired kiosks (the before-doors banner, A-17 panel). */
  doors: DoorPanelKiosk[];
}
