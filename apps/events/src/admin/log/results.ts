/**
 * Kiosk scan results (plan §2 `scans.result`, plus `liveness_failed` from C27 / K-18): their staff-facing label,
 * tag tone and short filter-chip label. The drawn ones follow 01b Admin A-09 (`RES`); the rest follow
 * design-prompt §3 (K-15 "Two close matches", K-16 "Inconclusive", K-17 "Not admitted", K-18 "Liveness failed").
 */
import type { TagTone } from "@didit-events/ui";

export const SCAN_RESULTS = [
  "welcomed",
  "welcome_back",
  "unknown",
  "ambiguous",
  "not_on_list",
  "not_admitted",
  "not_verified",
  "no_face",
  "inconclusive",
  "liveness_failed",
  "paused",
  "budget_exhausted",
  "error",
] as const;

export type ScanResult = (typeof SCAN_RESULTS)[number];

export const isScanResult = (v: unknown): v is ScanResult => typeof v === "string" && (SCAN_RESULTS as readonly string[]).includes(v);

interface ResultDef {
  /** Label in the log and on the door panel. */
  label: string;
  /** Short label on the A-09 filter chips ("Not on list", "Not verified"). */
  chip: string;
  tone: TagTone;
  /** A person stood at the kiosk (false for system outcomes: no face, paused, budget, error). */
  person: boolean;
}

export const RESULTS: Record<ScanResult, ResultDef> = {
  welcomed: { label: "Welcomed", chip: "Welcomed", tone: "success", person: true },
  welcome_back: { label: "Welcome back", chip: "Welcome back", tone: "soft", person: true },
  unknown: { label: "Unknown face", chip: "Unknown face", tone: "dark", person: true },
  not_on_list: { label: "Not on this list", chip: "Not on list", tone: "warning", person: true },
  not_verified: { label: "Not verified yet", chip: "Not verified", tone: "feature", person: true },
  ambiguous: { label: "Two close matches", chip: "Two close matches", tone: "neutral", person: true },
  inconclusive: { label: "Inconclusive", chip: "Inconclusive", tone: "neutral", person: true },
  not_admitted: { label: "Not admitted", chip: "Not admitted", tone: "warning", person: true },
  liveness_failed: { label: "Liveness failed", chip: "Liveness failed", tone: "danger", person: true },
  no_face: { label: "No face", chip: "No face", tone: "soft", person: false },
  paused: { label: "Paused", chip: "Paused", tone: "soft", person: false },
  budget_exhausted: { label: "Limit reached", chip: "Limit reached", tone: "warning", person: false },
  error: { label: "Error", chip: "Error", tone: "danger", person: false },
};

/** The five result chips A-09 always shows (with 0 counts before doors open), in design order. */
export const BASE_CHIPS: ScanResult[] = ["welcomed", "welcome_back", "unknown", "not_on_list", "not_verified"];
