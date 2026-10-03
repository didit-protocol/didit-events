import { Admissions } from "../admission/admission.ts";
import { Events } from "../admission/events.ts";
import { Invites } from "../admission/invites.ts";
import type { OnboardingView,VerificationLaunch } from "../contracts/event-model.ts";
import type * as schema from "../db/schema.ts";
import type { Tx } from "../db/tx.ts";
import type { CreatedSession,DiditDecision } from "../didit/types.ts";
import type { SpendReservation } from "../spend.ts";
import type { CheckinResult,ScanResult } from "./door.ts";
import type { EligibilityResult,EvidenceAccount } from "./eligibility.ts";
import type { ConsentInput } from "./event-model.ts";
import type { Admission,TransitionActor } from "./transitions.ts";
export type Account = typeof schema.accounts.$inferSelect;
export type DomainEvent = typeof schema.events.$inferSelect;
export type Registration = typeof schema.registrations.$inferSelect;
export type Evidence = typeof schema.evidence.$inferSelect;
export type Verification = typeof schema.verifications.$inferSelect;
export type Session = typeof schema.sessions.$inferSelect;
export type Staff = typeof schema.staff.$inferSelect;
export type Kiosk = typeof schema.kiosks.$inferSelect;
export type Invite = typeof schema.invites.$inferSelect;
export type Deletion = typeof schema.deletions.$inferSelect;
export type EvidenceDraft = Omit<Evidence, "id" | "verificationId" | "createdAt" | "updatedAt">;
export interface GuestPrincipal { principal: "guest"; accountId: string; sessionId: string; authenticatedAt: Date }
/**
 * An admin actor. Global staff (`staff` table) have no `scope` and reach every event. An event team member
 * (`event_members`) carries `scope`: the one event and its role there; `role` is then "staff" only to keep the shape,
 * and every core check refuses a scoped actor unless the call names that event and a capability the role holds
 * (`requireEventActor`). Plain `requireActor` always refuses scoped actors.
 */
export interface StaffPrincipal { principal: "staff"; email: string; role: "owner" | "admin" | "staff"; accountId?: string; sessionId: string; apiTokenId?: string; authenticatedAt?: Date; scope?: { eventId: string; role: "host" | "operator" } }
/** A browser running one event's Door (kiosk mode): the door session and its station. */
export interface DoorIdentity { principal: "door"; eventId: string; kioskId: string; doorSessionId: string; accountId: string; email: string }
export interface PageRequest { limit: number; after?: string }
export interface PageResult<T> { items: T[]; next: string | null }

/** B1 owns all evidence writers, including withdrawal, renewal and C21 idempotence. */
export interface EvidenceService {
  /** Read-only query, no locks; unsuitable for a final door decision until inside lockForCheckin. */
  summary(accountId: string, eventId: string): Promise<EvidenceAccount & { eligibility: EligibilityResult }>;
  /** Pure derivation; fail closed without provider established_at. No DB transaction or locks. */
  derive(decision: DiditDecision, account: Account, workflow: "full" | "renewal" | "age"): Promise<ReadonlyArray<EvidenceDraft>>;
  /** Caller tx (inbox handler or reconciler withTx): lockForDecision (account only). Re-fetch INSIDE lock, bind drafts to the local verification, preserve established_at. Never open a nested transaction. */
  applyDecision(tx: Tx, accountId: string, sessionId: string): Promise<{ verification: Verification; evidence: Evidence[]; changed: boolean }>;
  /** Caller tx, already holds lockForDecision (account only); invalidates only this verification, never changes admission. */
  invalidate(tx: Tx, verificationId: string, reason: string): Promise<void>;
  /** Own tx: lockForRenewal. Requires prior face match >=90, activates one face and supersedes old atomically. */
  activateRenewal(accountId: string, verificationId: string): Promise<"active" | "pending_continuity">;
  /** Own account-locked tx: recheck staff/session, accept this exact verified email, audit and reapply authoritative evidence. */
  acceptVerifiedEmail(actor: StaffPrincipal, registrationId: string, verificationId: string, verifiedEmail: string): Promise<boolean>;
}
export interface VerificationService {
  /** Own tx: account, then affected registration, then event. Inserts active op before enqueue; no provider I/O inside this tx. */
  request(accountId: string, workflowId: string, registrationId?: string): Promise<{ opId: string }>;
  /** Outbox step; caller has job/row claim, adopt via vendor_data listing before retry. Own account tx when attaching; money reserved before create. */
  createOrAdopt(opId: string, reservation: SpendReservation): Promise<CreatedSession>;
  /** Own tx: account -> registration -> event. Separate idempotent attachment and email outbox steps. */
  attach(opId: string, registrationId: string): Promise<void>;
  /** Own tx: account. Guest authenticated <=15 min, link returned only to that browser, op expires in 24h. */
  startRenewal(principal: GuestPrincipal,consent?:ConsentInput): Promise<VerificationLaunch>;
  /** Job lock held by scheduler; each decision has its own account-only tx. C17 usable evidence daily, young pending 5 min then hourly, 30/min. */
  reconcile(): Promise<{ fetched: number; discovered: number; backlogSeconds: number }>;
}
export interface AuthService {
  /** Reuses email OTP redemption to refresh the existing account, without onboarding or consent changes. */
  reproveOtp(principal: GuestPrincipal, challengeId: string, code: string, otpCookie: string): Promise<{ session: Session; cookie: string }>;

  /** Own short tx for counters/challenge; provider send outside tx with spend reservation. Bind request_id, never generate codes. */
  sendOtp(email: string, sourceIp: string, options?: { cookie?: string; resend?: boolean }): Promise<{ challengeId: string; expiresAt: Date; cookie: string }>;
  /** Provider check outside tx; own account tx atomically redeems the matching challenge and rotates the guest session. */
  checkOtp(challengeId: string, code: string, options: { otpCookie: string; previousCookie?: string; email?: string; consent?: ConsentInput }): Promise<{ principal: GuestPrincipal; cookie: string; isNew: boolean; onboarding: OnboardingView; faceLaunch: VerificationLaunch }>;
  /** Compatibility entry point for old staff_login challenges; uses the account flow and shared limits. */
  sendStaffOtp(email: string, sourceIp: string, options?: { cookie?: string; resend?: boolean }): Promise<{ challengeId: string; expiresAt: Date; cookie: string }>;
  /** Redeems a `staff_login` challenge (single use, 3 attempts) and issues an account session (auth_method email_otp). */
  checkStaffOtp(challengeId: string, code: string, options: { otpCookie: string; previousCookie?: string; email?: string; consent?: ConsentInput }): Promise<{ principal: GuestPrincipal; cookie: string; isNew: boolean; onboarding: OnboardingView; faceLaunch: VerificationLaunch }>;
  /** No DB locks. Browser-bound single-use 5-min __Host-oidc state, nonce and PKCE. */
  beginOidc(principal: "staff" | "guest", returnTo: string, previousCookie?: string, consent?: ConsentInput): Promise<{ url: string; cookie: string }>;
  /** Own tx: account first for guest identity linking, issuer+subject unique. Verify issuer/aud/signature/exp/nonce/PKCE/email; all verified identities enter the account flow. */
  finishOidc(callbackUrl: string, stateCookie: string): Promise<{ principal: GuestPrincipal | StaffPrincipal; cookie: string; next?: string; onboarding: OnboardingView; faceLaunch: VerificationLaunch }>;
  /** Read auth session; recheck account deleting_at each request. No mutation locks. */
  requireGuest(sessionCookie: string, maxAuthenticationAgeSec?: number): Promise<GuestPrincipal>;
  /** Read account email and enabled staff membership in the configured domains on every request; accept unexpired legacy staff sessions. */
  requireStaff(sessionCookie: string, roles?: readonly Staff["role"][]): Promise<StaffPrincipal>;
  /** Own tx, staff row UPDATE; owner/admin authorization and audit. B2 owns team management. */
  inviteStaff(actor: StaffPrincipal, email: string, role: Staff["role"]): Promise<Staff>;
  /** Own tx, staff row UPDATE; protect final owner. Account sessions retain guest access. */
  disableStaff(actor: StaffPrincipal, email: string): Promise<void>;
}
export interface SessionService {
  /** Own tx; guest account lock and deletion check, then old session UPDATE. Signed random cookie, atomic rotation. */
  rotate(principal: Omit<GuestPrincipal, "sessionId" | "authenticatedAt"> & { authenticatedAt?: Date; authMethod: "oidc_google" | "email_otp" }, previousSessionId?: string): Promise<{ session: Session; cookie: string }>;
  /** Resolve the live family member, including the short rotation grace, without rotating. */
  resolve(cookie: string): Promise<Session | null>;
  /** Rotate daily under account/family locks; return the same successor to parallel callers. */
  refresh(cookie: string): Promise<{ session: Session; cookie?: string; csrfToken: string } | null>;
  validCsrf(cookie: string, token: string): Promise<boolean>;
  revokeAll(principal: GuestPrincipal): Promise<void>;
  /** Revoke the entire session family under account/family locks. */
  revoke(sessionId: string): Promise<void>;
}
export interface AccountService {
  /** Read-only. Excludes deleting/deleted accounts. */
  get(accountId: string): Promise<Account | null>;
  /** Own account transaction; profile edits never revoke email or face. Email changes unsupported. */
  updateProfile(principal: GuestPrincipal, input: { firstName: string; lastName: string; photoUrl?: string | null }): Promise<Account>;
  /** Own tx: lockForDeletion, mark deleting_at FIRST; invalidate evidence, revoke links/sessions, cancel registrations and write tombstone atomically. */
  requestDeletion(principal: GuestPrincipal, options?: { graceMs?: number }): Promise<Deletion>;
  /** Job lock held; provider deletion retries outside tx. Final purge under lockForDeletion; tombstone survives and prevents restoration. */
  finishDeletion(deletionId: string): Promise<Deletion>;
}
export interface DoorService {
  /** Own tx: account -> registration -> event SHARE -> kiosk SHARE; revalidate exact faceEvidenceId and all eligibility, insert checkin + outbox + notify. */
  checkin(input: { accountId: string; registrationId: string; eventId: string; kioskId: string; faceEvidenceId: string; similarity: number; strictLivenessPassed: boolean }): Promise<CheckinResult>;
  /** Provider calls outside tx with combined reservations; final checkin locks as above. Never stores image. Test mode writes no check-in. */
  scan(door: DoorIdentity, jpeg: Uint8Array, options?: { test?: boolean }): Promise<ScanResult>;
  /** Own tx: account -> registration -> event; staff authorization and audited manual exception reason. */
  manualCheckin(actor: StaffPrincipal, registrationId: string, reason: string): Promise<{ checkinId: string }>;
  /** Own tx: account -> registration -> event -> kiosk if present; undo active row, audit, never clear welcome dedupe. */
  undoCheckin(actor: StaffPrincipal, checkinId: string, reason: string): Promise<void>;
}
export interface AdmissionService {
  /** Caller tx: lockForSeatGrant already held (event UPDATE). All seat grants, including invites/open/promotions, MUST use this path. */
  grantSeat(tx: Tx, registrationId: string, actor: TransitionActor, options?: { overCapacity?: boolean; reason?: string }): Promise<Registration>;
  /** Own tx: account(s) ascending -> event UPDATE directly -> registration; state table, reason, authority, history, outbox and notify. */
  transition(actor: StaffPrincipal | GuestPrincipal, registrationId: string, to: Admission, reason?: string, options?: { overCapacity?: boolean }): Promise<Registration>;
  /** Own tx: account -> event UPDATE directly -> insert/lock registration; reject deleting account, allow reapplication once. */
  apply(principal: GuestPrincipal, eventId: string): Promise<Registration>;
  /** Own tx per candidate: account(s) ascending -> event UPDATE directly -> registration; recheck FIFO applied_at and published/cutoff/capacity. */
  promoteWaitlist(eventId: string): Promise<Registration | null>;
  /** Read-only pagination, no mutation locks. */
  list(eventId: string, query: PageRequest & { admission?: Admission }): Promise<PageResult<Registration>>;
}
export interface EventService {
  /** Read-only public snapshot. No locks. */
  get(idOrSlug: string): Promise<DomainEvent | null>;
  /** Read-only event list; ended status is derived for published/live events. */
  list(): Promise<DomainEvent[]>;
  /** Own transaction; canonical v2 configuration and staff authorization. */
  create(actor: StaffPrincipal, input: typeof schema.events.$inferInsert): Promise<DomainEvent>;
  /** Own event UPDATE transaction; new policy revisions apply only to new submissions. */
  update(actor: StaffPrincipal, eventId: string, patch: Partial<Omit<typeof schema.events.$inferInsert, "id">> & { expectedVersion: number }): Promise<DomainEvent>;
  /** Own event UPDATE tx + outbox signal; affected registration writers run separate ordered transactions. */
  cancel(actor: StaffPrincipal, eventId: string, reason: string): Promise<void>;
  /** Own event UPDATE transactions. Lifecycle changes are separate from ordinary edits. */
  publish(actor: StaffPrincipal, eventId: string): Promise<DomainEvent>;
  end(actor: StaffPrincipal, eventId: string): Promise<DomainEvent>;
  /** All affected accounts ascending -> event UPDATE; owner/admin only. */
  delete(actor: StaffPrincipal, eventId: string, options?: { draftOnly?: boolean }): Promise<void>;
  /** C26 full authoritative snapshot: connect/reconnect, 250ms signal debounce, 15s periodic refresh. No since/watermark. */
  liveSnapshot(actor: StaffPrincipal, eventId: string): Promise<{ updatedAt: Date; registrations: Registration[]; checkins: Array<typeof schema.checkins.$inferSelect>; scans: Array<typeof schema.scans.$inferSelect>; audit: Array<typeof schema.audit.$inferSelect> }>;
}
export interface InviteService {
  /** Own tx: event UPDATE; hash token, bind direct invite to normalized email, enqueue invitation. No later account locks. */
  create(actor: StaffPrincipal, input: { eventId: string; email?: string; maxUses: number; expiresAt: Date; message?: string; skipApproval?: boolean }): Promise<{ invite: Invite; token: string }>;
  /** Own tx: account(s) ascending -> event UPDATE directly -> registration -> invite UPDATE. Signed-in email binding, atomic uses and unique redemption, then grantSeat. */
  redeem(principal: GuestPrincipal, token: string): Promise<Registration>;
  /** Own event UPDATE -> invite UPDATE transaction; no later account/registration locks. */
  revoke(actor: StaffPrincipal, inviteId: string): Promise<void>;
}
export interface NotificationService {
  /** Caller domain transaction holds its ordered locks. Enqueue only; no external send before commit. */
  enqueue(tx: Tx, input: { kind: string; dedupeKey: string; payload: Record<string, unknown>; runAt?: Date }): Promise<void>;
  /** Outbox lease held by dispatcher, no open transaction. Send with provider Idempotency-Key=dedupeKey; side effect is at-least-once across crashes. */
  deliver(input: { kind: string; dedupeKey: string; payload: Record<string, unknown> }): Promise<{ providerId: string }>;
  /** Scheduler owns advisory job lock. Individual enqueue txs use persistent dedupe keys for all reminders M-01..M-22. */
  scheduleReminders(now: Date): Promise<number>;
}
export class NotImplementedError extends Error {
  readonly lane: string;
  constructor(lane: string, method: string) { super(`${lane} must implement ${method}`); this.name = "NotImplementedError"; this.lane = lane; }
}
/** B1 resolves lazily so builds need no provider credentials. */
const b1 = async () => (await import("../verification/runtime.ts")).getVerificationRuntime();
export const evidenceService: EvidenceService = {
  summary: async (...args) => (await b1()).evidence.summary(...args),
  derive: async (...args) => (await b1()).evidence.derive(...args),
  applyDecision: async (...args) => (await b1()).evidence.applyDecision(...args),
  invalidate: async (...args) => (await b1()).evidence.invalidate(...args),
  activateRenewal: async (...args) => (await b1()).evidence.activateRenewal(...args),
  acceptVerifiedEmail: async (...args) => (await b1()).evidence.acceptVerifiedEmail(...args),
};
export const verificationService: VerificationService = {
  request: async (...args) => (await b1()).request(...args),
  createOrAdopt: async (...args) => (await b1()).createOrAdopt(...args),
  attach: async (...args) => (await b1()).attach(...args),
  startRenewal: async (...args) => (await b1()).startRenewal(...args),
  reconcile: async () => (await b1()).reconcile(),
};
export { doorService } from "../door/service.ts";
export { accountService,authService,sessionService } from "../identity/index.ts";
export const admissionService = new Admissions();
export const eventService = new Events();
export const inviteService = new Invites();
// B5's NotificationService is implemented by createNotificationService in notifications/index.ts.
