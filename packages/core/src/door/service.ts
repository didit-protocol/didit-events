import { staffEmailSql } from "../staff-email.ts";
import { createHash,randomBytes,scrypt,timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { can,isEventRole } from "../access/capabilities.ts";
import { acceptedEvent,registrationChecks } from "../admission/policies.ts";
import { AdmissionError,eventBy,requireEventActor } from "../admission/shared.ts";
import { consume } from "../counters.ts";
import { getDb,type Db } from "../db/index.ts";
import { lockAccount,lockForCheckin,queryable,withTx,type Queryable,type Tx } from "../db/tx.ts";
import { DiditClient,DiditCredits,DiditNoFace } from "../didit/client.ts";
import type { FaceMatch } from "../didit/types.ts";
import { doorEligibility,resolveFaceMatches,type CheckinResult,type FaceLookup,type ScanResult } from "../domain/door.ts";
import type { EvidenceAccount,EvidenceFact } from "../domain/eligibility.ts";
import { eventStatus } from "../domain/event-status.ts";
import { missingChecks } from "../domain/missing-checks.ts";
import { verificationWithdrawnAfterCheckin } from "../domain/evidence.ts";
import type { Account,DomainEvent,DoorIdentity,DoorService,Kiosk,Registration,StaffPrincipal } from "../domain/services.ts";
import { parseSpendCapUsd } from "../env.ts";
import { PolicyError } from "../http/policy.ts";
import { log } from "../log.ts";
import { notifyInTx } from "../notify.ts";
import { enqueue } from "../outbox.ts";
import { BudgetExceeded,MAX_PRICE_USD,reserveBatch,settle,type SpendScope } from "../spend.ts";

// Raw SQL uses the shared transaction adapter's timestamp codecs on both databases.
export const camelRow = <T>(row: Record<string, unknown>): T => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v])) as T;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const notify = (tx: Tx, eventId: string, type: string) => notifyInTx(tx, `event_${eventId}`, { type, event_id: eventId });
const reasonText = (reason: string) => { if (!reason?.trim() || reason.length > 1000) throw new PolicyError(400, "ReasonRequired"); return reason.trim(); };
async function dbNow(q: Queryable): Promise<Date> { return (await q.query<{ now: Date }>("select clock_timestamp() as now"))[0]!.now; }
async function one<T>(q: Queryable, sql: string, params: unknown[]): Promise<T | null> { const [row] = await q.query(sql, params); return row ? camelRow<T>(row) : null; }
async function accountFacts(q: Queryable, id: string): Promise<EvidenceAccount | null> {
  const account = await one<Account>(q, "select * from accounts where id=$1", [id]);
  if (!account) return null;
  const evidence = (await q.query("select * from evidence where account_id=$1", [id])).map(row => camelRow<EvidenceFact>(row));
  return { ...account, evidence };
}
/** Core errors become PolicyErrors so routes map them to a status and a stable code. */
async function eventActor(q: Queryable, actor: StaffPrincipal, eventId: string, capability: Parameters<typeof requireEventActor>[3], lock = false) {
  try { await requireEventActor(q, actor, eventId, capability, lock); }
  catch (error) { if (error instanceof AdmissionError && error.code === "Forbidden") throw new PolicyError(403, "Forbidden"); throw error; }
}

/** A door session lasts the evening: long enough for a long event, short enough that a forgotten laptop expires overnight. */
export const DOOR_SESSION_HOURS = 16;
export const STATION_MAX = 40;
const PIN = /^\d{4,8}$/;
const NEW_PIN = /^\d{6,8}$/;
export class PinAttemptsExceeded extends PolicyError {
  constructor(readonly retryAfter: number) { super(429, "PinAttemptsExceeded"); }
}
/** The account baseline (no event checks): its `face` flag is the admin's blue badge. */
const BASELINE = { id: "baseline", policyVersion: 1, formVersion: 1, checks: { version: 1 as const, required: [], max_age: {} } };
export type DoorState = "live" | "not_started" | "ended" | "cancelled" | "draft" | "face_off";
export interface DoorContext {
  station: { id: string; name: string };
  session: { id: string; expiresAt: string; startedBy: string };
  event: { id: string; slug: string; name: string; timeZone: string; capacity: number; startsAt: string; endsAt: string; logUrl: string };
  /** Why the door is (not) admitting right now. Test mode works in every state except `face_off`. */
  state: DoorState;
  doorMode: "supervised" | "strict";
  threshold: number;
  arrived: number;
  budgetExhausted: boolean;
  /** This station's newest scans; `test` rows came from Test mode and admitted nobody. */
  recentScans: Array<{ id: string; at: string; name: string | null; result: ScanResult["result"]; test: boolean }>;
  pinSet: boolean;
  serverTime: string;
}
export type DoorScanView =
  | { result: "welcomed"; fullName: string; firstName: string; checkedInAt: string | null; test: boolean; registrationId: string }
  | { result: "welcome_back"; firstName: string; checkedInAt: string | null; test: boolean }
  | { result: "unknown"; threshold: number; bestScore: null; test: boolean }
  | { result: "not_on_list"; firstName: string; test: boolean }
  | { result: "not_admitted"; firstName: string; admission: "pending" | "waitlisted" | "rejected" | "withdrawn" | "cancelled" | "revoked"; test: boolean }
  | { result: "not_verified"; firstName: string; verification: "requirements_unmet"; test: boolean }
  | { result: "error"; reason: "service"; retryInS: number; test: boolean }
  | { result: "ambiguous" | "inconclusive" | "liveness_failed" | "no_face" | "paused" | "budget_exhausted"; test: boolean }
  /** Strict door, face too small in the camera frame for a passive liveness check: nothing was sent or spent. */
  | { result: "liveness_needed"; test: boolean };

/**
 * v5 multi-face door: the compact result the AR tag renders, alongside the legacy `result` (operator panel, logs).
 * `outcome` folds the provider/eligibility detail into what the tag shows; `test` is a Test-mode would-be welcome.
 * `photo` is always "none": the door never returns a picture.
 */
export type DoorOutcome = "welcome" | "welcome_back" | "not_on_list" | "not_approved" | "unknown" | "liveness_needed" | "liveness_failed" | "test"
  | "paused" | "budget_exhausted" | "error";
export interface DoorScanCompact {
  outcome: DoorOutcome;
  firstName: string | null;
  /** First + last name, as the account holds it. */
  displayName: string | null;
  /** The person's human (face) check is current: the blue badge, as in the admin. */
  verified: boolean;
  verifiedAt: string | null;
  photo: "none";
  /** Echo of the door's client track id. */
  trackId: number | null;
}
export type DoorScanResult = DoorScanView extends infer V ? V extends unknown ? Omit<V, "firstName"> & DoorScanCompact : never : never;
/** Face width (camera px) a strict door needs before it spends a passive liveness check on the crop. */
export const STRICT_LIVENESS_MIN_FACE_PX = 140;
/** Scans one door session may dispatch per 1.2-second window: the multi-face door runs up to 3 at once. */
export const DEVICE_SCANS_PER_WINDOW = 4;
export interface FaceHint { trackId?: number | null; faceWidth?: number | null }

/** The tag outcome for a legacy scan view. */
export function doorOutcome(view: DoorScanView): DoorOutcome {
  switch (view.result) {
    case "welcomed": return view.test ? "test" : "welcome";
    case "welcome_back": return view.test ? "test" : "welcome_back";
    case "not_on_list": return "not_on_list";
    case "not_admitted": case "not_verified": return "not_approved";
    case "liveness_failed": return "liveness_failed";
    case "liveness_needed": return "liveness_needed";
    case "paused": return "paused";
    case "budget_exhausted": return "budget_exhausted";
    case "error": return "error";
    default: return "unknown";
  }
}

export interface DoorOptions {
  db?: Db;
  didit?: Pick<DiditClient, "faceSearch" | "passiveLiveness">;
  appUrl?: string;
  appDailyUsd?: number;
  eventDailyUsd?: number;
  totalUsd?: number;
  eventDailyScans?: number;
  appDailyScans?: number;
}
type SessionRow = { id: string; event_id: string; kiosk_id: string; account_id: string; email: string; expires_at: Date; created_at: Date; station: string; last_seen_at: Date };

function doorState(event: DomainEvent, now: Date): DoorState {
  if (!event.door.kiosk) return "face_off";
  const status = eventStatus(event, now);
  if (status === "live") return "live";
  if (status === "published") return "not_started";
  return status === "ended" ? "ended" : status === "cancelled" ? "cancelled" : "draft";
}

export class Door implements DoorService {
  constructor(private readonly options: DoorOptions = {}) {}
  private get db() { return this.options.db ?? getDb(); }
  private get q() { return queryable(this.db); }
  private get provider() { return this.options.didit ?? new DiditClient({ apiKey: process.env.DIDIT_API_KEY ?? "" }); }
  private get eventLimit() { return this.options.eventDailyScans ?? 3000; }
  private get appLimit() { return this.options.appDailyScans ?? 10000; }
  private scopes(eventId: string): SpendScope[] {
    return [
      { kind: "app/day", id: "events", usdCap: this.options.appDailyUsd ?? Number(process.env.DIDIT_APP_DAILY_CAP_USD ?? 300) },
      { kind: "event/day", id: eventId, usdCap: this.options.eventDailyUsd ?? Number(process.env.DIDIT_EVENT_DAILY_CAP_USD ?? 150) },
      { kind: "total", id: "door", usdCap: this.options.totalUsd ?? parseSpendCapUsd(process.env.DIDIT_SPEND_CAP_USD) },
    ];
  }

  // ── Door sessions ────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * "Start door mode": locks this browser to the event's door. The caller replaces the browser's admin session with
   * the returned door token, so a laptop left at the entrance opens nothing else. Several devices may run the door.
   */
  async startSession(actor: StaffPrincipal, eventIdOrSlug: string, stationName: string): Promise<{ token: string; door: DoorIdentity; station: string; expiresAt: Date }> {
    const station = stationName.trim().replace(/\s+/g, " ");
    if (!station || station.length > STATION_MAX) throw new PolicyError(400, "InvalidStation");
    if (!actor.accountId) throw new PolicyError(409, "AccountSessionRequired");
    const event = await eventBy(this.q, eventIdOrSlug);
    if (!event) throw new PolicyError(404, "EventNotFound");
    if (!event.door.kiosk) throw new PolicyError(409, "FaceCheckinOff");
    const token = randomBytes(32).toString("base64url");
    return withTx(async tx => {
      await tx.query("select id from events where id=$1 for share", [event.id]);
      await eventActor(tx, actor, event.id, "door.operate", true);
      const [account] = await tx.query<{ email: string }>("select email from accounts where id=$1 and deleting_at is null and deleted_at is null", [actor.accountId]);
      if (!account || account.email !== actor.email) throw new PolicyError(409, "AccountSessionRequired");
      let [kiosk] = await tx.query<{ id: string }>("select id from kiosks where event_id=$1 and lower(name)=lower($2) and revoked_at is null order by created_at limit 1", [event.id, station]);
      if (!kiosk) [kiosk] = await tx.query<{ id: string }>("insert into kiosks(event_id,name) values($1,$2) returning id", [event.id, station]);
      const [session] = await tx.query<{ id: string; expires_at: Date }>(`insert into door_sessions(event_id,kiosk_id,account_id,email,token_hash,expires_at)
        values($1,$2,$3,$4,$5,clock_timestamp()+$6*interval '1 hour') returning id,expires_at`, [event.id, kiosk!.id, actor.accountId, actor.email, hash(token), DOOR_SESSION_HOURS]);
      await tx.query("update kiosks set last_seen_at=clock_timestamp(),updated_at=clock_timestamp() where id=$1", [kiosk!.id]);
      await this.audit(tx, actor.email, "door.start", session!.id, event.id, { station });
      log("door.session_started", { eventId: event.id, stationId: kiosk!.id, doorSessionId: session!.id, role: actor.scope?.role ?? actor.role });
      return { token, station, expiresAt: session!.expires_at,
        door: { principal: "door", eventId: event.id, kioskId: kiosk!.id, doorSessionId: session!.id, accountId: actor.accountId!, email: actor.email } };
    }, this.db);
  }
  /**
   * Resolves a door cookie on every door request. The starter's access is re-read each time: removing them from the
   * team, disabling their staff access or deleting their account ends the door at once (401).
   */
  async resolveSession(token: string, eventIdOrSlug?: string): Promise<DoorIdentity> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new PolicyError(401, "DoorSessionInvalid");
    const [row] = await this.q.query<SessionRow & { slug: string; ended_at: Date | null; expired: boolean }>(`select d.*,e.slug,k.name as station,d.expires_at<=clock_timestamp() as expired
      from door_sessions d join events e on e.id=d.event_id join kiosks k on k.id=d.kiosk_id where d.token_hash=$1`, [hash(token)]);
    if (!row || row.ended_at) throw new PolicyError(401, "DoorSessionEnded");
    if (row.expired) throw new PolicyError(401, "DoorSessionExpired");
    if (eventIdOrSlug !== undefined && eventIdOrSlug !== row.event_id && eventIdOrSlug !== row.slug) throw new PolicyError(403, "DoorSessionOtherEvent");
    if (!(await this.starterCanOperate(this.q, row.event_id, row.account_id, row.email))) throw new PolicyError(401, "DoorAccessRevoked");
    if (Date.now() - row.last_seen_at.getTime() > 30_000) {
      await this.q.query("update door_sessions set last_seen_at=clock_timestamp() where id=$1", [row.id]);
      await this.q.query("update kiosks set last_seen_at=clock_timestamp() where id=$1", [row.kiosk_id]);
    }
    return { principal: "door", eventId: row.event_id, kioskId: row.kiosk_id, doorSessionId: row.id, accountId: row.account_id, email: row.email };
  }
  private async starterCanOperate(q: Queryable, eventId: string, accountId: string, email: string): Promise<boolean> {
    const [row] = await q.query<{ staff_role: string | null; member_role: string | null }>(`select
      (select t.role::text from staff t where t.email=a.email and t.disabled_at is null and ${staffEmailSql("t.email")}) as staff_role,
      (select m.role from event_members m where m.event_id=$2 and m.email=a.email and m.revoked_at is null) as member_role
      from accounts a where a.id=$1 and a.email=$3 and a.deleting_at is null and a.deleted_at is null`, [accountId, eventId, email]);
    if (!row) return false;
    return (!!row.staff_role && can(row.staff_role as "owner", "door.operate")) || (isEventRole(row.member_role) && can(row.member_role, "door.operate"));
  }
  /** Ends this device's door mode after the person re-authenticated with access to the event (the admin session is theirs again). */
  async endSession(actor: StaffPrincipal, door: DoorIdentity): Promise<void> {
    await withTx(async tx => {
      await eventActor(tx, actor, door.eventId, "door.operate");
      await this.end(tx, door.doorSessionId, door.eventId, actor.email, "door.end");
    }, this.db);
  }
  /** Shared event/IP budgets prevent cycling sessions; an atomic event cooldown serializes guesses. */
  async endSessionWithPin(door: DoorIdentity, pin: string, ip = "unknown"): Promise<void> {
    const [row] = await this.q.query<{ pin_hash: string }>("select pin_hash from door_pins where event_id=$1", [door.eventId]);
    if (!row) throw new PolicyError(409, "PinNotSet");
    let attempts = 1;
    for (const key of [`door:pin:event:${door.eventId}`, `door:pin:ip:${hash(ip)}`, `door:pin:${door.doorSessionId}`]) {
      const budget = await consume(key, 5, 600, this.db);
      if (!budget.allowed) throw new PinAttemptsExceeded(Math.max(1, Math.ceil((budget.resetsAt.getTime() - Date.now()) / 1000)));
      attempts = Math.max(attempts, 5 - budget.remaining);
    }
    const cooldown = await consume(`door:pin:cooldown:${door.eventId}`, 1, 2 ** (attempts - 1), this.db);
    if (!cooldown.allowed) throw new PinAttemptsExceeded(Math.max(1, Math.ceil((cooldown.resetsAt.getTime() - Date.now()) / 1000)));
    if (!PIN.test(pin) || !(await verifyPin(pin, row.pin_hash))) throw new PolicyError(403, "WrongPin");
    await withTx(tx => this.end(tx, door.doorSessionId, door.eventId, `pin:${door.email}`, "door.end_pin"), this.db);
  }
  /** Staff/hosts end a device's door mode from the Door tab (a lost or stolen laptop). */
  async endSessionById(actor: StaffPrincipal, eventId: string, doorSessionId: string): Promise<void> {
    await withTx(async tx => {
      await eventActor(tx, actor, eventId, "door.manage");
      await this.end(tx, doorSessionId, eventId, actor.email, "door.end_remote");
    }, this.db);
  }
  private async end(tx: Tx, id: string, eventId: string, by: string, action: string) {
    const [row] = await tx.query<{ id: string }>("update door_sessions set ended_at=clock_timestamp(),ended_by=$3 where id=$1 and event_id=$2 and ended_at is null returning id", [id, eventId, by]);
    if (!row) throw new PolicyError(404, "DoorSessionEnded");
    await this.audit(tx, by.replace(/^pin:/, ""), action, id, eventId, {});
    log("door.session_ended", { eventId, doorSessionId: id, action });
  }
  async setPin(actor: StaffPrincipal, eventId: string, pin: string | null): Promise<void> {
    if (pin !== null && !NEW_PIN.test(pin)) throw new PolicyError(400, "InvalidPin");
    await withTx(async tx => {
      await tx.query("select id from events where id=$1 for share", [eventId]);
      await eventActor(tx, actor, eventId, "door.pin", true);
      if (pin === null) await tx.query("delete from door_pins where event_id=$1", [eventId]);
      else await tx.query(`insert into door_pins(event_id,pin_hash,set_by) values($1,$2,$3)
        on conflict(event_id) do update set pin_hash=excluded.pin_hash,set_by=excluded.set_by,updated_at=clock_timestamp()`, [eventId, await hashPin(pin), actor.email]);
      await this.audit(tx, actor.email, pin === null ? "door.pin_cleared" : "door.pin_set", eventId, eventId, {});
    }, this.db);
  }
  /** Door tab: active door sessions (devices) and whether a PIN is set. */
  async overview(actor: StaffPrincipal, eventId: string) {
    await eventActor(this.q, actor, eventId, "door.operate");
    const sessions = await this.q.query<{ id: string; station: string; email: string; created_at: Date; last_seen_at: Date; expires_at: Date }>(`select d.id,k.name as station,d.email,d.created_at,d.last_seen_at,d.expires_at
      from door_sessions d join kiosks k on k.id=d.kiosk_id where d.event_id=$1 and d.ended_at is null and d.expires_at>clock_timestamp() order by d.created_at`, [eventId]);
    const [pin] = await this.q.query("select 1 from door_pins where event_id=$1", [eventId]);
    return { sessions, pinSet: !!pin };
  }

  // ── Scanning ─────────────────────────────────────────────────────────────────────────────────────────────────
  private async liveSession(q: Queryable, door: DoorIdentity, lock: boolean) {
    const [row] = await q.query(`select id from door_sessions where id=$1 and event_id=$2 and kiosk_id=$3 and ended_at is null and expires_at>clock_timestamp() ${lock ? "for share" : ""}`, [door.doorSessionId, door.eventId, door.kioskId]);
    if (!row) throw new PolicyError(401, "DoorSessionEnded");
  }
  private async audit(tx: Tx, actor: string, action: string, target: string, eventId: string, data: Record<string, unknown>) {
    await tx.query("insert into audit(actor,action,target,event_id,data) values($1,$2,$3,$4,$5::jsonb)", [actor, action, target, eventId, JSON.stringify(data)]);
    await notify(tx, eventId, action);
  }
  private async record(tx: Tx, door: DoorIdentity, result: ScanResult, started: number, test: boolean, candidates: FaceMatch[] = []) {
    await tx.query(`insert into scans(event_id,kiosk_id,registration_id,result,test,candidates,latency_ms) values($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [door.eventId, door.kioskId, "registrationId" in result ? result.registrationId : null, result.result, test,
        JSON.stringify(candidates.filter(c => c.session_id).map(c => ({ sessionId: c.session_id, score: c.similarity_percentage }))), Math.max(0, Math.round(performance.now() - started))]);
    await notify(tx, door.eventId, "scan");
    log("door.scan", { eventId: door.eventId, stationId: door.kioskId, doorSessionId: door.doorSessionId, result: result.result, test, latencyMs: Math.max(0, Math.round(performance.now() - started)), candidates: candidates.length });
    return result;
  }
  private async recordOnly(door: DoorIdentity, result: ScanResult, started: number, test: boolean, candidates: FaceMatch[] = []) {
    return withTx(async tx => {
      // No registration is attached on unresolved scans, hence no reverse registration FK lock.
      await tx.query("select id from events where id=$1 for share", [door.eventId]);
      await tx.query("select id from kiosks where id=$1 and event_id=$2 for share", [door.kioskId, door.eventId]);
      await this.liveSession(tx, door, true);
      return this.record(tx, door, result, started, test, candidates);
    }, this.db);
  }
  async checkin(input: Parameters<DoorService["checkin"]>[0] & { door?: DoorIdentity; test?: boolean }, metadata: { started: number; candidates: FaceMatch[]; threshold?: number } = { started: performance.now(), candidates: [] }): Promise<CheckinResult> {
    const door: DoorIdentity = input.door ?? { principal: "door", eventId: input.eventId, kioskId: input.kioskId, doorSessionId: "", accountId: "", email: "" };
    const test = input.test === true;
    return withTx(async tx => {
      await lockAccount(tx, input.accountId);
      // Deletion can remove the registration before this transaction obtained the account lock.
      const exists = await one<Registration>(tx, "select * from registrations where id=$1 and account_id=$2 and event_id=$3", [input.registrationId, input.accountId, input.eventId]);
      if (!exists) {
        await tx.query("select id from events where id=$1 for share", [door.eventId]);
        await tx.query("select id from kiosks where id=$1 and event_id=$2 for share", [door.kioskId, door.eventId]);
        if (input.door) await this.liveSession(tx, door, true);
        await this.record(tx, door, { result: "unknown" }, metadata.started, test, metadata.candidates);
        return { result: "unknown" };
      }
      await lockForCheckin(tx, input);
      if (input.door) await this.liveSession(tx, door, true);
      const account = await accountFacts(tx, input.accountId);
      const event = (await one<DomainEvent>(tx, "select * from events where id=$1", [input.eventId]))!;
      const kiosk = (await one<Kiosk>(tx, "select * from kiosks where id=$1", [input.kioskId]))!;
      const registration = await one<Registration>(tx, "select * from registrations where id=$1", [input.registrationId]);
      const now = await dbNow(tx);
      const threshold = event.door.kiosk ? event.door.match_threshold : 80;
      const verdict = account ? doorEligibility({ account, event: registration ? await acceptedEvent(tx, registration, event) : event, kiosk, registration, faceEvidenceId: input.faceEvidenceId, now, strictLivenessPassed: input.strictLivenessPassed, test }) : { eligible: false, result: "unknown" } as const;
      let result: CheckinResult;
      const [matchedSession] = await tx.query<{ didit_session_id: string }>(
        "select v.didit_session_id from evidence e join verifications v on v.id=e.verification_id where e.id=$1 and e.account_id=$2", [input.faceEvidenceId, input.accountId]);
      const matched = { accountId: input.accountId, registrationId: input.registrationId, faceEvidenceId: input.faceEvidenceId, similarity: input.similarity,
        sessionId: matchedSession?.didit_session_id ?? "" };
      if (!verdict.eligible) result = { ...matched, result: verdict.result };
      else if (metadata.threshold !== undefined && metadata.threshold !== threshold) result = { result: "inconclusive" };
      else if (!Number.isFinite(input.similarity) || input.similarity < threshold || input.similarity > 100) result = { result: "unknown" };
      else if (test) {
        // Test mode: what WOULD happen. No check-in row, no welcome email, nothing counted.
        const [active] = await tx.query("select id from checkins where registration_id=$1 and undone_at is null", [input.registrationId]);
        result = { ...matched, result: active ? "welcome_back" : "welcomed" };
      } else {
        const [inserted] = await tx.query(`insert into checkins(event_id,registration_id,kiosk_id,face_evidence_id,method,similarity,checked_in_at)
          values($1,$2,$3,$4,'face',$5,clock_timestamp()) on conflict(registration_id) where undone_at is null do nothing returning id`,
          [input.eventId, input.registrationId, input.kioskId, input.faceEvidenceId, input.similarity]);
        if (inserted) await this.welcome(tx, input.registrationId, input.eventId);
        result = { ...matched, result: inserted ? "welcomed" : "welcome_back" };
      }
      await this.record(tx, door, result, metadata.started, test, metadata.candidates);
      return result;
    }, this.db);
  }
  private async welcome(tx: Tx, registrationId: string, eventId: string) {
    await enqueue(tx, { kind: "M-13", dedupeKey: `welcome:${registrationId}`, payload: { registrationId, eventId } });
  }
  /**
   * One door scan. Outside Test mode the door admits only while the event is live; in Test mode the same recognition
   * runs at any time (before start, after end) and only reports what would happen. Never stores the image.
   */
  async scan(door: DoorIdentity, jpeg: Uint8Array, options: { test?: boolean } = {}): Promise<ScanResult> {
    const started = performance.now(), test = options.test === true;
    if (jpeg.length > 400 * 1024) throw new PolicyError(413, "BodyTooLarge");
    if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) throw new PolicyError(415, "JpegRequired");
    // Independent reads in parallel (a scan's own time is mostly Didit's search; this trims the round trips before it).
    const [, now, event] = await Promise.all([
      this.liveSession(this.q, door, false),
      dbNow(this.q),
      one<DomainEvent>(this.q, "select * from events where id=$1", [door.eventId]).then(e => e!),
    ]);
    const finish = (result: ScanResult, candidates?: FaceMatch[]) => this.recordOnly(door, result, started, test, candidates);
    const state = doorState(event, now);
    if (state === "face_off" || (!test && state !== "live")) return finish({ result: "paused" });
    const provider = this.provider;
    if (!(await consume(`scan:device:${door.doorSessionId}`, DEVICE_SCANS_PER_WINDOW, 1.2, this.db)).allowed) throw new PolicyError(429, "ScanRateLimited");
    const day = now.toISOString().slice(0, 10);
    if (!(await consume(`scan:event:${event.id}:${day}`, this.eventLimit, 86400, this.db)).allowed ||
        !(await consume(`scan:app:${day}`, this.appLimit, 86400, this.db)).allowed) return finish({ result: "budget_exhausted" });
    let reservations;
    try {
      reservations = await reserveBatch((event.door.kiosk && event.door.mode === "strict" ? ["face_search", "passive_liveness"] as const : ["face_search"] as const)
        .map(op => ({ op, usdMax: MAX_PRICE_USD[op], scopes: this.scopes(event.id) })), this.db);
    } catch (error) { if (error instanceof BudgetExceeded) return finish({ result: "budget_exhausted" }); throw error; }
    const image = new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" });
    const outcomes = await Promise.allSettled(reservations.map(async reservation => {
      try {
        // Every door search is stored in the Didit console, tagged with the event and station.
        const result = reservation.op === "face_search"
          ? await timed(() => provider.faceSearch(image, reservation, { save: true, vendorData: `door:${event.slug}`, metadata: { source: "didit-events-door", eventId: event.id, eventSlug: event.slug, doorSessionId: door.doorSessionId, operatorId: door.accountId, test } }), door)
          : await provider.passiveLiveness(image, reservation);
        await settle(reservation.id, reservation.usdMax, this.db);
        return result;
      } catch (error) { await settle(reservation.id, "uncertain", this.db); throw error; }
    }));
    const search = outcomes[0]!;
    const liveness = outcomes[1];
    // An empty frame cannot establish liveness either. Preserve the useful framing result.
    if (search.status === "rejected" && search.reason instanceof DiditNoFace) return finish({ result: "no_face" });
    // Strict failure cannot leak a successful match; all dispatched calls have completed and settled.
    if (liveness && (liveness.status === "rejected" || !("liveness" in liveness.value) || (liveness.value as Awaited<ReturnType<DiditClient["passiveLiveness"]>>).liveness.status !== "Approved")) return finish({ result: "liveness_failed" });
    if (search.status === "rejected") return finish({ result: search.reason instanceof DiditNoFace ? "no_face" : search.reason instanceof DiditCredits ? "budget_exhausted" : "error" });
    if (!("face_search" in search.value)) return finish({ result: "error" });
    const faceSearch = (search.value as Awaited<ReturnType<DiditClient["faceSearch"]>>).face_search;
    // The provider may approve its primary match while warning about other faces in the frame.
    // Enforce the same one-person rule as the browser framing engine before any admission lookup.
    if (faceSearch.warnings?.some(w => w.risk === "MULTIPLE_FACES_DETECTED")) return finish({ result: "inconclusive" });
    const matches = faceSearch.matches;
    const bySession = new Map<string, FaceLookup>();
    // Foreign/standalone IDs are just untrusted lookup hints, never UUID casts.
    for (const match of matches) {
      if (!match.session_id) continue;
      const row = await one<{ accountId: string; verificationId: string; faceEvidenceId: string }>(this.q,
        "select v.account_id,v.id as verification_id,e.id as face_evidence_id from verifications v join evidence e on e.verification_id=v.id and e.kind='face' where v.didit_session_id::text=$1", [match.session_id]);
      if (!row) continue;
      const account = await accountFacts(this.q, row.accountId);
      if (!account) continue;
      const registration = await one<Registration>(this.q, "select * from registrations where event_id=$1 and account_id=$2", [event.id, row.accountId]);
      const active = registration && await one(this.q, "select id from checkins where registration_id=$1 and undone_at is null", [registration.id]);
      bySession.set(match.session_id, { account, verificationId: row.verificationId, faceEvidenceId: row.faceEvidenceId, registration, policy: registration ? await acceptedEvent(this.q, registration, event) : event, activeCheckin: !!active });
    }
    const threshold = event.door.kiosk ? event.door.match_threshold : 80;
    const resolution = resolveFaceMatches(matches, { event, now: await dbNow(this.q), bySession }, threshold);
    if ("registrationId" in resolution) return this.checkin({ ...resolution, registrationId: resolution.registrationId, eventId: event.id, kioskId: door.kioskId,
      strictLivenessPassed: !!liveness, door, test }, { started, candidates: matches, threshold });
    return finish(resolution, matches);
  }
  /**
   * One face crop from the multi-face door. A strict door checks liveness on the crop, which needs a face large
   * enough in the camera frame (`faceWidth`, camera px): a smaller one returns `liveness_needed` before any counter,
   * reservation or provider call ("Come closer for the face check"). Everything else is `scan`.
   */
  async scanFace(door: DoorIdentity, jpeg: Uint8Array, options: { test?: boolean; faceWidth?: number | null } = {}): Promise<ScanResult | { result: "liveness_needed" }> {
    if (options.faceWidth != null && Number.isFinite(options.faceWidth) && options.faceWidth < STRICT_LIVENESS_MIN_FACE_PX) {
      await this.liveSession(this.q, door, false);
      const event = await one<DomainEvent>(this.q, "select * from events where id=$1", [door.eventId]);
      if (event?.door.kiosk && event.door.mode === "strict" && (options.test === true || doorState(event, await dbNow(this.q)) === "live")) {
        log("door.scan", { eventId: door.eventId, stationId: door.kioskId, doorSessionId: door.doorSessionId, result: "liveness_needed", test: options.test === true, latencyMs: 0, candidates: 0 });
        return { result: "liveness_needed" };
      }
    }
    return this.scan(door, jpeg, { test: options.test });
  }
  /** The legacy view plus the compact fields the AR tag renders (name, verified badge, outcome). */
  async scanResult(result: ScanResult | { result: "liveness_needed" }, eventId: string, test = false, hint: FaceHint = {}): Promise<DoorScanResult> {
    const view: DoorScanView = result.result === "liveness_needed" ? { result: "liveness_needed", test } : await this.scanView(result, eventId, test);
    const person = "accountId" in result && view.result !== "unknown" && view.result !== "error" ? await this.person(result.accountId) : null;
    return { ...view, outcome: doorOutcome(view), firstName: person?.firstName ?? ("firstName" in view ? view.firstName : null), displayName: person?.displayName ?? null,
      verified: !!person?.verifiedAt, verifiedAt: person?.verifiedAt ?? null, photo: "none", trackId: hint.trackId ?? null };
  }
  private async person(accountId: string): Promise<{ firstName: string; displayName: string; verifiedAt: string | null } | null> {
    const account = await accountFacts(this.q, accountId);
    if (!account || account.deletingAt || account.deletedAt) return null;
    const now = await dbNow(this.q);
    const face = missingChecks(account as Parameters<typeof missingChecks>[0], BASELINE, now).baseline.face
      ? account.evidence.filter(e => e.kind === "face" && e.activation === "active").sort((a, b) => b.establishedAt.getTime() - a.establishedAt.getTime())[0] : undefined;
    const firstName = account.firstName ?? "Guest";
    return { firstName, displayName: [firstName, account.lastName].filter(Boolean).join(" "), verifiedAt: face ? face.establishedAt.toISOString() : null };
  }
  async manualCheckin(actor: StaffPrincipal, registrationId: string, reason: string) {
    const explanation = reasonText(reason);
    const hint = await one<Registration>(this.q, "select * from registrations where id=$1", [registrationId]);
    if (!hint) throw new PolicyError(404, "RegistrationNotFound");
    return withTx(async tx => {
      await lockAccount(tx, hint.accountId);
      const registration = await one<Registration>(tx, "select * from registrations where id=$1 for update", [registrationId]);
      const event = await one<DomainEvent>(tx, "select * from events where id=$1 for share", [hint.eventId]);
      await eventActor(tx, actor, hint.eventId, "checkin.manual");
      const account = await accountFacts(tx, hint.accountId), now = await dbNow(tx);
      if (!registration || !account || account.deletingAt || account.deletedAt || !event) throw new PolicyError(409, "ManualCheckinUnavailable");
      const status = eventStatus(event, now);
      if (status !== "live") throw new PolicyError(409, status === "ended" ? "EventEnded" : status === "cancelled" ? "EventCancelled" : "EventNotLive");
      if (registration.admission !== "approved") throw new PolicyError(409, "NotApproved");
      if (!(await registrationChecks(tx, registration, event, now, true)).canSubmit) throw new PolicyError(409, "VerificationRequired");
      const [existing] = await tx.query<{ id: string }>("select id from checkins where registration_id=$1 and undone_at is null", [registrationId]);
      if (existing) return { checkinId: existing.id };
      const [row] = await tx.query<{ id: string }>("insert into checkins(event_id,registration_id,method,by_staff,checked_in_at) values($1,$2,'manual',$3,clock_timestamp()) returning id", [event.id, registrationId, actor.email]);
      await this.welcome(tx, registrationId, event.id);
      await this.audit(tx, actor.email, "checkin.manual", row!.id, event.id, { reason: explanation, registrationId, verification_override: false });
      return { checkinId: row!.id };
    }, this.db);
  }
  async undoCheckin(actor: StaffPrincipal, checkinId: string, reason: string) {
    const explanation = reasonText(reason);
    const [hint] = await this.q.query<{ account_id: string; registration_id: string; event_id: string; kiosk_id: string | null }>(
      "select r.account_id,c.registration_id,c.event_id,c.kiosk_id from checkins c join registrations r on r.id=c.registration_id where c.id=$1", [checkinId]);
    if (!hint) throw new PolicyError(404, "CheckinNotFound");
    await withTx(async tx => {
      await lockAccount(tx, hint.account_id);
      await tx.query("select id from registrations where id=$1 for update", [hint.registration_id]);
      await tx.query("select id from events where id=$1 for share", [hint.event_id]);
      if (hint.kiosk_id) await tx.query("select id from kiosks where id=$1 for share", [hint.kiosk_id]);
      await eventActor(tx, actor, hint.event_id, "checkin.manual");
      const [row] = await tx.query("update checkins set undone_at=clock_timestamp(),undone_by=$2,updated_at=clock_timestamp() where id=$1 and undone_at is null returning id", [checkinId, actor.email]);
      if (row) await this.audit(tx, actor.email, "checkin.undone", checkinId, hint.event_id, { reason: explanation, registrationId: hint.registration_id });
    }, this.db);
  }
  async checkinFlags(actor: StaffPrincipal, checkinId: string) {
    const row = await one<{ accountId: string; eventId: string; faceEvidenceId: string | null; checkedInAt: Date }>(this.q,
      "select r.account_id,c.event_id,c.face_evidence_id,c.checked_in_at from checkins c join registrations r on r.id=c.registration_id where c.id=$1", [checkinId]);
    if (!row) throw new PolicyError(404, "CheckinNotFound");
    await eventActor(this.q, actor, row.eventId, "checkin.view");
    const account = await accountFacts(this.q, row.accountId);
    return { verification_withdrawn_after_checkin: verificationWithdrawnAfterCheckin(row, account?.evidence ?? []) };
  }
  async context(door: DoorIdentity): Promise<DoorContext> {
    const [session] = await this.q.query<SessionRow>("select d.*,k.name as station from door_sessions d join kiosks k on k.id=d.kiosk_id where d.id=$1", [door.doorSessionId]);
    if (!session) throw new PolicyError(401, "DoorSessionEnded");
    const now = await dbNow(this.q);
    const event = (await one<DomainEvent>(this.q, "select * from events where id=$1", [door.eventId]))!;
    const [counts] = await this.q.query<{ arrived: number }>("select count(*)::int as arrived from checkins where event_id=$1 and undone_at is null", [event.id]);
    const rows = await this.q.query<{ id: string; at: Date; name: string | null; result: ScanResult["result"]; test: boolean }>(`select s.id,s.created_at as at,s.result,s.test,nullif(concat_ws(' ',a.first_name,a.last_name),'') as name
      from scans s left join registrations r on r.id=s.registration_id left join accounts a on a.id=r.account_id
      where s.kiosk_id=$1 order by s.created_at desc,s.id desc limit 5`, [door.kioskId]);
    const day = now.toISOString().slice(0, 10), cost = event.door.kiosk && event.door.mode === "strict" ? 100000 : 50000;
    const ceilings = this.scopes(event.id).map(s => ({ key: `spend:${s.kind}:${s.id}${s.kind === "total" ? "" : `:${day}`}`, limit: Math.round(s.usdCap * 1e6), increment: cost }));
    const environmentCap = parseSpendCapUsd(process.env.DIDIT_SPEND_CAP_USD);
    ceilings.push({ key: "spend:environment:total", limit: Math.round(environmentCap * 1e6), increment: cost });
    ceilings.push({ key: `scan:event:${event.id}:${day}`, limit: this.eventLimit, increment: 1 }, { key: `scan:app:${day}`, limit: this.appLimit, increment: 1 });
    const counters = await this.q.query<{ key: string; value: string }>("select key,value from counters where key=any($1::text[]) and expires_at>clock_timestamp()", [ceilings.map(c => c.key)]);
    const used = new Map(counters.map(c => [c.key, Number(c.value)]));
    const [pin] = await this.q.query("select 1 from door_pins where event_id=$1", [event.id]);
    return {
      station: { id: door.kioskId, name: session.station },
      session: { id: session.id, expiresAt: session.expires_at.toISOString(), startedBy: session.email },
      event: { id: event.id, slug: event.slug, name: event.name, timeZone: event.timezone, capacity: event.capacity, startsAt: event.startsAt.toISOString(), endsAt: event.endsAt.toISOString(),
        logUrl: `${this.options.appUrl ?? process.env.APP_URL ?? "http://localhost:3000"}/admin/events/${event.slug}/log` },
      state: doorState(event, now), doorMode: event.door.kiosk ? event.door.mode : "supervised", threshold: event.door.kiosk ? event.door.match_threshold : 80, arrived: counts!.arrived,
      budgetExhausted: ceilings.some(c => (used.get(c.key) ?? 0) + c.increment > c.limit),
      recentScans: rows.map(r => ({ ...r, at: r.at.toISOString() })), pinSet: !!pin, serverTime: now.toISOString(),
    };
  }
  /** Public door DTO deliberately omits session, account and matched evidence identifiers. */
  async scanView(result: ScanResult, eventId: string, test = false): Promise<DoorScanView> {
    if (result.result === "error") return { result: "error", reason: "service", retryInS: 12, test };
    if (result.result === "unknown") {
      const event = await one<DomainEvent>(this.q, "select * from events where id=$1", [eventId]);
      return { result: "unknown", threshold: event?.door.kiosk ? event.door.match_threshold : 80, bestScore: null, test };
    }
    if (!["welcomed", "welcome_back", "not_on_list", "not_admitted", "not_verified"].includes(result.result) || !("accountId" in result)) return { result: result.result as "paused", test };
    const account = await one<Account>(this.q, "select * from accounts where id=$1 and deleting_at is null and deleted_at is null", [result.accountId]);
    const firstName = account?.firstName ?? "Guest";
    if (result.result === "not_on_list") return { result: "not_on_list", firstName, test };
    if (result.result === "not_verified") return { result: "not_verified", firstName, verification: "requirements_unmet", test };
    if (!("registrationId" in result)) return { result: "unknown", threshold: 80, bestScore: null, test };
    if (result.result === "not_admitted") {
      const reg = await one<Registration>(this.q, "select * from registrations where id=$1", [result.registrationId]);
      const [history] = reg?.admission === "cancelled_by_guest" ? await this.q.query<{ from: string }>(`select "from" from admission_history where registration_id=$1 and "to"='cancelled_by_guest' order by created_at desc limit 1`, [reg.id]) : [];
      const admission = reg?.admission === "waitlisted" ? "waitlisted" : reg?.admission === "rejected" ? "rejected" : reg?.admission === "revoked" ? "revoked"
        : reg?.admission === "cancelled_by_guest" ? (history?.from === "pending" ? "withdrawn" : "cancelled") : reg?.admission === "cancelled_by_host" ? "cancelled" : "pending";
      return { result: "not_admitted", firstName, admission, test };
    }
    const [checkin] = await this.q.query<{ checked_in_at: Date }>("select checked_in_at from checkins where registration_id=$1 and undone_at is null order by checked_in_at desc limit 1", [result.registrationId]);
    const checkedInAt = checkin?.checked_in_at.toISOString() ?? null;
    if (result.result === "welcome_back") return { result: "welcome_back", firstName, checkedInAt, test };
    return { result: "welcomed", firstName, fullName: [firstName, account?.lastName].filter(Boolean).join(" "), checkedInAt, test, registrationId: result.registrationId };
  }
}
export const doorService = new Door();

/** scrypt$<salt>$<hash>, both base64url. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${(await scryptAsync(pin, salt, 32)).toString("base64url")}`;
}
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [kind, salt, expected] = stored.split("$");
  if (kind !== "scrypt" || !salt || !expected) return false;
  const actual = await scryptAsync(pin, Buffer.from(salt, "base64url"), 32), want = Buffer.from(expected, "base64url");
  return actual.length === want.length && timingSafeEqual(actual, want);
}

/** Didit's own search time per door scan (no ids beyond the event/door), to see what the rest of a scan costs. */
async function timed<T>(call: () => Promise<T>, door: { eventId: string; doorSessionId: string }): Promise<T> {
  const t = performance.now();
  try { return await call(); }
  finally { log("door.search", { eventId: door.eventId, doorSessionId: door.doorSessionId, searchMs: Math.round(performance.now() - t) }); }
}
