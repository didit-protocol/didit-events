/**
 * A-09 fixtures (design/01b Admin `logRaw`, `missRaw`, `logChips`): Barcelona Office Opening on Fri 23 Oct 2026,
 * doors 19:00 CEST. The chip counts are the design's aggregate (the log shows its latest page of rows).
 */
import type { DoorRef, LogFilters, LogSummary, MissingGuest, Scan } from "./types";

export const LOG_TZ = "Europe/Madrid";
export const LOG_STARTS_AT = "2026-10-23T19:00:00+02:00";

export const LOG_DOORS: DoorRef[] = [
  { id: "main-door", name: "Main door" },
  { id: "terrace", name: "Terrace" },
  { id: "staff-entrance", name: "Staff entrance" },
];

const scan = (id: string, t: string, result: Scan["result"], guestName: string | null, similarity: number, doorId: string, latencyMs: number): Scan => ({
  id,
  at: `2026-10-23T${t}+02:00`,
  result,
  guestName,
  // Named rows open the guest drawer; the id follows the guests fixtures' slug ids.
  registrationId: guestName ? guestName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "-") : null,
  guestEmail: guestName ? `${guestName.split(" ")[0]!.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")}@example.com` : undefined,
  doorId,
  similarity,
  latencyMs,
});

/** The ten drawn rows of A-09a, newest first. */
export const LOG_SCANS: Scan[] = [
  scan("scn_10", "19:42:08", "welcomed", "María García", 96, "main-door", 1200),
  scan("scn_09", "19:41:51", "welcomed", "Oliver Bennett", 94, "main-door", 1400),
  scan("scn_08", "19:41:02", "welcome_back", "Kenji Watanabe", 97, "main-door", 900),
  scan("scn_07", "19:40:17", "unknown", null, 61, "main-door", 1600),
  scan("scn_06", "19:38:44", "not_verified", "Lucía Fernández", 92, "terrace", 1300),
  scan("scn_05", "19:37:30", "welcomed", "Kenji Watanabe", 97, "main-door", 1100),
  scan("scn_04", "19:35:12", "not_on_list", "Rafael Nadal Pons", 93, "main-door", 1500),
  scan("scn_03", "19:30:05", "welcomed", "Carlos Mendoza", 95, "terrace", 1200),
  scan("scn_02", "19:26:48", "welcomed", "Chen Wei", 98, "main-door", 1000),
  scan("scn_01", "19:24:31", "welcomed", "Ingrid Nilsen", 91, "main-door", 1800),
];

/** The drawn "Missing · 56" rows (A-09b). Ids match the guests tab drawer (`?guest=<id>`). */
export const MISSING_GUESTS: MissingGuest[] = [
  { id: "amara-okafor", name: "Amara Okafor", email: "amara@relecloud.test", phone: "+234 803 555 0142", verifiedAt: "2026-10-22T10:05:00+02:00" },
  { id: "jordi-puig", name: "Jordi Puig", email: "jordi.puig@didit.me", phone: "+34 612 555 019", verifiedAt: "2026-10-18T12:40:00+02:00" },
  { id: "emma-johansson", name: "Emma Johansson", email: "emma.j@lamna.test", phone: "+46 70 555 0193", verifiedAt: "2026-10-21T09:12:00+02:00" },
  { id: "rohan-mehta", name: "Rohan Mehta", email: "rohan@coho.test", phone: "+91 98 5550 1234", verifiedAt: "2026-10-20T16:30:00+02:00" },
  { id: "grace-liu", name: "Grace Liu", email: "grace.liu@bellows.test", phone: "+852 5555 0176", verifiedAt: "2026-10-19T08:55:00+02:00" },
  { id: "lukas-becker", name: "Lukas Becker", email: "lukas@treyresearch.test", phone: "+49 151 5550 1287", verifiedAt: "2026-10-22T18:20:00+02:00" },
];

const base: Omit<LogSummary, "status" | "total" | "byResult" | "test"> = {
  timeZone: LOG_TZ,
  startsAt: LOG_STARTS_AT,
  doors: LOG_DOORS,
  pairedKiosks: ["Main door"],
  missing: 56,
};

/** A-09a: "All 186 · Welcomed 42 · Welcome back 9 · Unknown face 3 · Not on list 2 · Not verified 2". */
export const LOG_SUMMARY_LIVE: LogSummary = {
  ...base,
  status: "live",
  total: 186,
  test: 0,
  byResult: { welcomed: 42, welcome_back: 9, unknown: 3, not_on_list: 2, not_verified: 2 },
};

/** A-09c: doors not open yet, every count 0. */
export const LOG_SUMMARY_BEFORE: LogSummary = { ...base, status: "open", total: 0, test: 0, byResult: {} };

/** The fixture aggregate for a door filter: nobody outside the list was scanned at Terrace (A-09d). */
export function fixtureSummary(summary: LogSummary, f: LogFilters): LogSummary {
  if (summary.total === 0 || f.door !== "terrace") return summary;
  return { ...summary, byResult: { ...summary.byResult, not_on_list: 0 } };
}
