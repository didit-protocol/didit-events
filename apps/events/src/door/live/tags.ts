// What each face's AR tag says, and the Arrivals rail. Pure: results in, view models out.
import type { NotAdmittedReason, FaceScan } from "../kiosk/types";

export type ChipTone = "green" | "amber" | "gray" | "blue";

export interface TagView {
  kind: "none" | "checking" | "result" | "offline" | "guidance";
  /** First + last name (truncated at render). */
  name?: string;
  verified?: boolean;
  chip?: { text: string; tone: ChipTone };
  /** Framing help for this face ("More light, please"), shown until it is recognised. */
  guidance?: string | null;
}

const ADMISSION: Record<NotAdmittedReason, string> = {
  pending: "Request pending",
  waitlisted: "Waitlisted",
  rejected: "Request declined",
  withdrawn: "Request withdrawn",
  cancelled: "Place cancelled",
  revoked: "Place revoked",
};

export const COME_CLOSER = "Come closer for the face check";

/** The name a result shows: the server's display name, else the first name. */
export const resultName = (scan: FaceScan): string | undefined =>
  scan.displayName ?? scan.firstName ?? ("fullName" in scan ? scan.fullName : "firstName" in scan ? scan.firstName : undefined) ?? undefined;

/** The status chip of a recognised face. */
export function resultChip(scan: FaceScan): { text: string; tone: ChipTone } {
  if (scan.test && (scan.result === "welcomed" || scan.result === "welcome_back")) return { text: "Test", tone: "blue" };
  switch (scan.result) {
    case "welcomed":
      return { text: "Checked in", tone: "green" };
    case "welcome_back":
      return { text: "Welcome back", tone: "green" };
    case "not_on_list":
      return { text: "Not on the list", tone: "amber" };
    case "not_admitted":
      return { text: ADMISSION[scan.admission], tone: "amber" };
    case "not_verified":
      return { text: "Verification incomplete", tone: "amber" };
    case "liveness_needed":
      return { text: COME_CLOSER, tone: "amber" };
    case "liveness_failed":
      return { text: "Please see the desk", tone: "amber" };
    case "ambiguous":
      return { text: "Two close matches — see the desk", tone: "gray" };
    case "inconclusive":
      return { text: "Couldn't confirm who this is — see the desk", tone: "gray" };
    case "no_face":
      return { text: "Couldn't read your face — step closer", tone: "gray" };
    case "error":
      return { text: "Couldn't check — trying again", tone: "gray" };
    case "paused":
      return { text: "Door closed", tone: "gray" };
    case "budget_exhausted":
      return { text: "Scan limit reached", tone: "amber" };
    default:
      return { text: "Unknown", tone: "gray" };
  }
}

export type FaceState =
  | { state: "idle"; guidance?: string | null }
  | { state: "checking" }
  | { state: "done"; scan: FaceScan }
  | { state: "offline" };

/** One face's tag. Names only appear for people the door recognised; unknown faces get a gray chip and no name. */
export function tagView(face: FaceState): TagView {
  switch (face.state) {
    case "checking":
      return { kind: "checking" };
    case "offline":
      return { kind: "offline", chip: { text: "Offline", tone: "gray" } };
    case "idle":
      return face.guidance ? { kind: "guidance", guidance: face.guidance } : { kind: "none" };
    case "done": {
      const { scan } = face;
      const named = ["welcomed", "welcome_back", "not_on_list", "not_admitted", "not_verified"].includes(scan.result);
      return { kind: "result", name: named ? resultName(scan) : undefined, verified: named && scan.verified === true, chip: resultChip(scan) };
    }
  }
}

/** Shortens a name to `max` characters with an ellipsis (the tag also clips with CSS; this keeps the text sane). */
export function fitName(name: string, max = 26): string {
  const clean = name.trim().replace(/\s+/g, " ");
  const chars = [...clean];
  return chars.length <= max ? clean : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

export const initials = (name: string): string =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => [...part][0]!.toUpperCase()).join("") || "?";

export interface Arrival {
  key: string;
  name: string;
  verified: boolean;
  /** Epoch ms. */
  at: number;
  tone: ChipTone;
  label: string;
}

export const ARRIVALS_MAX = 8;

/** A check-in (or a Test-mode would-be one) for the rail, or null for every other result. */
export function arrivalOf(scan: FaceScan, at: number): Arrival | null {
  if (scan.result !== "welcomed" && scan.result !== "welcome_back") return null;
  const name = resultName(scan) ?? "Guest";
  const chip = resultChip(scan);
  return { key: `${name}:${at}`, name, verified: scan.verified === true, at, tone: chip.tone, label: chip.text };
}

/** Newest first, at most ARRIVALS_MAX; the same person scanned again moves to the top instead of repeating. */
export function addArrival(list: readonly Arrival[], arrival: Arrival, max = ARRIVALS_MAX): Arrival[] {
  return [arrival, ...list.filter((a) => a.name !== arrival.name)].slice(0, max);
}

/** The live-region sentence for a result, or null when nothing is worth announcing. */
export function announcement(scan: FaceScan): string | null {
  const name = resultName(scan);
  if (scan.test && (scan.result === "welcomed" || scan.result === "welcome_back")) return `Test mode: ${name ?? "guest"} recognised. Nobody was checked in.`;
  if (scan.result === "welcomed") return `Welcome, ${name ?? "guest"}. Checked in.`;
  if (scan.result === "welcome_back") return `Welcome back, ${name ?? "guest"}.`;
  return null;
}
