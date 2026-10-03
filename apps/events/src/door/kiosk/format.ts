import type { ScanResult } from "./types";

/** "19:42" in the event's time zone (24 h). */
export function formatClock(at: Date | number | string, timeZone: string): string {
  const d = at instanceof Date ? at : new Date(at);
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(d);
}

/** "4:59" for a lock-out countdown. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}


/** K-13 "last 5 scans" pill copy and tone per result. */
export const SCAN_RESULT_PILL: Record<ScanResult, { label: string; tone: "ok" | "neutral" | "warn" }> = {
  welcomed: { label: "Welcomed", tone: "ok" },
  welcome_back: { label: "Welcome back", tone: "ok" },
  unknown: { label: "Unknown", tone: "neutral" },
  no_face: { label: "No face", tone: "neutral" },
  paused: { label: "Paused", tone: "neutral" },
  not_verified: { label: "Not verified", tone: "warn" },
  not_on_list: { label: "Not on list", tone: "warn" },
  not_admitted: { label: "Not admitted", tone: "warn" },
  ambiguous: { label: "Double check", tone: "warn" },
  inconclusive: { label: "Can't confirm", tone: "warn" },
  liveness_failed: { label: "Liveness failed", tone: "warn" },
  budget_exhausted: { label: "Limit reached", tone: "warn" },
  error: { label: "Error", tone: "warn" },
  liveness_needed: { label: "Come closer", tone: "neutral" },
};
