import { createHmac,randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { registrationChecks } from "../admission/policies.ts";
import type { VerificationLaunch } from "../contracts/event-model.ts";
import type { verificationOps } from "../db/schema.ts";
import { lockForDecision,queryable,withTx,type Tx } from "../db/tx.ts";
import type { DiditClient } from "../didit/client.ts";
import type { CreatedSession,SessionFilters } from "../didit/types.ts";
import { eligibility } from "../domain/eligibility.ts";
import type { ConsentInput } from "../domain/event-model.ts";
import { ModelError } from "../domain/model-error.ts";
import type { DomainEvent,Evidence,GuestPrincipal,Registration,Verification,VerificationService } from "../domain/services.ts";
import { withJobLock } from "../jobs.ts";
import { enqueue } from "../outbox.ts";
import { MAX_PRICE_USD,reserve,settle,type SpendReservation,type SpendScope } from "../spend.ts";
import { EvidenceLifecycle } from "./evidence-service.ts";
import { providerState,terminal } from "./proofs.ts";
import { dbNow,guestSession,hashToken,liveAccount,rows,uuidPattern,VerificationIgnored,type VerificationOptions } from "./shared.ts";

type Op = typeof verificationOps.$inferSelect;
/** Allowed clock skew between our DB clock and Didit (whose created_at has second precision) when adopting (C4). */
export const ADOPT_CLOCK_SKEW_MS = 5 * 60_000;
type Replacement = { replacementOpId: string };
export type VerificationStart = { url: string } | { state: "pending"; retryAfterMs: number };
class VerificationCreationInProgress extends Error { constructor() { super("VerificationCreationInProgress"); } }
export type LinkResolution = { state: "valid" | "expired" | "revoked" | "verified" | "in_review"; event: DomainEvent; registration: Registration; firstName: string };

export class VerificationLifecycle implements VerificationService {
  readonly evidence: EvidenceLifecycle;
  constructor(readonly options: VerificationOptions) { this.evidence = new EvidenceLifecycle(options); }

  private workflow(id: string) {
    const workflow = this.options.workflows[id];
    if (!workflow || !Number.isFinite(workflow.maxPriceUsd) || workflow.maxPriceUsd <= 0) throw new Error("WorkflowNotProvisioned");
    return workflow;
  }

  private async registration(tx: Tx, accountId: string, registrationId: string) {
    // C22, no seat write: account already locked -> registration UPDATE -> event SHARE.
    const [registration] = await rows<Registration>(tx, "select * from registrations where id=$1 and account_id=$2 for update", [registrationId, accountId]);
    if (!registration) throw new Error("RegistrationNotFound");
    const [event] = await rows<DomainEvent>(tx, "select * from events where id=$1 for share", [registration.eventId]);
    const now = await dbNow(tx);
    if (!event || event.endsAt <= now || !["published", "live"].includes(event.status) || registration.admission !== "approved") throw new Error("VerificationUnavailable");
    return { registration, event };
  }

  private async requestInTx(tx: Tx, accountId: string, workflowId: string, registrationId?: string, browserOnly = false) {
    const workflow = this.workflow(workflowId);
    if (workflow.kind === "renewal" && !browserOnly) throw new Error("RenewalRequiresFreshGuest");
    await liveAccount(tx, accountId);
    if (registrationId) await this.registration(tx, accountId, registrationId);
    await tx.query("update verification_ops set state='expired' where account_id=$1 and workflow_id=$2 and state in ('creating','active') and expires_at<=clock_timestamp()", [accountId, workflowId]);
    let [op] = await rows<Op>(tx, "select * from verification_ops where account_id=$1 and workflow_id=$2 and state in ('creating','active')", [accountId, workflowId]);
    if (!op) [op] = await rows<Op>(tx, `insert into verification_ops(account_id,workflow_id,kind,expires_at,vendor_data,email_at_creation)
      select $1::uuid,$2::uuid,$3,clock_timestamp()+interval '24 hours','acct_'||$1::uuid::text,email from accounts where id=$1::uuid returning *`, [accountId, workflowId, workflow.kind]);
    if (registrationId) {
      await tx.query("insert into verification_attachments(op_id,registration_id) values($1,$2) on conflict do nothing", [op!.id, registrationId]);
      if (op!.verificationId) await enqueue(tx, { kind: "verification.attach", dedupeKey: `verification.attach:${op!.id}:${registrationId}`, payload: { opId: op!.id, registrationId } });
    }
    if (!browserOnly) await enqueue(tx, { kind: "verification.create", dedupeKey: `verification.create:${op!.id}`, payload: { opId: op!.id } });
    return { opId: op!.id };
  }

  async request(accountId: string, workflowId: string, registrationId?: string) {
    return withTx(async tx => {
      await lockForDecision(tx, accountId);
      return this.requestInTx(tx, accountId, workflowId, registrationId);
    }, this.options.db);
  }

  /** Compatibility drain for pre-v2 outbox rows; only legacy-imported registrations may use this seam. */
  async requestRegistration(registrationId: string) {
    const [hint] = await queryable(this.options.db).query<{ account_id: string }>("select account_id from registrations where id=$1 and legacy_imported", [registrationId]);
    if (!hint) throw new VerificationIgnored();
    return withTx(async tx => {
      await lockForDecision(tx, hint.account_id);
      const account = await liveAccount(tx, hint.account_id);
      const { event } = await this.registration(tx, account.id, registrationId);
      const evidence = await rows<Evidence>(tx, "select * from evidence where account_id=$1", [account.id]);
      if (eligibility({ ...account, evidence }, event).eligible) return null;
      return this.requestInTx(tx, account.id, this.legacyWorkflowForEvent(event), registrationId);
    }, this.options.db);
  }

  /** Exact filters, overlapping offsets and ID dedupe; provider next URLs are never followed with credentials. */
  async listAll(filters: SessionFilters) {
    const found = new Map<string, Awaited<ReturnType<VerificationOptions["client"]["listSessions"]>>["results"][number]>();
    // Two complete passes catch rows shifted over an offset boundary during the first traversal.
    for (let pass = 0; pass < 2; pass++) {
      let offset = 0, complete = false;
      for (let pageIndex = 0; pageIndex < 10_000; pageIndex++) {
        const page = await this.options.client.listSessions({ ...filters, limit: 100, offset });
        for (const row of page.results) found.set(row.session_id, row);
        if (!page.next) { complete = true; break; }
        if (!page.results.length) throw new Error("InvalidSessionPagination");
        offset += Math.max(1, page.results.length - 10);
      }
      if (!complete) throw new Error("SessionPaginationIncomplete");
    }
    return [...found.values()];
  }

  private async callback(op: Op): Promise<string> {
    const [event] = await queryable(this.options.db).query<{ slug: string }>(`select e.slug from verification_attachments a join registrations r on r.id=a.registration_id
      join events e on e.id=r.event_id where a.op_id=$1 order by a.created_at,r.id limit 1`, [op.id]);
    return new URL(event ? `/e/${encodeURIComponent(event.slug)}/done` : "/me/profile/verification", this.options.appUrl).href;
  }

  private hostedUrl(value: unknown): string | null {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "verify.didit.me" && !url.username && !url.password && !url.port ? url.href : null;
    } catch { return null; }
  }

  private async opResult(op: Op, verification: Verification): Promise<CreatedSession> {
    const status = verification.providerStatus as CreatedSession["status"] | null;
    const callback = new URL(await this.callback(op));
    callback.searchParams.set("verificationSessionId", verification.diditSessionId);
    const url = status && terminal(status) ? callback.href : this.hostedUrl(verification.hostedUrl);
    if (!url) throw new Error("VerificationHostedUrlUnavailable");
    return { session_id: verification.diditSessionId, workflow_id: verification.workflowId, vendor_data: verification.vendorData,
      status: status ?? "Not Started", url };
  }

  /** Follow durable replacements after releasing the old dispatch lock and reservation. */
  async createOrAdopt(opId: string, suppliedReservation?: SpendReservation): Promise<CreatedSession> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await this.createAttempt(opId, attempt === 0 ? suppliedReservation : undefined);
      if ("session_id" in result) return result;
      opId = result.replacementOpId;
    }
    throw new VerificationCreationInProgress();
  }

  private async replaceStale(op: Op): Promise<Replacement> {
    return withTx(async tx => {
      await lockForDecision(tx, op.accountId);
      await liveAccount(tx, op.accountId);
      await tx.query("update verification_ops set state='stale' where id=$1", [op.id]);
      let [replacement] = await rows<Op>(tx, "select * from verification_ops where account_id=$1 and workflow_id=$2 and state in ('creating','active')", [op.accountId, op.workflowId]);
      if (!replacement) [replacement] = await rows<Op>(tx, `insert into verification_ops(account_id,workflow_id,kind,expires_at,vendor_data,email_at_creation)
        select $1::uuid,$2::uuid,$3,$4,'acct_'||$1::uuid::text,email from accounts where id=$1::uuid returning *`, [op.accountId, op.workflowId, op.kind, op.expiresAt]);
      await tx.query("update verification_ops set replacement_op_id=$2 where id=$1", [op.id, replacement!.id]);
      await tx.query(`insert into verification_attachments(op_id,registration_id)
        select $2,registration_id from verification_attachments where op_id=$1 on conflict do nothing`, [op.id, replacement!.id]);
      if (op.kind !== "renewal") await enqueue(tx, { kind: "verification.create", dedupeKey: `verification.create:${replacement!.id}`, payload: { opId: replacement!.id } });
      return { replacementOpId: replacement!.id };
    }, this.options.db);
  }

  /** Serializes network dispatch per durable op without holding the app pool or nesting spend transactions. */
  private async createAttempt(opId: string, suppliedReservation?: SpendReservation): Promise<CreatedSession | Replacement> {
    let reservation = suppliedReservation;
    try {
      const result = await withJobLock(`verification-create:${opId}`, async () => {
        const op = await withTx(async tx => {
          const [hint] = await rows<Op>(tx, "select * from verification_ops where id=$1", [opId]);
          if (!hint) throw new VerificationIgnored();
          await lockForDecision(tx, hint.accountId);
          await liveAccount(tx, hint.accountId);
          const [current] = await rows<Op>(tx, "select * from verification_ops where id=$1", [opId]);
          if (!current || ["expired", "failed"].includes(current.state) || current.expiresAt <= await dbNow(tx)) throw new Error("VerificationOperationExpired");
          return current;
        }, this.options.db);
        if (op.state === "stale" && op.replacementOpId) return { replacementOpId: op.replacementOpId };
        const q = queryable(this.options.db);
        if (op.verificationId) {
          const [verification] = await rows<Verification>(q, "select * from verifications where id=$1", [op.verificationId]);
          if (verification) {
            if (terminal(verification.providerStatus ?? "") || this.hostedUrl(verification.hostedUrl)) return this.opResult(op, verification);
            const decision = await this.options.client.getDecision(verification.diditSessionId);
            if (decision.session_id !== verification.diditSessionId || decision.workflow_id !== op.workflowId || decision.vendor_data !== `acct_${op.accountId}`) throw new VerificationIgnored();
            const hostedUrl = this.hostedUrl(decision.url) ?? this.hostedUrl(decision.session_url);
            if (!hostedUrl && !terminal(decision.status)) return this.replaceStale(op);
            await withTx(async tx => {
              await lockForDecision(tx, op.accountId);
              await liveAccount(tx, op.accountId, verification.diditSessionId);
              await tx.query("update verifications set hosted_url=$2 where id=$1", [verification.id, hostedUrl]);
              await enqueue(tx, { kind: "verification.refresh", dedupeKey: `verification.refresh:url:${op.id}`, payload: { accountId: op.accountId, sessionId: verification.diditSessionId } });
            }, this.options.db);
            return this.opResult(op, { ...verification, hostedUrl, providerStatus: decision.status });
          }
        }
        // Recovery ALWAYS precedes any possible paid retry, including a completed remote session.
        const stale = new Set((await q.query<{ didit_session_id: string }>(`select v.didit_session_id from verification_ops op
          join verifications v on v.id=op.verification_id where op.account_id=$1 and op.workflow_id=$2 and op.state='stale'`, [op.accountId, op.workflowId])).map(row => row.didit_session_id));
        // Sessions already bound to another verification row can never be adopted by this op.
        const bound = new Set((await q.query<{ didit_session_id: string }>("select didit_session_id from verifications where account_id=$1",
          [op.accountId])).map(row => row.didit_session_id));
        // Didit timestamps have second precision and a different clock than ours: accept a skew window before the op.
        const notBefore = new Date(op.createdAt.getTime() - ADOPT_CLOCK_SKEW_MS);
        const candidates = (await this.listAll({ vendor_data: `acct_${op.accountId}`, workflow_id: op.workflowId }))
          .filter(row => !stale.has(row.session_id) && uuidPattern.test(row.session_id) && row.vendor_data === `acct_${op.accountId}` && (!row.workflow_id || row.workflow_id === op.workflowId) && !bound.has(row.session_id) && new Date(row.created_at) >= notBefore)
          .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.session_id.localeCompare(b.session_id));
        let remote: { session_id: string; workflow_id: string; vendor_data?: string | null; status: CreatedSession["status"]; url: string | null } | undefined;
        let remoteCreatedAt: Date | undefined;
        for (const candidate of candidates) {
          // List rows may omit workflow_id. The decision binds the adopted session authoritatively.
          const decision = await this.options.client.getDecision(candidate.session_id);
          if (decision.workflow_id !== op.workflowId || decision.vendor_data !== `acct_${op.accountId}` || decision.session_id !== candidate.session_id) continue;
          remoteCreatedAt = new Date(decision.created_at);
          if (remoteCreatedAt < notBefore) continue;
          remote = { session_id: candidate.session_id, workflow_id: op.workflowId, vendor_data: decision.vendor_data, status: decision.status,
            url: this.hostedUrl(candidate.session_url) ?? this.hostedUrl(candidate.url) ?? this.hostedUrl(decision.url) ?? this.hostedUrl(decision.session_url) };
          break;
        }
        if (!remote) {
          const workflow = this.workflow(op.workflowId);
          const attachments = await q.query<{ event_id: string }>(`select distinct r.event_id from verification_attachments a
            join registrations r on r.id=a.registration_id where a.op_id=$1 order by r.event_id`, [op.id]);
          const scopes: SpendScope[] = [{ kind: "app/day", id: "events", usdCap: this.options.appDailyCapUsd }, { kind: "total", id: "events", usdCap: this.options.totalCapUsd },
            ...attachments.map(row => ({ kind: "event/day" as const, id: row.event_id, usdCap: this.options.eventDailyCapUsd }))];
          reservation ??= await reserve({ op: `session_${workflow.kind}`, usdMax: Math.max(workflow.maxPriceUsd, workflow.kind === "age" ? 0 : MAX_PRICE_USD[`session_${workflow.kind}`]), scopes }, this.options.db);
          // Revalidate deletion/event gates after remote discovery and before dispatch.
          await withTx(async tx => {
            await lockForDecision(tx, op.accountId);
            await liveAccount(tx, op.accountId);
            // All registrations first, then all events; no lock-order reversal for multi-event reuse.
            const links = await tx.query<{ id: string; admission: string; event_id: string }>(`select r.id,r.admission,r.event_id from registrations r join verification_attachments a on a.registration_id=r.id
              where a.op_id=$1 order by r.id for update of r`, [op.id]);
            const events = await tx.query<{ id: string; status: string; ends_at: Date }>(`select e.* from events e where e.id in
              (select r.event_id from registrations r join verification_attachments a on a.registration_id=r.id where a.op_id=$1) order by e.id for share`, [op.id]);
            const now = await dbNow(tx);
            if (op.kind !== "renewal" && links.length && !links.some(row => row.admission === "approved" &&
              events.some(event => event.id === row.event_id && ["published", "live"].includes(event.status) && event.ends_at > now))) throw new Error("VerificationUnavailable");
            const [ledger] = await tx.query<{ scopes: Array<{ key: string; limitMicros: number }> }>("select scopes from spend where id=$1 and dispatched_at is null and state='reserved'", [reservation!.id]);
            const covers = (prefix: string, limit: number) => ledger?.scopes.some(scope =>
              (prefix.endsWith(":") ? scope.key.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}$/.test(scope.key.slice(prefix.length)) : scope.key === prefix)
              && scope.limitMicros <= Math.round(limit * 1e6));
            if (!covers("spend:app/day:events:", this.options.appDailyCapUsd) || !covers("spend:total:events", this.options.totalCapUsd) || events.some(event => !covers(`spend:event/day:${event.id}:`, this.options.eventDailyCapUsd))) throw new Error("VerificationReservationScopesRequired");
            await tx.query("update verification_ops set attempts=attempts+1 where id=$1", [op.id]);
          }, this.options.db);
          remote = await this.options.client.createSession({ workflow_id: op.workflowId, vendor_data: `acct_${op.accountId}`, callback: await this.callback(op),
            callback_method: "both", contact_details: { send_notification_emails: false } }, reservation);
        }
        const created = remote;
        if (!uuidPattern.test(created.session_id) || created.workflow_id !== op.workflowId || (created.vendor_data != null && created.vendor_data !== `acct_${op.accountId}`)) throw new Error("InvalidCreatedSessionBinding");
        const verification = await withTx(async tx => {
          await lockForDecision(tx, op.accountId);
          await liveAccount(tx, op.accountId, created.session_id);
          await tx.query(`insert into verifications(account_id,didit_session_id,workflow_id,vendor_data,status,provider_status,hosted_url,created_at,next_fetch_at)
            values($1,$2,$3,$4,$5,$6,$7,coalesce($8::timestamptz,clock_timestamp()),clock_timestamp()) on conflict(didit_session_id) do nothing`,
          [op.accountId, created.session_id, op.workflowId, `acct_${op.accountId}`, providerState(created.status), created.status, this.hostedUrl(created.url), remoteCreatedAt ?? null]);
          const [stored] = await rows<Verification>(tx, "select * from verifications where didit_session_id=$1", [created.session_id]);
          if (!stored || stored.accountId !== op.accountId || stored.workflowId !== op.workflowId) throw new VerificationIgnored();
          if (!stored.hostedUrl && this.hostedUrl(created.url)) await tx.query("update verifications set hosted_url=$2 where id=$1", [stored.id, this.hostedUrl(created.url)]);
          await tx.query("update verification_ops set verification_id=$2,state=$3,didit_session_id=$4 where id=$1", [op.id, stored.id, terminal(created.status) ? "completed" : "active",stored.diditSessionId]);
          if (this.hostedUrl(created.url) || terminal(created.status)) {
            for (const attachment of await tx.query<{ registration_id: string }>("select registration_id from verification_attachments where op_id=$1", [op.id])) {
              await enqueue(tx, { kind: "verification.attach", dedupeKey: `verification.attach:${op.id}:${attachment.registration_id}`, payload: { opId: op.id, registrationId: attachment.registration_id } });
            }
          }
          await enqueue(tx, { kind: "verification.refresh", dedupeKey: `verification.refresh:${op.id}`, payload: { accountId: op.accountId, sessionId: created.session_id } });
          return { ...stored, hostedUrl: stored.hostedUrl ?? this.hostedUrl(created.url) };
        }, this.options.db);
        if (!this.hostedUrl(created.url) && !terminal(created.status)) return this.replaceStale(op);
        return this.opResult(op, verification);
      }, this.options.db);
      if (!result.acquired) throw new VerificationCreationInProgress();
      return result.value;
    } finally {
      if (reservation) {
        // Once claimed, keep the full maximum even after errors/crashes; no guessed usage refund.
        const [row] = await queryable(this.options.db).query<{ dispatched_at: Date | null }>("select dispatched_at from spend where id=$1", [reservation.id]);
        await settle(reservation.id, row?.dispatched_at ? "uncertain" : 0, this.options.db);
      }
    }
  }

  async attach(opId: string, registrationId: string) {
    await withTx(async tx => {
      const [op] = await rows<Op>(tx, "select * from verification_ops where id=$1", [opId]);
      if (!op) throw new VerificationIgnored();
      await lockForDecision(tx, op.accountId);
      await liveAccount(tx, op.accountId);
      const [current] = await rows<Op>(tx, "select * from verification_ops where id=$1", [opId]);
      if (current?.state === "stale") return; // Its replacement owns attachment and delivery.
      await this.registration(tx, op.accountId, registrationId);
      const [ready] = await tx.query("select id from verification_ops where id=$1 and verification_id is not null", [opId]);
      if (!ready) throw new Error("VerificationCreationPending");
      const [attachment] = await tx.query("update verification_attachments set attached_at=coalesce(attached_at,clock_timestamp()) where op_id=$1 and registration_id=$2 returning op_id", [opId, registrationId]);
      if (!attachment) throw new Error("VerificationAttachmentNotRequested");
      // B5 owns delivery and calls issueLink immediately before sending; no plaintext token is persisted.
      await enqueue(tx, { kind: "M-03", dedupeKey: `verification.email:${opId}:${registrationId}`, payload: { registrationId, verificationOpId: opId } });
    }, this.options.db);
  }

  /** Remove verification without deleting the guest account or rewriting historical attendance. */
  async requestEvidenceDeletion(principal: GuestPrincipal): Promise<void> {
    await withTx(async tx => {
      await lockForDecision(tx, principal.accountId);
      await liveAccount(tx, principal.accountId);
      await guestSession(tx, principal.accountId, principal.sessionId);
      // A provider create already in flight must finish before its session can be tombstoned.
      if ((await tx.query("select id from verification_ops where account_id=$1 and state='creating'", [principal.accountId])).length) throw new Error("VerificationCreationInFlight");
      const remote = await tx.query<{ didit_session_id: string }>("select didit_session_id from verifications where account_id=$1 and reconcile_state<>'ignored'", [principal.accountId]);
      await tx.query("delete from evidence where account_id=$1 and kind<>'face'", [principal.accountId]);
      await tx.query("update evidence set value=null,invalidated_at=coalesce(invalidated_at,clock_timestamp()),invalidated_reason='verification_deleted',activation='revoked',state='invalidated',updated_at=clock_timestamp() where account_id=$1", [principal.accountId]);
      await tx.query("update verifications set decision=null,q_first_name=null,q_last_name=null,verified_email=null,hosted_url=null,liveness_at=null,age_estimate=null,next_fetch_at=null,reconcile_state='ignored' where account_id=$1", [principal.accountId]);
      await tx.query("update verification_ops set state='expired' where account_id=$1 and state='active'", [principal.accountId]);
      await tx.query("update link_tokens set revoked_at=coalesce(revoked_at,clock_timestamp()) where registration_id in(select id from registrations where account_id=$1)", [principal.accountId]);
      if (remote.length) {
        // Session-only tombstones block late webhooks/reconciliation, while retaining the live account.
        await tx.query("insert into deletions(email_hash,didit_session_ids) values(null,$1::jsonb)", [JSON.stringify(remote.map(r => r.didit_session_id))]);
        await tx.query("insert into jobs(name,interval_sec) values('identity:deletions',60) on conflict(name) do update set next_run_at=clock_timestamp()");
        for (const { didit_session_id } of remote) await tx.query("update inbox set raw=null,headers=null,processed_at=coalesce(processed_at,clock_timestamp()) where raw like $1", [`%${didit_session_id}%`]);
      }
      const registrations = await tx.query<{ event_id: string }>("select distinct event_id from registrations where account_id=$1", [principal.accountId]);
      const { notifyInTx } = await import("../notify.ts");
      for (const { event_id } of registrations) await notifyInTx(tx, `event_${event_id}`, { type: "verification_deleted", event_id });
      await tx.query("insert into audit(actor,action,target) values($1,'verification.deletion_requested',$1)", [principal.accountId]);
    }, this.options.db);
  }

  async issueLink(accountId: string, registrationId: string, deliveryKey?: string): Promise<{ token: string; url: string; expiresAt: Date; id: string }> {
    return withTx(async tx => {
      await lockForDecision(tx, accountId);
      await liveAccount(tx, accountId);
      let token: string | undefined;
      if (deliveryKey) {
        const secret = process.env.SESSION_SECRET;
        if (!secret || secret.length < 32) throw new Error("SessionSecretRequired");
        token = createHmac("sha256", secret).update(`verification-email-link\0${accountId}\0${registrationId}\0${deliveryKey}`).digest("base64url");
      }
      return this.issueLinkInTx(tx, accountId, registrationId, token);
    }, this.options.db);
  }

  private async issueLinkInTx(tx: Tx, accountId: string, registrationId: string, deliveryToken?: string) {
    const { event } = await this.registration(tx, accountId, registrationId);
    const token = deliveryToken ?? randomBytes(32).toString("base64url");
    await tx.query("insert into link_tokens(hash,registration_id,expires_at) values($1,$2,$3) on conflict(hash) do nothing", [hashToken(token), registrationId, event.endsAt]);
    const [link] = await tx.query<{ id: string; expires_at: Date }>("select id,expires_at from link_tokens where hash=$1 and revoked_at is null and expires_at>clock_timestamp()", [hashToken(token)]);
    if (!link) throw new VerificationIgnored();
    return { token, id: link.id, expiresAt: link.expires_at, url: new URL(`/e/${encodeURIComponent(event.slug)}/v/${token}`, this.options.appUrl).href };
  }

  async requestLink(principal: GuestPrincipal, slug: string): Promise<{ url: string }> {
    return withTx(async tx => {
      await lockForDecision(tx, principal.accountId);
      await liveAccount(tx, principal.accountId);
      await guestSession(tx, principal.accountId, principal.sessionId);
      const [registration] = await rows<Registration>(tx,"select r.* from registrations r join events e on e.id=r.event_id where r.account_id=$1 and e.slug=$2", [principal.accountId, slug]);
      if (!registration) throw new Error("RegistrationNotFound");
      const {event}=await this.registration(tx,principal.accountId,registration.id);
      if((await registrationChecks(tx,registration,event,await dbNow(tx))).canSubmit)return {url:new URL(`/me/events/${encodeURIComponent(slug)}`,this.options.appUrl).href};
      const link = await this.issueLinkInTx(tx, principal.accountId, registration.id);
      await enqueue(tx, { kind: "M-03", dedupeKey: `verification.email.link:${link.id}`, payload: { registrationId: registration.id } });
      return { url: link.url };
    }, this.options.db);
  }

  async revokeLink(accountId: string, linkId: string): Promise<void> {
    await withTx(async tx => {
      await lockForDecision(tx, accountId);
      await tx.query(`update link_tokens l set revoked_at=coalesce(revoked_at,clock_timestamp()) from registrations r
        where l.registration_id=r.id and r.account_id=$1 and l.id=$2`, [accountId, linkId]);
    }, this.options.db);
  }

  async resolveLink(slug: string, token: string, q = queryable(this.options.db)): Promise<LinkResolution | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const [link] = await q.query<{ registration_id: string; account_id: string; event_id: string; expires_at: Date; revoked_at: Date | null }>(`select l.*,r.account_id,r.event_id
      from link_tokens l join registrations r on r.id=l.registration_id join events e on e.id=r.event_id
      where l.hash=$1 and l.scope='verification' and e.slug=$2`, [hashToken(token), slug]);
    if (!link) return null;
    let account;
    try { account = await liveAccount(q, link.account_id); } catch (error) { if (error instanceof VerificationIgnored) return null; throw error; }
    const [event] = await rows<DomainEvent>(q, "select * from events where id=$1", [link.event_id]);
    const [registration] = await rows<Registration>(q, "select * from registrations where id=$1", [link.registration_id]);
    if (!event || !registration || event.status === "draft") return null;
    const now = await dbNow(q);
    const checks = await registrationChecks(q,registration,event,now,true);
    const [latest] = await rows<Verification>(q, `select v.* from verification_attachments a join verification_ops op on op.id=a.op_id
      join verifications v on v.id=op.verification_id where a.registration_id=$1 and v.account_id=$2 and op.state<>'stale'
      order by op.created_at desc,op.id desc limit 1`, [registration.id, account.id]);
    const state = link.revoked_at || registration.admission !== "approved" || event.status === "cancelled" ? "revoked" :
      link.expires_at <= now || event.endsAt <= now || event.status === "ended" ? "expired" : checks.canSubmit ? "verified" :
        latest?.status === "in_review" ? "in_review" : "valid";
    return { state, event, registration, firstName: account.firstName ?? "" };
  }

  legacyWorkflowForEvent(event: DomainEvent): string {
    const kind = event.ageMin != null || event.requirements.age_min != null ? "age" : "full";
    const id = Object.keys(this.options.workflows).find(id => this.options.workflows[id]!.kind === kind);
    if (!id) throw new Error("WorkflowNotProvisioned");
    this.workflow(id);
    return id;
  }

  async startLegacyForRegistration(principal: GuestPrincipal, slug: string, token?: string): Promise<VerificationStart> {
    const requested = await withTx(async tx => {
      await lockForDecision(tx, principal.accountId);
      await liveAccount(tx, principal.accountId);
      await guestSession(tx, principal.accountId, principal.sessionId);
      const [registration] = await rows<Registration>(tx, `select r.* from registrations r join events e on e.id=r.event_id where r.account_id=$1 and e.slug=$2`, [principal.accountId, slug]);
      if (!registration) throw new Error("RegistrationNotFound");
      if (token) {
        const link = await this.resolveLink(slug, token, tx);
        if (!link || link.registration.accountId !== principal.accountId || !["valid", "verified"].includes(link.state)) throw new Error("VerificationLinkUnavailable");
      }
      const { event } = await this.registration(tx, principal.accountId, registration.id);
      const account = await liveAccount(tx, principal.accountId);
      const evidence = await rows<Evidence>(tx, "select * from evidence where account_id=$1", [principal.accountId]);
      if (eligibility({ ...account, evidence }, event).eligible) return { url: new URL(`/e/${encodeURIComponent(slug)}/done`, this.options.appUrl).href };
      return this.requestInTx(tx, principal.accountId, this.legacyWorkflowForEvent(event), registration.id);
    }, this.options.db);
    if ("url" in requested) return requested;
    // A worker or another click may own dispatch. Wait outside any transaction, then
    // let the next POST retry if that owner still has not published its result.
    const deadline = performance.now() + 8000;
    do {
      try { return { url: (await this.createOrAdopt(requested.opId)).url }; }
      catch (error) { if (!(error instanceof VerificationCreationInProgress)) throw error; }
      const remaining = deadline - performance.now();
      if (remaining <= 0) break;
      await sleep(Math.min(100, remaining));
    } while (performance.now() < deadline);
    return { state: "pending", retryAfterMs: 1000 };
  }

  async startLegacyRenewal(principal: GuestPrincipal): Promise<{ opId: string; url: string }> {
    const workflowId = Object.keys(this.options.workflows).find(id => this.options.workflows[id]!.kind === "renewal");
    if (!workflowId) throw new Error("RenewalNotProvisioned");
    const result = await withTx(async tx => {
      await lockForDecision(tx, principal.accountId);
      const account = await liveAccount(tx, principal.accountId);
      await guestSession(tx, principal.accountId, principal.sessionId, true);
      if (!account.hasFaceHistory && !(await tx.query("select id from evidence where account_id=$1 and kind='face' limit 1", [account.id])).length) throw new Error("NoVerificationToRenew");
      return this.requestInTx(tx, principal.accountId, workflowId, undefined, true);
    }, this.options.db);
    const remote = await this.createOrAdopt(result.opId);
    return { ...result, url: remote.url };
  }

  async startForRegistration(principal:GuestPrincipal,slug:string,token?:string):Promise<VerificationStart> {
    const q=queryable(this.options.db);
    const [r]=await rows<Registration>(q,"select r.* from registrations r join events e on e.id=r.event_id where r.account_id=$1 and e.slug=$2",[principal.accountId,slug]);
    if(!r)throw new Error("RegistrationNotFound");
    if(token){const link=await this.resolveLink(slug,token);if(!link || link.registration.accountId!==principal.accountId || !["valid","verified"].includes(link.state))throw new Error("VerificationLinkUnavailable");}
    const {ModelVerification}=await import("./model-verification.ts");
    const launch=await new ModelVerification({...this.options,client:this.options.client as DiditClient}).startRegistrationRenewal(principal,r.id,{strategy:"minimal"});
    if(launch.state==="ready")return {url:launch.url};
    if(launch.state==="not_needed")return {url:new URL(`/me/events/${encodeURIComponent(slug)}`,this.options.appUrl).href};
    if(launch.state==="creating")return {state:"pending",retryAfterMs:launch.retryAfterMs};
    throw new ModelError(launch.code==="consent_required"?"checks_required":launch.code==="budget"?"budget":launch.code==="provider_unavailable"?"provider_unavailable":"review_required");
  }
  async startRenewal(principal:GuestPrincipal,consent?:ConsentInput):Promise<VerificationLaunch> {
    const {createModelServices}=await import("./model-runtime.ts");
    if(!consent)throw new ModelError("invalid","Explicit face consent is required");
    return createModelServices({...this.options,client:this.options.client as DiditClient}).onboarding.ensureFaceSession(principal,{purpose:"face_renewal",consent});
  }
  async renewFromCookie(cookie:string,consent?:ConsentInput) {
    const session=await this.options.sessions.resolve(cookie);
    if(!session || session.principal!=="guest" || !session.accountId)throw new ModelError("unauthenticated");
    return this.startRenewal({principal:"guest",accountId:session.accountId,sessionId:session.id,authenticatedAt:session.authenticatedAt},consent);
  }

  async outcome(accountId: string, slug: string, sessionId?: string) {
    const q = queryable(this.options.db);
    await liveAccount(q, accountId);
    if (sessionId && !uuidPattern.test(sessionId)) return null;
    const [event] = await rows<DomainEvent>(q, "select e.* from events e join registrations r on r.event_id=e.id where e.slug=$1 and r.account_id=$2 and e.status<>'draft'", [slug, accountId]);
    if (!event) return null;
    const [verification] = await rows<Verification>(q, `select * from verifications where account_id=$1 and ($2::uuid is null or didit_session_id=$2) order by created_at desc,id desc limit 1`, [accountId, sessionId ?? null]);
    if (!verification) return null;
    const summary = await this.evidence.summary(accountId, event.id);
    const state = summary.eligibility.eligible ? "approved" as const : verification.status === "in_review" || verification.status === "approved" ? "in_review" as const : verification.status === "declined" ? "declined" as const : "not_finished" as const;
    return { state, event, attemptsLeft: 0 };
  }

  async reconcile(): Promise<{ fetched: number; discovered: number; backlogSeconds: number }> {
    const { reconcile } = await import("./reconcile.ts");
    return reconcile(this);
  }
}
