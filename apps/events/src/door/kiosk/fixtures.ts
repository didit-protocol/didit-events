// Deterministic door fixtures: the names, times and counts shown in design/03 Kiosk.dc.html. Used by the /_frames
// gallery and the tests.
import type { KioskContext, ScanOutcome } from "./types";

export const FIXTURE_TIME_ZONE = "Europe/Madrid";
/** The design's door clock: 19:42 on the event day. */
export const FIXTURE_NOW = "2026-10-08T19:42:00+02:00";
export const FIXTURE_EVENT_NAME = "Barcelona Office Opening";
export const FIXTURE_KIOSK_NAME = "Main door";
export const FIXTURE_LOG_URL = "https://events.didit.me/admin/events/barcelona-office-opening/log";

export const fixtureContext = (): KioskContext => ({
  station: { id: "ksk_main_door", name: FIXTURE_KIOSK_NAME },
  session: { id: "door_1", expiresAt: "2026-10-09T11:42:00+02:00", startedBy: "maria@example.com" },
  event: { id: "evt_barcelona_office", slug: "barcelona-office-opening", name: FIXTURE_EVENT_NAME, timeZone: FIXTURE_TIME_ZONE, capacity: 120,
    startsAt: "2026-10-08T18:30:00+02:00", endsAt: "2026-10-08T23:00:00+02:00", logUrl: FIXTURE_LOG_URL },
  state: "live",
  doorMode: "supervised",
  threshold: 80,
  arrived: 42,
  budgetExhausted: false,
  pinSet: true,
  recentScans: [
    { id: "scn_5", at: "2026-10-08T19:42:00+02:00", name: "María García", result: "welcomed" },
    { id: "scn_4", at: "2026-10-08T19:41:00+02:00", name: "Oliver Bennett", result: "welcomed" },
    { id: "scn_3", at: "2026-10-08T19:40:00+02:00", name: null, result: "unknown" },
    { id: "scn_2", at: "2026-10-08T19:38:00+02:00", name: "Lucía Fernández", result: "not_verified" },
    { id: "scn_1", at: "2026-10-08T19:37:00+02:00", name: "Kenji Watanabe", result: "welcomed" },
  ],
  serverTime: FIXTURE_NOW,
});

/** One outcome per result screen, with the design's guest. */
export const FIXTURE_OUTCOMES = {
  welcomed: { result: "welcomed", fullName: "Maria García", firstName: "Maria", checkedInAt: FIXTURE_NOW },
  welcomed_test: { result: "welcomed", fullName: "Maria García", firstName: "Maria", checkedInAt: null, test: true },
  welcome_back: { result: "welcome_back", firstName: "Maria", checkedInAt: FIXTURE_NOW },
  unknown: { result: "unknown", threshold: 80, bestScore: 61 },
  not_on_list: { result: "not_on_list", firstName: "Maria" },
  not_verified: { result: "not_verified", firstName: "Maria", verification: "in_review" },
  ambiguous: { result: "ambiguous" },
  inconclusive: { result: "inconclusive" },
  not_admitted: { result: "not_admitted", firstName: "Maria", admission: "waitlisted" },
  not_admitted_rejected: { result: "not_admitted", firstName: "Maria", admission: "rejected" },
  error: { result: "error", reason: "service", retryInS: 12, requestId: "req_4f2a9c" },
  liveness_failed: { result: "liveness_failed" },
  budget_exhausted: { result: "budget_exhausted" },
} satisfies Record<string, ScanOutcome>;

/** The camera the design's operator panel shows. */
export const FIXTURE_CAMERAS = [{ value: "facetime-hd", label: "FaceTime HD Camera" }];
