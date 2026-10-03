import type { FaceMatch } from "../didit/types.ts";
import { eligible,evidenceMeets,type EligibilityEvent,type EvidenceAccount } from "./eligibility.ts";
import type { EventDoor } from "./event-model.ts";
import { eventStatus } from "./event-status.ts";
import { missingChecks,type AccountFacts } from "./missing-checks.ts";
import { DEFAULT_TTL_DAYS } from "./requirements.ts";
import type { Admission } from "./transitions.ts";
export interface DoorEvent extends EligibilityEvent { id: string; status: "draft" | "published" | "live" | "ended" | "cancelled"; startsAt: Date; doorMode: "supervised" | "strict"; door?:EventDoor }
export interface DoorRegistration { id: string; accountId: string; eventId: string; admission: Admission; legacyImported?:boolean }
/** A door station: the named device position ("Main door") a door session scans from. */
export interface DoorKiosk { id: string; eventId: string; revokedAt: Date | null }
export type DoorEligibilityResult = { eligible: true } | { eligible: false; result: "unknown" | "paused" | "not_on_list" | "not_admitted" | "not_verified" | "liveness_failed" };
/**
 * Pure C9/C18 predicate. B3 must call with freshly read rows AFTER lockForCheckin; matched face row is mandatory.
 * `test`: Test mode answers what WOULD happen at any time (before start, after end); it never admits anyone.
 */
export function doorEligibility(input: { account: EvidenceAccount; event: DoorEvent; registration: DoorRegistration | null; kiosk: DoorKiosk; faceEvidenceId: string; now: Date; strictLivenessPassed?: boolean; test?: boolean }): DoorEligibilityResult {
  const { account, event, registration, kiosk, now } = input;
  if (account.deletingAt || account.deletedAt) return { eligible: false, result: "unknown" };
  if (event.door?.kiosk===false || kiosk.revokedAt || kiosk.eventId !== event.id || (!input.test && eventStatus(event, now) !== "live")) return { eligible: false, result: "paused" };
  if (!registration || registration.accountId !== account.id || registration.eventId !== event.id) return { eligible: false, result: "not_on_list" };
  if (registration.admission !== "approved") return { eligible: false, result: "not_admitted" };
  const face = account.evidence.find(e => e.id === input.faceEvidenceId && e.kind === "face" && e.accountId === account.id);
  if (!face || face.establishedAt > now || !evidenceMeets(face, event,now) || !doorReady(account,event,registration,now)) return { eligible: false, result: "not_verified" };
  if ((event.door?.kiosk ? event.door.mode : event.doorMode) === "strict" && input.strictLivenessPassed !== true) return { eligible: false, result: "liveness_failed" };
  return { eligible: true };
}
export interface FaceLookup {
  account: EvidenceAccount; verificationId: string; faceEvidenceId: string; registration: DoorRegistration | null; activeCheckin: boolean; policy?: DoorEvent;
}
export interface FaceLookups { event: DoorEvent; now: Date; bySession: ReadonlyMap<string, FaceLookup> }
export interface MatchedFace { accountId: string; faceEvidenceId: string; sessionId: string; similarity: number }
export type ScanResolution =
  | { result: "unknown" | "inconclusive" }
  | { result: "ambiguous"; candidates: MatchedFace[] }
  | (MatchedFace & { result: "not_on_list" })
  | (MatchedFace & { result: "welcomed" | "welcome_back" | "not_admitted" | "not_verified"; registrationId: string });
/** Final transaction may reject a match because the event or kiosk changed after search. */
export type CheckinResult = ScanResolution | { result: "paused" | "liveness_failed" };
export type ScanResult = CheckinResult | { result: "no_face" | "budget_exhausted" | "error" };
/** Same range as the event model's `door.match_threshold`. */
export const MATCH_THRESHOLD_MIN = 50, MATCH_THRESHOLD_MAX = 99;
/** Matches within this many points of the closest count as the same candidate set (an approved guest among them wins). */
const CLOSE_POINTS = 5;
/**
 * C8: group by account, only the exact current face-evidence session counts.
 * Never `ambiguous` since 2026-10-02: close candidates resolve to the approved guest of this event among them, else the
 * closest one. Sessions with no local account are ignored. One person enrolled several times resolves to that person.
 */
export function resolveFaceMatches(matches: readonly FaceMatch[], lookups: FaceLookups, threshold: number): ScanResolution {
  if (!Number.isFinite(threshold) || threshold < MATCH_THRESHOLD_MIN || threshold > MATCH_THRESHOLD_MAX) throw new Error("InvalidMatchThreshold");
  if (matches.length > 5) return { result: "inconclusive" };
  const grouped = new Map<string, { match: MatchedFace; lookup: FaceLookup }>();
  for (const match of matches) {
    if (!Number.isFinite(match.similarity_percentage) || match.similarity_percentage > 100) return { result: "inconclusive" };
    if (match.similarity_percentage < threshold || match.is_blocklisted || match.api_service || !match.session_id || (match.status != null && match.status !== "Approved")) continue;
    const lookup = lookups.bySession.get(match.session_id);
    if (!lookup || lookup.account.deletingAt || lookup.account.deletedAt) continue;
    const face = lookup.account.evidence.find(e => e.id === lookup.faceEvidenceId && e.kind === "face" && e.verificationId === lookup.verificationId && e.accountId === lookup.account.id);
    // Current at scan time. The accepted event checks are evaluated below.
    if (!face || face.activation !== "active" || face.providerStatus !== "approved" || face.invalidatedAt || face.supersededAt || face.establishedAt > lookups.now || face.validUntil <= lookups.now || face.establishedAt.getTime() + DEFAULT_TTL_DAYS.face * 86400_000 <= lookups.now.getTime()) continue;
    const current = grouped.get(lookup.account.id);
    if (!current || current.match.similarity < match.similarity_percentage) grouped.set(lookup.account.id, { lookup, match: { accountId: lookup.account.id, faceEvidenceId: face.id, sessionId: match.session_id, similarity: match.similarity_percentage } });
  }
  const ranked = [...grouped.values()].sort((a, b) => b.match.similarity - a.match.similarity || a.match.accountId.localeCompare(b.match.accountId));
  if (!ranked[0]) return { result: "unknown" };
  // Close matches never send the guest to the desk. The same person
  // often has several accounts with one face (test accounts, a work and a personal email): among the matches within
  // CLOSE_POINTS of the closest, an approved guest of this event wins, otherwise the closest match.
  const close = ranked.filter(x => ranked[0]!.match.similarity - x.match.similarity <= CLOSE_POINTS);
  const onList = (x: (typeof ranked)[number]) => x.lookup.registration?.eventId === lookups.event.id && x.lookup.registration.accountId === x.match.accountId && x.lookup.registration.admission === "approved";
  const best = close.find(onList) ?? ranked[0];
  const registration = best.lookup.registration;
  if (!registration || registration.eventId !== lookups.event.id || registration.accountId !== best.match.accountId) return { ...best.match, result: "not_on_list" };
  const base = { ...best.match, registrationId: registration.id };
  if (registration.admission !== "approved") return { ...base, result: "not_admitted" };
  if (!doorReady(best.lookup.account,best.lookup.policy??lookups.event,registration,lookups.now) || !evidenceMeets(best.lookup.account.evidence.find(e => e.id === best.match.faceEvidenceId)!, best.lookup.policy??lookups.event,lookups.now)) return { ...base, result: "not_verified" };
  return { ...base, result: best.lookup.activeCheckin ? "welcome_back" : "welcomed" };
}

function doorReady(account:EvidenceAccount,event:DoorEvent,registration:DoorRegistration,now:Date) {
  if(!event.checks)return eligible(account,event);
  const result=missingChecks(account as AccountFacts,{...event,policyVersion:event.policyVersion??1,formVersion:event.formVersion??1,checks:event.checks},now);
  return result.canSubmit || !!registration.legacyImported && result.baseline.email && result.baseline.face && !result.missing.length;
}
