/**
 * A-04 fixtures (design/01 Admin `ov`): Barcelona Office Opening on Fri 23 Oct 2026, doors 19:00–23:00 CEST.
 * Each frame has its own clock: 19:47 live, 16:46 before (doors in 2h 14m), 23:30 ended.
 */
import type { Arrival, ArrivalBucket, DoorPanelKiosk, OverviewData } from "./types";

export const OV_TZ = "Europe/Madrid";
export const OV_NOW_LIVE = new Date("2026-10-23T19:47:00+02:00");
export const OV_NOW_BEFORE = new Date("2026-10-23T16:46:00+02:00");
export const OV_NOW_ENDED = new Date("2026-10-23T23:30:00+02:00");

const buckets = (counts: number[]): ArrivalBucket[] =>
  counts.map((count, i) => ({ start: new Date(Date.parse("2026-10-23T18:45:00+02:00") + i * 15 * 60_000).toISOString(), count }));

const arrival = (id: string, name: string, t: string): Arrival => ({ id, name, door: "Main door", at: `2026-10-23T${t}:00+02:00` });

export const ARRIVALS: Arrival[] = [
  arrival("maria-garcia", "María García", "19:42"),
  arrival("oliver-bennett", "Oliver Bennett", "19:41"),
  arrival("kenji-watanabe", "Kenji Watanabe", "19:37"),
  arrival("carlos-mendoza", "Carlos Mendoza", "19:30"),
  arrival("chen-wei", "Chen Wei", "19:26"),
  arrival("ingrid-nilsen", "Ingrid Nilsen", "19:24"),
  arrival("fatima-benali", "Fatima Benali", "19:21"),
];

const recent = (items: [DoorPanelKiosk["recent"][number]["result"], string, string | null][]) =>
  items.map(([result, t, guest], i) => ({ id: `r${i}`, result, at: `2026-10-23T${t}+02:00`, guest }));

/** A-17: Main door (supervised, busy), Terrace (strict, offline) and Staff entrance (paused). */
export const DOOR_PANEL: DoorPanelKiosk[] = [
  {
    id: "kio_main",
    name: "Main door",
    online: true,
    scanning: true,
    mode: "supervised",
    recent: recent([
      ["welcomed", "19:42:08", "María García"],
      ["ambiguous", "19:41:55", null],
      ["welcomed", "19:41:51", "Oliver Bennett"],
      ["inconclusive", "19:41:20", null],
      ["welcome_back", "19:41:02", "Kenji Watanabe"],
    ]),
  },
  {
    id: "kio_terrace",
    name: "Terrace",
    online: false,
    scanning: true,
    mode: "strict",
    recent: recent([
      ["liveness_failed", "19:36:10", null],
      ["not_admitted", "19:35:40", "Hannah Schmidt"],
      ["not_verified", "19:38:44", "Lucía Fernández"],
      ["welcomed", "19:30:05", "Carlos Mendoza"],
      ["welcomed", "19:21:14", "Fatima Benali"],
    ]),
  },
  { id: "kio_staff", name: "Staff entrance", online: true, scanning: false, mode: "supervised", recent: [] },
];

const base = {
  eventId: "bcn-opening",
  timeZone: OV_TZ,
  startsAt: "2026-10-23T19:00:00+02:00",
  endsAt: "2026-10-23T23:00:00+02:00",
  unknownDoors: ["Main door"],
};

export const OV_LIVE: OverviewData = {
  ...base,
  status: "live",
  counts: { approved: 124, pending: 0, registrations: 124, invited: 0, linksSent: 118, verified: 98, checkedIn: 42, unknownFaces: 3 },
  checkedInLast15: 8,
  buckets: buckets([1, 6, 14, 17, 4, 0, 0, 0, 0, 0, 0, 0]),
  arrivals: ARRIVALS,
  doors: DOOR_PANEL,
};

export const OV_BEFORE: OverviewData = {
  ...base,
  status: "open",
  counts: { approved: 124, pending: 0, registrations: 124, invited: 0, linksSent: 118, verified: 98, checkedIn: 0, unknownFaces: 0 },
  checkedInLast15: 0,
  unknownDoors: [],
  buckets: buckets([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  arrivals: [],
  doors: [{ ...DOOR_PANEL[0]!, recent: [] }],
};

export const OV_ENDED: OverviewData = {
  ...base,
  status: "ended",
  counts: { approved: 124, pending: 0, registrations: 124, invited: 0, linksSent: 122, verified: 109, checkedIn: 104, unknownFaces: 7 },
  checkedInLast15: 0,
  buckets: buckets([1, 6, 14, 17, 21, 16, 11, 8, 5, 3, 1, 1]),
  arrivals: ARRIVALS,
  doors: DOOR_PANEL,
};

export const OV_EMPTY: OverviewData = {
  ...OV_BEFORE,
  status: "draft",
  counts: { approved: 0, pending: 0, registrations: 0, invited: 0, linksSent: 0, verified: 0, checkedIn: 0, unknownFaces: 0 },
  doors: [],
};

/** An event filled through the request link only: nobody was invited; 24 approved, 3 waiting, 2 declined. */
export const OV_REQUESTS: OverviewData = {
  ...OV_BEFORE,
  counts: { approved: 24, pending: 3, registrations: 29, invited: 0, linksSent: 24, verified: 18, checkedIn: 0, unknownFaces: 0 },
};
