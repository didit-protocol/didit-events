import { staffEmailSql } from "../staff-email.ts";
import { AdmissionError, requireEventActor } from "../admission/shared.ts";
import { lockForDecision,queryable,withTx,type Tx } from "../db/tx.ts";
import type { DiditDecision } from "../didit/types.ts";
import { eligibility } from "../domain/eligibility.ts";
import { deriveEvidence,type EvidenceChanges,type EvidenceDecision,type EvidenceRecovery } from "../domain/evidence.ts";
import { DEFAULT_TTL_DAYS } from "../domain/requirements.ts";
import type { Account,DomainEvent,Evidence,EvidenceDraft,EvidenceService,StaffPrincipal,Verification } from "../domain/services.ts";
import { staffForSession } from "../identity/sessions.ts";
import { sessionLiveSql } from "../identity/shared.ts";
import { notifyInTx } from "../notify.ts";
import { acceptedEvent } from "../admission/policies.ts";
import type { Registration } from "../domain/services.ts";
import { applyModelDecision } from "./model-verification.ts";
import { bindProofs,providerState,terminal } from "./proofs.ts";
import { dbNow,liveAccount,rows,uuidPattern,VerificationIgnored,type VerificationOptions,type WorkflowKind } from "./shared.ts";

export class EvidenceLifecycle implements EvidenceService {
  constructor(private readonly options: VerificationOptions) {}

  async summary(accountId: string, eventId: string) {
    const q = queryable(this.options.db);
    const account = await liveAccount(q, accountId);
    const [event] = await rows<DomainEvent>(q, "select * from events where id=$1", [eventId]);
    if (!event) throw new Error("EventNotFound");
    const evidence = await rows<Evidence>(q, "select * from evidence where account_id=$1", [accountId]);
    const subject = { ...account, evidence };
    const [registration] = await rows<Registration>(q,"select * from registrations where account_id=$1 and event_id=$2",[accountId,eventId]);
    return { ...subject, eligibility: eligibility(subject, registration ? await acceptedEvent(q,registration,event) : event) };
  }

  async derive(decision: DiditDecision, account: Account, workflow: WorkflowKind): Promise<ReadonlyArray<EvidenceDraft>> {
    if (decision.vendor_data !== `acct_${account.id}` || account.deletingAt || account.deletedAt) throw new VerificationIgnored();
    const now = new Date(), proof = bindProofs(decision, account, workflow, now);
    // Preview drafts cannot establish continuity. Only applyDecision can activate under the account lock.
    const changes = deriveEvidence({ accountId: account.id, verificationId: decision.session_id, providerStatus: proof.reason ? "in_review" : decision.status === "Approved" ? "approved" : "declined",
      establishedAt: proof.established, observedAt: now, proofs: proof.proofs, matches: [] }, { evidence: [], hasFaceHistory: true, sessionIds: new Map() });
    return changes.insert.map(({ verificationId: _id, ...row }) => ({ ...row, source: row.source ?? "legacy", binding: row.binding ?? "legacy_chain", subjectFaceId: row.subjectFaceId ?? null, reason: row.invalidatedReason }));
  }

  async applyDecision(tx: Tx, accountId: string, sessionId: string) {
    return this.apply(tx, accountId, sessionId);
  }

  private async apply(tx: Tx, accountId: string, sessionId: string, recovery?: EvidenceRecovery, acceptingEmail?: string) {
    if (!uuidPattern.test(accountId) || !uuidPattern.test(sessionId)) throw new VerificationIgnored();
    await lockForDecision(tx, accountId);
    const [modelOp] = await tx.query("select id from verification_ops where didit_session_id=$1 and account_id=$2 and purpose<>'legacy'", [sessionId,accountId]);
    if (modelOp) return applyModelDecision(tx, accountId, sessionId, this.options.client, recovery);
    const account = await liveAccount(tx, accountId, sessionId);
    // A webhook is only a hint; the latest provider decision is fetched AFTER the linearization lock.
    const decision = await this.options.client.getDecision(sessionId);
    const workflow = decision.workflow_id && this.options.workflows[decision.workflow_id];
    if (!workflow || !Number.isFinite(workflow.maxPriceUsd) || workflow.maxPriceUsd <= 0 || decision.session_id !== sessionId || decision.vendor_data !== `acct_${accountId}`) throw new VerificationIgnored();
    const now = await dbNow(tx), createdAt = new Date(decision.created_at);
    if (!Number.isFinite(createdAt.getTime()) || createdAt > now) throw new Error("InvalidProviderCreationTime");
    await tx.query(`insert into verifications(account_id,didit_session_id,workflow_id,vendor_data,created_at)
      values($1,$2,$3,$4,$5) on conflict(didit_session_id) do nothing`, [accountId, sessionId, decision.workflow_id, decision.vendor_data, createdAt]);
    const [previous] = await rows<Verification>(tx, "select * from verifications where didit_session_id=$1", [sessionId]);
    if (!previous || previous.accountId !== accountId || previous.workflowId !== decision.workflow_id) throw new VerificationIgnored();
    const existing = await rows<Evidence>(tx, "select * from evidence where account_id=$1", [accountId]);
    const history = await rows<Verification>(tx, "select * from verifications where account_id=$1", [accountId]);
    const own = existing.filter(row => row.verificationId === previous.id);
    const proof = bindProofs(decision, account, workflow.kind, now, previous.acceptedEmail);
    // A stale drawer cannot authorize a different address or an unapproved provider decision.
    if (acceptingEmail && (decision.status !== "Approved" || proof.emailMatches !== false || proof.verifiedEmail !== acceptingEmail)) throw new VerificationIgnored();
    // Once recorded, the original approval survives evidence/raw-decision retention and re-approval.
    const established = previous.firstApprovedAt ?? own[0]?.establishedAt ?? previous.livenessAt ?? proof.established;
    if (established && proof.reason === "approval timestamp unavailable") proof.reason = null;
    // Missing current approval events may not create new kinds; existing facts can still be restored.
    const status: EvidenceDecision["providerStatus"] = proof.reason ? "in_review" : decision.status === "Approved" ? "approved" :
      own.length || previous.firstApprovedAt ? "withdrawn" : decision.status === "Declined" ? "declined" : "in_review";
    // A sweep after retention must never re-create an already expired proof from old provider data.
    const freshProofs = proof.proofs.filter(row => own.some(existing => existing.kind === row.kind) ||
      established && established.getTime() + DEFAULT_TTL_DAYS[row.kind] * 86400_000 > now.getTime());
    const renewalActivation = workflow.kind === "renewal" && !own.some(row => row.kind === "face" && row.activation !== "pending_continuity");
    const freshRenewal = !renewalActivation || (await tx.query(`select id from verification_ops where account_id=$1 and workflow_id=$2
      and (verification_id=$3 or (verification_id is null and created_at<=$4)) and expires_at>$5
      and state in ('creating','active','completed') limit 1`, [accountId, decision.workflow_id, previous.id, createdAt, now])).length > 0;
    const changes = deriveEvidence({ accountId, verificationId: previous.id, providerStatus: status,
      establishedAt: established, observedAt: now, proofs: freshProofs, matches: freshRenewal ? proof.matches : [], recovery }, {
      evidence: existing, hasFaceHistory: workflow.kind === "renewal" || account.hasFaceHistory || existing.some(row => row.kind === "face") || history.some(row => row.livenessAt !== null),
      sessionIds: new Map(history.map(row => [row.id, row.diditSessionId])),
    });
    await this.writeChanges(tx, changes, now);
    // An approved provider correction (for example a lower age estimate) changes the fact,
    // never its original validity or local activation. JSONB equality ignores object key order.
    let corrected = 0;
    if (status === "approved") for (const proof of freshProofs) {
      corrected += (await tx.query(`update evidence set value=$3::jsonb,updated_at=$4 where verification_id=$1 and kind=$2
        and coalesce(value,'null'::jsonb) is distinct from $3::jsonb returning id`, [previous.id, proof.kind, JSON.stringify(proof.value), now])).length;
    }
    const evidence = await rows<Evidence>(tx, "select * from evidence where verification_id=$1", [previous.id]);
    const pending = evidence.some(row => row.activation === "pending_continuity" && row.providerStatus === "approved");
    const evidenceExpiresAt = evidence.reduce<Date | null>((latest, row) => !latest || row.validUntil > latest ? row.validUntil : latest, previous.evidenceExpiresAt);
    const retentionAnchor = evidenceExpiresAt ?? previous.decidedAt ?? now;
    const retainedDecision = retentionAnchor.getTime() + 30 * 86400_000 > now.getTime() ? JSON.stringify(decision) : null;
    const policyReason = proof.reason ?? (pending ? freshRenewal ? "face continuity requires review" : "renewal operation expired or missing" : null);
    const expired = decision.status === "Approved" && !policyReason && !evidence.some(row => row.kind === "face" && row.validUntil > now);
    const localStatus = policyReason && decision.status === "Approved" ? "in_review" : expired ? "expired" : providerState(decision.status);
    const poll = !terminal(decision.status) || !!policyReason || evidence.some(row => !row.invalidatedAt);
    const nextFetchAt = poll ? new Date(now.getTime() + (terminal(decision.status) && !policyReason ? 86400_000 : now.getTime() - createdAt.getTime() < 3600_000 ? 300_000 : 3600_000)) : null;
    const [verification] = await rows<Verification>(tx, `update verifications set status=$2,provider_status=$3,policy_state=$4,policy_reason=$5,
      q_first_name=$6,q_last_name=$7,verified_email=$8,email_matches=$9,liveness_at=$10,age_estimate=$11,
      decision=$12::jsonb,fetched_at=$13,next_fetch_at=$14,decided_at=coalesce(decided_at,$15),first_approved_at=coalesce(first_approved_at,$16),evidence_expires_at=$17,
      reconcile_state='ready',fetch_attempts=0,last_error=null
      where id=$1 returning *`, [previous.id, localStatus, decision.status, policyReason ? "in_review" : null, policyReason,
      proof.firstName, proof.lastName, proof.verifiedEmail, proof.emailMatches, evidence.find(row => row.kind === "face")?.establishedAt ?? previous.livenessAt, proof.age,
      retainedDecision, now, nextFetchAt, terminal(decision.status) ? now : null, established && established <= now ? established : null, evidenceExpiresAt]);
    if (evidence.some(row => row.kind === "face")) await tx.query("update accounts set has_face_history=true where id=$1 and not has_face_history", [accountId]);
    await tx.query(`update verification_ops set state=case when kind='renewal' and expires_at<=clock_timestamp() then 'expired' else 'completed' end
      where verification_id=$1 and state in ('creating','active') and $2::boolean`, [previous.id, terminal(decision.status)]);
    const changed = corrected > 0 || changes.insert.length > 0 || changes.update.length > 0 || previous.status !== localStatus || previous.policyReason !== policyReason || previous.providerStatus !== decision.status;
    if (changed) await this.notify(tx, accountId);
    return { verification: verification!, evidence, changed };
  }

  private async writeChanges(tx: Tx, changes: EvidenceChanges, now: Date) {
    // Pure derivation orders supersessions first, including when an existing pending face activates.
    for (const row of changes.update) await tx.query(`update evidence set provider_status=$2,activation=$3,state=$4,
      invalidated_at=$5,invalidated_reason=$6,reason=$6,superseded_at=$7,continuity_of=$8,recovered_by=$9,recovery_reason=$10,updated_at=$11 where id=$1`,
    [row.id, row.providerStatus, row.activation, row.state, row.invalidatedAt, row.invalidatedReason, row.supersededAt, row.continuityOf, row.recoveredBy, row.recoveryReason, now]);
    for (const row of changes.insert) await tx.query(`insert into evidence(account_id,verification_id,kind,value,established_at,valid_until,provider_status,activation,state,
      invalidated_at,invalidated_reason,reason,superseded_at,continuity_of,recovered_by,recovery_reason)
      values($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,$15)`,
    [row.accountId, row.verificationId, row.kind, JSON.stringify(row.value), row.establishedAt, row.validUntil, row.providerStatus, row.activation, row.state,
      row.invalidatedAt, row.invalidatedReason, row.supersededAt, row.continuityOf, row.recoveredBy, row.recoveryReason]);
    const audit = changes.recoveryAudit;
    if (audit) await tx.query("insert into audit(actor,action,target,data) values($1,$2,$3,$4::jsonb)", [audit.actor, audit.action, audit.target, JSON.stringify({ reason: audit.reason })]);
  }

  private async notify(tx: Tx, accountId: string) {
    for (const row of await tx.query<{ event_id: string }>("select distinct event_id from registrations where account_id=$1", [accountId])) {
      await notifyInTx(tx, `event_${row.event_id}`, { type: "verification.updated", event_id: row.event_id });
    }
  }

  async invalidate(tx: Tx, verificationId: string, reason: string) {
    if (!reason.trim()) throw new Error("InvalidationReasonRequired");
    const [hint] = await tx.query<{ account_id: string }>("select account_id from verifications where id=$1", [verificationId]);
    if (!hint) throw new VerificationIgnored();
    await lockForDecision(tx, hint.account_id);
    await tx.query(`update evidence set activation='revoked',state='invalidated',invalidated_at=coalesce(invalidated_at,clock_timestamp()),
      invalidated_reason=$2,reason=$2,updated_at=clock_timestamp() where verification_id=$1 and activation<>'revoked'`, [verificationId, reason.trim()]);
    await this.notify(tx, hint.account_id);
  }

  async activateRenewal(accountId: string, verificationId: string): Promise<"active" | "pending_continuity"> {
    return withTx(async tx => {
      await lockForDecision(tx, accountId);
      const [verification] = await rows<Verification>(tx, "select * from verifications where id=$1 and account_id=$2", [verificationId, accountId]);
      if (!verification) throw new VerificationIgnored();
      const result = await this.apply(tx, accountId, verification.diditSessionId);
      return result.evidence.some(row => row.kind === "face" && row.activation === "active" && row.providerStatus === "approved") ? "active" : "pending_continuity";
    }, this.options.db);
  }

  async acceptVerifiedEmail(actor: StaffPrincipal, registrationId: string, verificationId: string, verifiedEmail: string): Promise<boolean> {
    if (!uuidPattern.test(registrationId) || !uuidPattern.test(verificationId)) return false;
    if (actor.principal !== "staff" || (!actor.apiTokenId && !uuidPattern.test(actor.sessionId))) throw new Error("StaffAuthenticationRequired");
    try {
      return await withTx(async tx => {
        const [hint] = await tx.query<{ account_id: string }>("select account_id from verifications where id=$1", [verificationId]);
        if (!hint) return false;
        await lockForDecision(tx, hint.account_id);
        const [registration] = await tx.query<{ event_id: string }>("select event_id from registrations where id=$1 and account_id=$2", [registrationId, hint.account_id]);
        if (!registration) return false;
        await requireEventActor(tx,actor,registration.event_id,"guests.verification",true);
        const [verification] = await rows<Verification>(tx, "select * from verifications where account_id=$1 order by created_at desc,id desc limit 1", [hint.account_id]);
        if (!registration || !verification || verification.id !== verificationId || verification.emailMatches !== false || verification.verifiedEmail !== verifiedEmail) return false;
        const alreadyAccepted = verification.acceptedEmail === verifiedEmail;
        if (!alreadyAccepted) await tx.query("update verifications set accepted_email=$2,email_accepted_by=$3,email_accepted_at=clock_timestamp() where id=$1", [verificationId, verifiedEmail, actor.email]);
        await this.apply(tx, hint.account_id, verification.diditSessionId, undefined, verifiedEmail);
        if (!alreadyAccepted) {
          await tx.query("insert into audit(event_id,actor,action,target,data) values($1,$2,'verification.email_accepted',$3,$4::jsonb)",
            [registration.event_id, actor.email, verificationId, JSON.stringify({ registrationId, verifiedEmail, reason: "Verified email mismatch accepted by staff" })]);
          await this.notify(tx, hint.account_id);
        }
        return true;
      }, this.options.db);
    } catch (error) {
      if (error instanceof VerificationIgnored) return false;
      if (error instanceof AdmissionError && error.code === "Forbidden") throw new Error("StaffAuthenticationRequired");
      throw error;
    }
  }

  /** Admin API seam: B2 resolves the signed cookie; policy facts are re-read under the account lock. */
  async recover(sessionCookie: string, verificationId: string, reason: string) {
    const session = await this.options.sessions.resolve(sessionCookie);
    if (!session || !reason.trim()) throw new Error("FreshAdminAuthenticationRequired");
    return withTx(async tx => {
      const [hint] = await rows<Verification>(tx, "select * from verifications where id=$1", [verificationId]);
      if (!hint) throw new VerificationIgnored();
      await lockForDecision(tx, hint.accountId);
      const member = await staffForSession(tx, session.id);
      if (!member) throw new Error("FreshAdminAuthenticationRequired");
      // Explicit staff -> session order matches B2 disablement. SHARE fences revoke/disable through commit.
      const [actor] = await tx.query<{ email: string; role: "owner" | "admin" }>(`select email,role from staff where email=$1
        and disabled_at is null and role in ('owner','admin') and ${staffEmailSql("email")} for share`, [member.email]);
      const [fresh] = await tx.query<{ authenticated_at: Date }>(`select authenticated_at from sessions s where s.id=$1 and ((principal='staff' and staff_email=$2) or (principal='guest' and account_id in (select id from accounts where email=$2 and deleting_at is null and deleted_at is null))) and auth_method in ('oidc_google','email_otp')
        and (${sessionLiveSql()})
        and authenticated_at>clock_timestamp()-interval '15 minutes' and authenticated_at<=clock_timestamp() for share`, [session.id, member.email]);
      if (!actor || !fresh) throw new Error("FreshAdminAuthenticationRequired");
      return this.apply(tx, hint.accountId, hint.diditSessionId, { staff: actor.email, role: actor.role, authenticatedAt: fresh.authenticated_at, reason });
    }, this.options.db);
  }
}
