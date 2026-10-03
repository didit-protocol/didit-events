import type { AdminEventStatus } from "../types";

/** One row of A-02 Events: the date tile, name, when/where, status and the guest funnel. */
export interface AdminEventRow {
  id: string;
  name: string;
  status: AdminEventStatus;
  /** "OCT" / "23" for the date tile. */
  month: string;
  day: string;
  /** "Fri 23 Oct · 19:00–23:00" (the 1024 layout shows only this). */
  when: string;
  /** "Didit HQ, Carrer de Pallars 99". */
  where: string;
  invited: number;
  verified: number;
  checkedIn: number;
}

/** The chips. A cancelled event keeps its own pill and is listed under "Ended": it is over, it has no chip of its own. */
export type StatusFilter = "all" | Exclude<AdminEventStatus, "cancelled">;

export type StatusCounts = Record<StatusFilter, number>;
