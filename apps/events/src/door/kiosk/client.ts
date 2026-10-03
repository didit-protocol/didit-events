// Browser-side calls to the Events door API (/api/door/{event}/…). The door only ever talks to its own origin, with
// the door-session cookie and the CSRF header; every call is bounded so a hung request never stalls the door.
import type { FaceScan, KioskContext, ScanOutcome, SessionEnd } from "./types";

type Fetch = typeof fetch;

export const TIMEOUT_MS = { scan: 15_000, context: 20_000, json: 10_000 } as const;
const timeout = (ms: number): AbortSignal | undefined =>
  typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(ms) : undefined;

const offlineReason = () => (typeof navigator !== "undefined" && navigator.onLine === false ? "network" : "service");

export const doorApi = (eventId: string) => `/api/door/${encodeURIComponent(eventId)}`;

let doorCsrf = "";
/** The door page renders the CSRF token bound to this device's door cookie; it outlives a re-bound __Host-csrf cookie. */
export function setDoorCsrf(token: string) {
  doorCsrf = token;
}

function csrfHeader(): Record<string, string> {
  if (doorCsrf) return { "x-csrf": doorCsrf };
  const value = typeof document === "undefined" ? "" : document.cookie.split("; ").find((c) => c.startsWith("__Host-csrf="))?.slice(12) ?? "";
  return value ? { "x-csrf": decodeURIComponent(value) } : {};
}

/** 401 bodies name why the door session stopped; anything else unexpected counts as `ended`. */
async function sessionEnd(res: Response): Promise<SessionEnd> {
  const code = await res.json().then((b: { error?: string }) => b.error ?? "", () => "");
  return code === "DoorSessionExpired" ? "expired" : code === "DoorAccessRevoked" ? "revoked" : "ended";
}

export type ScanReply = FaceScan | { session: SessionEnd };

/** The multi-face door names the face: its track id (echoed back) and its width in camera px (strict-door distance). */
export interface FaceHint {
  trackId?: number;
  faceWidth?: number;
}

export function scanUrl(base: string, test: boolean, hint: FaceHint = {}): string {
  const q = new URLSearchParams();
  if (test) q.set("test", "1");
  if (hint.trackId !== undefined) q.set("track", String(Math.max(0, Math.round(hint.trackId))));
  if (hint.faceWidth !== undefined) q.set("face", String(Math.max(0, Math.round(hint.faceWidth))));
  const query = q.toString();
  return `${base}/scan${query ? `?${query}` : ""}`;
}

/** POSTs one JPEG crop. A 401 means the door session stopped (re-auth); failures become K-12 outcomes with a request id. */
export async function postScan(base: string, blob: Blob, test: boolean, fetchImpl: Fetch = fetch, hint: FaceHint = {}): Promise<ScanReply> {
  try {
    const res = await fetchImpl(scanUrl(base, test, hint), { method: "POST", headers: { "content-type": "image/jpeg", ...csrfHeader() }, body: blob, signal: timeout(TIMEOUT_MS.scan) });
    if (res.status === 401) return { session: await sessionEnd(res) };
    if (res.status === 429) return { result: "error", reason: "service", retryInS: 2, test };
    if (!res.ok) {
      const requestId = res.headers.get("x-request-id") ?? undefined;
      return { result: "error", reason: "service", retryInS: 12, requestId, test };
    }
    return (await res.json()) as FaceScan;
  } catch {
    const reason = offlineReason();
    return { result: "error", reason, retryInS: reason === "network" ? 5 : 12, test };
  }
}

export type ContextFetch = { ok: true; context: KioskContext } | { ok: false; session?: SessionEnd; reason: "network" | "service" };

export async function fetchContext(base: string, fetchImpl: Fetch = fetch): Promise<ContextFetch> {
  try {
    const res = await fetchImpl(`${base}/context`, { cache: "no-store", headers: csrfHeader(), signal: timeout(TIMEOUT_MS.context) });
    if (res.status === 401) return { ok: false, session: await sessionEnd(res), reason: "service" };
    if (!res.ok) return { ok: false, reason: "service" };
    return { ok: true, context: (await res.json()) as KioskContext };
  } catch {
    return { ok: false, reason: offlineReason() };
  }
}

export type ExitResult = { ok: true } | { ok: false; error: "wrong_pin" | "locked" | "no_pin" | "offline" | "unavailable" };

/** Ends door mode with the staff-set PIN. Nobody is signed in afterwards. */
export async function postPinExit(base: string, pin: string, fetchImpl: Fetch = fetch): Promise<ExitResult> {
  try {
    const res = await fetchImpl(`${base}/exit`, { method: "POST", headers: { "content-type": "application/json", ...csrfHeader() }, body: JSON.stringify({ pin }), signal: timeout(TIMEOUT_MS.json) });
    if (res.ok) return { ok: true };
    const code = await res.json().then((b: { error?: string }) => b.error ?? "", () => "");
    return { ok: false, error: code === "WrongPin" ? "wrong_pin" : code === "PinAttemptsExceeded" ? "locked" : code === "PinNotSet" ? "no_pin" : "unavailable" };
  } catch {
    return { ok: false, error: "offline" };
  }
}

/** The context after a scan, before the next poll: newest scan first (max 5), arrivals +1 on a real first welcome. */
export function withScan(context: KioskContext, outcome: ScanOutcome, at: Date): KioskContext {
  // Nothing was recorded for these (liveness_needed never reaches Didit).
  if (outcome.result === "error" || outcome.result === "paused" || outcome.result === "liveness_needed") return context;
  const name = "fullName" in outcome ? outcome.fullName : "firstName" in outcome ? outcome.firstName : null;
  return {
    ...context,
    arrived: context.arrived + (outcome.result === "welcomed" && !outcome.test ? 1 : 0),
    recentScans: [{ id: `local_${at.getTime()}`, at: at.toISOString(), name, result: outcome.result, test: !!outcome.test }, ...context.recentScans].slice(0, 5),
  };
}
