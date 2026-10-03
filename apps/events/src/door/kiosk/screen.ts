// Which door screen (design K-01…K-21, plus D-01…D-03 for the in-Events door) to show, as a pure function of the
// door's state. The live door and the /_frames gallery both render through this, so every frame is a reachable state.
import type { KioskCameraTone, KioskFacePose, KioskIconTone, KioskOvalTone } from "@didit-events/ui/kiosk";
import type { CameraError } from "../face/camera";
import { HINT_COPY, type HintCode } from "../face/hints";
import type { EngineState, VerifyTimeout } from "../face/engine";
import { SEE_DESK, UNAVAILABLE } from "./copy";
import { formatClock } from "./format";
import type { DoorOpenState, NotAdmittedReason, OutageReason, ScanOutcome, SessionEnd, VerificationState } from "./types";

interface ScreenBase {
  /** Design frame code (K-01, K-03, …) for tests and debugging. */
  code: string;
  /** `none` = black canvas (camera not running); `live` = the camera layer. */
  camera: "none" | "live";
  cameraTone: KioskCameraTone;
  cameraDark?: boolean;
}

export interface OvalScreen extends ScreenBase {
  kind: "oval";
  tone: KioskOvalTone;
  head?: string;
  accent?: string;
  hint?: string;
  sub?: string;
  ring?: number;
  scan?: boolean;
  breathing?: boolean;
  /** Show the "42 / 120 arrived" counter (idle only). */
  counter?: boolean;
  /** Where the frames' stand-in face sits (ignored with a live camera). */
  pose?: KioskFacePose;
  frozen?: boolean;
  second?: boolean;
}

export interface MessageScreen extends ScreenBase {
  kind: "message";
  icon?: string;
  iconTone?: KioskIconTone;
  iconLabel?: string;
  head: string;
  sub?: string;
  chip?: string;
  error?: string;
}

export interface WelcomeScreen extends ScreenBase {
  kind: "welcome";
  hero: boolean;
  greeting: string;
  name: string;
  sub: string;
  time: string;
}

export type ScreenModel = OvalScreen | MessageScreen | WelcomeScreen;

export { SEE_DESK, UNAVAILABLE };


const VERIFICATION_LABEL: Record<VerificationState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  in_review: "In review",
  declined: "Declined",
  requirements_unmet: "Requirements not met",
};

const ADMISSION_LABEL: Record<NotAdmittedReason, string> = {
  pending: "Request pending",
  waitlisted: "Waitlisted",
  rejected: "Request declined",
  withdrawn: "Request withdrawn",
  cancelled: "Place cancelled",
  revoked: "Place revoked",
};

export interface DoorInfo {
  eventName: string;
  timeZone: string;
}

/* ── Oval states ────────────────────────────────────────────── */

export function idleScreen(door: DoorInfo, overlayOpen = false): OvalScreen {
  // K-13: with the operator panel open the headline and counter give way to it.
  return overlayOpen
    ? { code: "K-13", kind: "oval", camera: "live", cameraTone: "live", tone: "idle", sub: HINT_COPY.no_face }
    : {
        code: "K-01",
        kind: "oval",
        camera: "live",
        cameraTone: "live",
        tone: "idle",
        sub: HINT_COPY.no_face,
        breathing: true,
        counter: true,
      };
}

const POSE: Partial<Record<HintCode, KioskFacePose>> = { too_far: "far", too_close: "near", off_center: "off", too_dark: "dim" };

export function adjustScreen(hint: Exclude<HintCode, "no_face">): OvalScreen {
  return {
    code: "K-03",
    kind: "oval",
    camera: "live",
    cameraTone: "live",
    cameraDark: hint === "too_dark",
    tone: "face",
    hint: HINT_COPY[hint],
    pose: POSE[hint] ?? "on",
    second: hint === "multiple_faces",
  };
}

export function holdScreen(progress: number): OvalScreen {
  return { code: "K-04", kind: "oval", camera: "live", cameraTone: "live", tone: "blue", ring: progress, hint: "Hold still…", pose: "on" };
}

/** K-05a, then K-05b after 4 s. */
export function verifyingScreen(elapsedMs: number): OvalScreen {
  const late = elapsedMs >= 4000;
  return {
    code: late ? "K-05b" : "K-05a",
    kind: "oval",
    camera: "live",
    cameraTone: "live",
    tone: "blue",
    scan: true,
    frozen: true,
    hint: late ? "Almost there…" : "Checking…",
    pose: "on",
  };
}

/* ── Messages ───────────────────────────────────────────────── */

const message = (m: Omit<MessageScreen, "kind" | "camera" | "cameraTone"> & Partial<Pick<MessageScreen, "camera" | "cameraTone">>): MessageScreen => ({
  kind: "message",
  camera: "live",
  cameraTone: "live",
  ...m,
});

/** K-02a/b/c. `retryInS`: the K-02c countdown to the next camera reopen (backs off from 5 s). */
export function cameraErrorScreen(error: CameraError, retryInS = 5): MessageScreen {
  const base = { icon: "!", iconTone: "warn" as const, iconLabel: "Warning", camera: "none" as const };
  switch (error) {
    case "permission_denied":
      return message({ ...base, code: "K-02a", head: "Camera access needed", sub: "Staff: click the camera icon in the address bar and allow access, then reload.", chip: "NotAllowedError · chrome://settings/content/camera" });
    case "in_use":
      return message({ ...base, code: "K-02c", head: "Camera is busy", sub: "Another app is using the camera. Staff: close it and we’ll retry automatically.", chip: `NotReadableError · retrying in ${retryInS}s` });
    case "not_found":
      return message({ ...base, code: "K-02b", head: "No camera found", sub: "Staff: connect a camera or pick one in the operator panel.", chip: "NotFoundError · 0 video inputs" });
    default:
      return message({ ...base, code: "K-02b", head: "No camera found", sub: "Staff: connect a camera or pick one in the operator panel.", chip: "Camera error · check the operator panel" });
  }
}

export function pausedScreen(): MessageScreen {
  return message({ code: "K-11", icon: "II", iconLabel: "Paused", head: "Check-in paused", sub: SEE_DESK, cameraTone: "dim" });
}

/** K-12a/b/c: the door can't reach Didit / Events. `requestId` lets staff quote the failing request. */
export function outageScreen(reason: OutageReason, retryInS: number, lastOnline: string | null = null, requestId?: string): MessageScreen {
  const base = { icon: "!", iconTone: "warn" as const, iconLabel: "Warning", head: UNAVAILABLE, sub: `Retrying in ${Math.max(0, Math.ceil(retryInS))}s`, cameraTone: "dim" as const };
  if (reason === "credits") return message({ ...base, code: "K-12b", chip: "Out of Didit credits · top up in Console" });
  if (reason === "network")
    return message({ ...base, code: "K-12c", sub: `No internet connection. Retrying in ${Math.max(0, Math.ceil(retryInS))}s`, chip: lastOnline ? `Network offline · last online ${lastOnline}` : "Network offline" });
  return message({ ...base, code: "K-12a", ...(requestId ? { chip: `Server error · ref ${requestId}` } : {}) });
}

/** "Thu 8 Oct, 18:30" in the event's time zone. */
export function formatDoorsOpen(at: string | number | Date, timeZone: string): string {
  const d = at instanceof Date ? at : new Date(at);
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone }).format(d);
  return `${day}, ${formatClock(d, timeZone)}`;
}

/**
 * D-01: the door admits nobody right now. Shown instead of a dead "paused" screen, with the way to try it anyway:
 * Test mode runs the real recognition at any time (except with face check-in off) and checks nobody in.
 */
export function closedScreen(state: Exclude<DoorOpenState, "live">, door: { startsAt: string; timeZone: string }): MessageScreen {
  const tryIt = "Staff: press O and start Test mode to try the door. Nobody is checked in.";
  const base = { icon: "II", iconLabel: "Closed", cameraTone: "dim" as const };
  switch (state) {
    case "not_started":
      return message({ ...base, code: "D-01a", head: `Doors open ${formatDoorsOpen(door.startsAt, door.timeZone)}`, sub: tryIt, chip: "Not started" });
    case "ended":
      return message({ ...base, code: "D-01b", head: "This event has ended", sub: tryIt, chip: "Ended" });
    case "cancelled":
      return message({ ...base, code: "D-01c", head: "This event was cancelled", sub: tryIt, chip: "Cancelled" });
    case "draft":
      return message({ ...base, code: "D-01d", head: "This event isn’t published yet", sub: tryIt, chip: "Draft" });
    case "face_off":
      return message({ ...base, code: "D-01e", icon: "!", iconTone: "warn", iconLabel: "Warning", head: "Face check-in is off for this event", sub: "A host can turn it on in the event’s Door settings. Check guests in by hand from the guest list.", chip: "Face check-in off" });
  }
}

/** D-02: the door session stopped. The camera stays on; the member signs in again (or a teammate takes over). */
export function sessionScreen(reason: SessionEnd): MessageScreen {
  const head = reason === "revoked" ? "Door access was removed" : reason === "expired" ? "Door session expired" : "Door mode ended";
  const sub = reason === "revoked" ? "The person who started this door no longer has access to the event. A team member can sign in to restart it."
    : "Staff: sign in again to keep the door running. The station name is kept.";
  return message({ code: "D-02", icon: "!", iconTone: "warn", iconLabel: "Warning", head, sub, chip: reason === "expired" ? "Sessions last one evening" : "Sign in required", cameraTone: "dim" });
}

/** D-03: Test mode labels every result: what WOULD happen, and that nobody was checked in. */
export function asTest(model: ScreenModel): ScreenModel {
  if (model.kind === "welcome") return { ...model, code: `${model.code}-test`, greeting: `Test · ${model.greeting}`, sub: "Test mode: would be checked in. Nobody was.", time: "" };
  if (model.kind === "message") return { ...model, code: `${model.code}-test`, chip: model.chip ? `Test mode · ${model.chip}` : "Test mode · nobody checked in" };
  return model;
}

/** K-19: the daily scan budget is spent (plan §6.6); staff check guests in by hand. */
export function budgetScreen(): MessageScreen {
  return message({ code: "K-19", icon: "!", iconTone: "warn", iconLabel: "Warning", head: UNAVAILABLE, sub: SEE_DESK, chip: "Scan limit reached for today. Manual check-in only.", cameraTone: "dim" });
}

/** The screen for a scan result (K-06…K-10, K-12, K-15…K-19). */
export function outcomeScreen(outcome: ScanOutcome | VerifyTimeout, door: DoorInfo & { threshold: number }, resultElapsedMs = 0): ScreenModel {
  if ("kind" in outcome) return outageScreen("service", (4000 - resultElapsedMs) / 1000); // verifying watchdog (K-05b → K-12)
  switch (outcome.result) {
    case "welcomed":
      return { code: "K-06", kind: "welcome", camera: "live", cameraTone: "hero", hero: true, greeting: "Welcome,", name: outcome.fullName, sub: door.eventName, time: outcome.checkedInAt ? `Checked in at ${formatClock(outcome.checkedInAt, door.timeZone)}` : "" };
    case "welcome_back":
      // Already checked in: a second scan sends no second welcome email.
      return { code: "K-07", kind: "welcome", camera: "live", cameraTone: "live", hero: false, greeting: "Welcome back,", name: outcome.firstName, sub: outcome.checkedInAt ? "You checked in at" : "You’re already checked in", time: outcome.checkedInAt ? formatClock(outcome.checkedInAt, door.timeZone) : "" };
    case "unknown":
      return message({
        code: "K-08",
        icon: "?",
        head: "We couldn’t find you",
        sub: "Please see the team at the desk.",
        chip: outcome.bestScore === null ? `No match above ${outcome.threshold}%` : `No match above ${outcome.threshold}% · best ${Math.round(outcome.bestScore)}%`,
      });
    case "not_on_list":
      return message({ code: "K-09", icon: "i", head: `Hi ${outcome.firstName}, you’re not on today’s list`, sub: SEE_DESK, chip: "Verified Didit user · not invited to this event" });
    case "not_verified":
      return message({ code: "K-10", icon: "…", iconTone: "feature", head: `Almost there, ${outcome.firstName}`, sub: "Your verification isn’t complete. The team at the desk can help.", chip: `Status: ${VERIFICATION_LABEL[outcome.verification]}` });
    case "ambiguous":
      return message({ code: "K-15", icon: "?", head: "Please see the team at the desk", chip: "Two close matches" });
    case "inconclusive":
      return message({ code: "K-16", icon: "?", head: "Please see the team at the desk", chip: "Inconclusive" });
    case "not_admitted":
      return message({ code: "K-17", icon: "i", head: `Hi ${outcome.firstName}, your place isn’t confirmed yet`, sub: "The team at the desk can help.", chip: `Status: ${ADMISSION_LABEL[outcome.admission]}` });
    case "liveness_failed":
      return message({ code: "K-18", icon: "?", head: "We couldn’t confirm it’s you", sub: SEE_DESK, chip: "Strict mode · liveness check not passed" });
    case "no_face":
      return adjustScreen("not_frontal");
    case "paused":
      return pausedScreen();
    case "budget_exhausted":
      return budgetScreen();
    case "error":
      return outageScreen(outcome.reason, outcome.retryInS, null, outcome.requestId);
    case "liveness_needed":
      return adjustScreen("too_far");
  }
}

/* ── The whole door ─────────────────────────────────────────── */

export interface EngineView<R> {
  state: EngineState;
  hint: HintCode | null;
  progress: number;
  result?: R | VerifyTimeout;
}

export interface DoorState {
  door: DoorInfo & { threshold: number; startsAt?: string };
  connection: { state: "online" } | { state: "offline"; reason: OutageReason | "budget"; retryInS: number; lastOnline: string | null };
  /** The door admits nobody right now (and Test mode is off), or null. */
  closed: Exclude<DoorOpenState, "live"> | null;
  /** Test mode: results are labelled as what WOULD happen. */
  testMode?: boolean;
  /** The door session stopped; nothing else matters until someone signs in. */
  session?: SessionEnd | null;
  cameraError: CameraError | null;
  /** Seconds to the next K-02c camera retry (default 5). */
  cameraRetryInS?: number | null;
  detectorError: boolean;
  engine: EngineView<ScanOutcome> | null;
  /** Time spent in the engine's current state (drives K-05b and result countdowns). */
  stateMs: number;
  overlayOpen: boolean;
}

/** Precedence: session → connection → closed → camera → detector → engine state. */
export function doorScreen(s: DoorState): ScreenModel {
  if (s.session) return sessionScreen(s.session);
  if (s.connection.state === "offline") {
    return s.connection.reason === "budget" ? budgetScreen() : outageScreen(s.connection.reason, s.connection.retryInS, s.connection.lastOnline);
  }
  if (s.closed) return closedScreen(s.closed, { startsAt: s.door.startsAt ?? new Date().toISOString(), timeZone: s.door.timeZone });
  if (s.cameraError) return cameraErrorScreen(s.cameraError, s.cameraRetryInS ?? undefined);
  if (s.detectorError) return { ...outageScreen("service", 0), sub: SEE_DESK, chip: "Face detector failed to load · reload the page" };
  const e = s.engine;
  if (!e) return idleScreen(s.door, s.overlayOpen);
  switch (e.state) {
    case "adjusting":
      return e.hint && e.hint !== "no_face" ? adjustScreen(e.hint) : idleScreen(s.door, s.overlayOpen);
    case "holding":
      return holdScreen(e.progress);
    case "capturing":
      return verifyingScreen(0);
    case "verifying":
      return verifyingScreen(s.stateMs);
    case "result": {
      if (!e.result) return idleScreen(s.door, s.overlayOpen);
      const model = outcomeScreen(e.result, s.door, s.stateMs);
      return "result" in e.result && e.result.test ? asTest(model) : model;
    }
    case "paused":
      return pausedScreen();
    default:
      return idleScreen(s.door, s.overlayOpen);
  }
}
