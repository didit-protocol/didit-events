import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { FacePurpose,OnboardingView,VerificationLaunch } from "../contracts/event-model.ts";
import type { Db } from "../db/index.ts";
import { lockAccount,queryable,withTx,type Queryable,type Tx } from "../db/tx.ts";
import { consentSchema,profilePatchSchema,profileSchema,type ConsentInput,type ConsentReceipt } from "../domain/event-model.ts";
import { missingChecks } from "../domain/missing-checks.ts";
import { ModelError } from "../domain/model-error.ts";
import { displayName,profileDraft,profileNameChanged,splitFullName } from "../domain/profile.ts";
import type { Account,Evidence,GuestPrincipal } from "../domain/services.ts";
import { notifyInTx } from "../notify.ts";
import { enqueue } from "../outbox.ts";
import { dbNow,rows } from "../verification/shared.ts";
import { configuredFaceWorkflowId,ensureFaceRegistryInTx,FACE_KEY } from "../verification/workflow-registry.ts";
import { activeAccount,assertGuest,IdentityError } from "./shared.ts";

export const baselinePolicy = { id: "baseline", policyVersion: 1, formVersion: 1, checks: { version: 1 as const, required: [], max_age: {} } };
export async function accountFacts(q: Queryable, accountId: string) {
  const account = await activeAccount(q, accountId);
  const evidence = await rows<Evidence>(q, "select * from evidence where account_id=$1", [accountId]);
  return { ...account, evidence };
}
export async function completeOnboardingInTx(tx: Tx, accountId: string, now: Date): Promise<boolean> {
  await lockAccount(tx, accountId);
  const account = await accountFacts(tx, accountId);
  if (!missingChecks(account, baselinePolicy, now).canSubmit) return false;
  const changed = await tx.query("update accounts set profile_completed_at=coalesce(profile_completed_at,$2),onboarded_at=$2 where id=$1 and onboarded_at is null returning id", [accountId,now]);
  if (changed.length) await notifyInTx(tx, `account_${accountId}`, { type: "onboarding.complete", event_id: accountId });
  return true;
}
export async function recordEmailProvenInTx(tx: Tx, input: { accountId: string; email: string; method: "didit_otp" | "didit_google";
  proofRef: string; provenAt: Date; consent?: ConsentReceipt }): Promise<{ faceOpId: string | null }> {
  await lockAccount(tx, input.accountId);
  const account = await activeAccount(tx, input.accountId), now = await dbNow(tx);
  if (input.email.trim().toLowerCase() !== account.email || !input.proofRef.trim() || input.proofRef.length > 500 || input.provenAt > now || !Number.isFinite(input.provenAt.getTime())) throw new ModelError("invalid");
  const consent = input.consent === undefined ? undefined : consentSchema.parse({ disclosureVersion: input.consent.disclosureVersion, shareProfileWithHosts: input.consent.shareProfileWithHosts,
    eventConsentAccepted: input.consent.eventConsentAccepted, acceptedChecks: input.consent.acceptedChecks });
  if (consent && !consent.acceptedChecks.includes("face")) throw new ModelError("invalid", "Face consent is required");
  await tx.query("update accounts set email_verified_at=coalesce(email_verified_at,$2),email_proof_method=coalesce(email_proof_method,$3),email_proof_ref=coalesce(email_proof_ref,$4) where id=$1", [account.id,input.provenAt,input.method,input.proofRef]);
  const facts = await accountFacts(tx, account.id);
  if (missingChecks(facts, baselinePolicy, now).baseline.face) { await completeOnboardingInTx(tx, account.id, now); return { faceOpId: null }; }
  if (!consent) return { faceOpId: null };
  return { faceOpId: await ensureFaceOperationInTx(tx, facts, facts.hasFaceHistory ? "face_renewal" : "onboarding", { ...consent, acceptedAt: now.toISOString() }, now) };
}
export async function ensureFaceOperationInTx(tx: Tx, account: Account, purpose: FacePurpose, consent: ConsentReceipt, now: Date): Promise<string> {
  await tx.query("update verification_ops set state='expired' where account_id=$1 and purpose in ('onboarding','face_renewal','re_enrolment') and state in ('creating','active') and expires_at<=$2", [account.id,now]);
  const [active] = await tx.query<{ id: string }>("select id from verification_ops where account_id=$1 and purpose in ('onboarding','face_renewal','re_enrolment') and state in ('creating','active')", [account.id]);
  if (active) return active.id;
  if ((await tx.query("select id from verification_ops where account_id=$1 and workflow_id=$2 and state in ('creating','active')", [account.id,configuredFaceWorkflowId()])).length) throw new ModelError("review_required");
  await ensureFaceRegistryInTx(tx);
  const id = randomUUID();
  await tx.query(`insert into verification_ops(id,account_id,workflow_id,workflow_key,kind,purpose,vendor_data,email_at_creation,expected_checks,consent,expires_at)
    values($1,$2,$3,$4,'renewal',$5,$6,$6,array['face'],$7::jsonb,$8)`, [id,account.id,configuredFaceWorkflowId(),FACE_KEY,purpose,account.email,JSON.stringify(consent),new Date(now.getTime()+86400_000)]);
  await enqueue(tx, { kind: "verification.create", dedupeKey: `verification.create:${id}`, payload: { opId: id } });
  return id;
}
export interface OnboardingOptions { db: Db; launch: (opId: string) => Promise<VerificationLaunch> }
export class Onboarding {
  constructor(readonly options: OnboardingOptions) {}
  recordEmailProvenInTx = recordEmailProvenInTx;
  completeOnboardingInTx = completeOnboardingInTx;
  async afterEmailProven(principal: GuestPrincipal, faceOpId: string | null): Promise<VerificationLaunch> {
    if (!faceOpId) return { state: "not_needed" };
    const [owned] = await queryable(this.options.db).query("select id from verification_ops where id=$1 and account_id=$2", [faceOpId,principal.accountId]);
    if (!owned) throw new ModelError("not_found");
    try { return await this.options.launch(faceOpId); }
    catch { return { state: "creating", opId: faceOpId, retryAfterMs: 5000 }; }
  }
  async getOnboarding(principal: GuestPrincipal, now = new Date()): Promise<OnboardingView> {
    return withTx(async tx => { await assertGuest(tx, principal); return this.viewInTx(tx, principal.accountId, now); }, this.options.db);
  }
  async viewInTx(q: Queryable, accountId: string, now: Date): Promise<OnboardingView> {
    const account = await accountFacts(q, accountId), result = missingChecks(account, baselinePolicy, now);
    const [op] = await q.query<{ id: string; state: NonNullable<OnboardingView["operation"]>["state"]; expires_at: Date; hosted_url: string | null }>(
      `select op.id,op.state,op.expires_at,v.hosted_url from verification_ops op left join verifications v on v.id=op.verification_id
       where op.account_id=$1 and op.purpose in ('onboarding','face_renewal','re_enrolment') order by op.created_at desc,op.id desc limit 1`, [account.id]);
    const face = account.evidence.filter(e => e.kind === "face").sort((a,b) => Number(b.activation === "active")-Number(a.activation === "active") || b.establishedAt.getTime()-a.establishedAt.getTime())[0];
    const reason = result.missing.find(m => m.check === "face")?.reason;
    const step: OnboardingView["step"] = !result.baseline.email ? "email_required" : !result.baseline.profile ? "profile_required" : result.baseline.face ? "complete" :
      ["continuity_required","in_review","revoked"].includes(reason ?? "") ? "face_in_review" : op && op.expires_at > now && op.state === "creating" ? "face_creating" :
      op && op.expires_at > now && op.state === "active" ? "face_in_progress" : reason === "expired" ? "face_expired" : op?.state === "failed" ? "face_failed" : "face_required";
    return { step, onboardedAt: account.onboardedAt?.toISOString() ?? null, email: { address: account.email, verified: result.baseline.email },
      profile: profileDraft(account), profileVersion: account.profileVersion, missingProfileFields: result.baseline.missingProfileFields,
      photoUrl: account.photo ? "/api/me/photo" : null, face: face ? { check: "face", label: "Human / face", state: result.baseline.face ? "verified" : reason === "expired" ? "expired" : reason === "revoked" ? "revoked" : "in_review",
        verifiedAt: face.establishedAt.toISOString(), validUntil: face.validUntil.toISOString(), source: face.source ?? "legacy" } : null,
      operation: op ? { id: op.id, state: op.expires_at <= now && ["active","creating"].includes(op.state) ? "expired" : op.state,
        expiresAt: op.expires_at.toISOString(), canResume: op.state === "active" && op.expires_at > now && !!op.hosted_url } : null,
      returnTo: "/me/events", canRequest: result.canSubmit };
  }
  async saveOnboardingProfile(principal: GuestPrincipal, input: z.infer<typeof profilePatchSchema>): Promise<OnboardingView> {
    const { expectedProfileVersion, ...patch } = profilePatchSchema.parse(input);
    return withTx(async tx => {
      await lockAccount(tx,principal.accountId); const account = await assertGuest(tx,principal), now = await dbNow(tx);
      if (account.profileVersion !== expectedProfileVersion) throw new ModelError("context_changed");
      const merged = { ...profileDraft(account), ...patch }, parsed = profileSchema.safeParse(merged);
      if (account.profileCompletedAt && !parsed.success) throw new ModelError("invalid", "Keep your required profile fields complete");
      const profile = parsed.success ? parsed.data : merged, fullName = displayName(profile.fullName), names = splitFullName(fullName);
      // Compare the effective value we will write, regardless of which adapter/fields supplied it.
      // Both full-name patches and legacy first/last-name edits reach this guard under the account lock.
      if (profileNameChanged(account, fullName)) {
        const [fresh] = await tx.query("select id from sessions where id=$1 and authenticated_at>clock_timestamp()-interval '15 minutes'", [principal.sessionId]);
        if (!fresh) throw new IdentityError("FreshAuthenticationRequired");
      }
      await tx.query(`update accounts set full_name=$2,first_name=$3,last_name=$4,headline=$5,company=$6,job_role=$7,bio=$8,profile_links=$9::jsonb,
        profile_version=profile_version+1,profile_completed_at=case when $10 then coalesce(profile_completed_at,$11) else profile_completed_at end,updated_at=$11 where id=$1`,
      [account.id,fullName,names.firstName,names.lastName,profile.headline,profile.company,profile.jobRole,profile.bio,JSON.stringify(profile.links),parsed.success,now]);
      await completeOnboardingInTx(tx,account.id,now);
      for (const e of await tx.query<{ event_id: string }>("select distinct event_id from registrations where account_id=$1 and admission in ('pending','waitlisted','approved')",[account.id]))
        await notifyInTx(tx,`event_${e.event_id}`,{type:"profile.updated",event_id:e.event_id});
      return this.viewInTx(tx,account.id,now);
    },this.options.db);
  }
  async ensureFaceSession(principal: GuestPrincipal, input: { purpose: FacePurpose; consent: ConsentInput; returnTo?: string }): Promise<VerificationLaunch> {
    const consent = consentSchema.parse(input.consent);
    if (!consent.acceptedChecks.includes("face")) return { state: "blocked", code: "consent_required" };
    const opId = await withTx(async tx => {
      await lockAccount(tx,principal.accountId); const account = await assertGuest(tx,principal), now = await dbNow(tx);
      if (!account.emailVerifiedAt) throw new ModelError("onboarding_required");
      if (input.purpose === "re_enrolment" && (now.getTime()-principal.authenticatedAt.getTime() >= 900_000 || principal.authenticatedAt > now)) throw new ModelError("unauthenticated");
      const facts = await accountFacts(tx,account.id);
      if (input.purpose !== "re_enrolment" && missingChecks(facts,baselinePolicy,now).baseline.face) return null;
      const purpose = account.hasFaceHistory ? input.purpose === "onboarding" ? "face_renewal" : input.purpose : "onboarding";
      const id = await ensureFaceOperationInTx(tx,account,purpose,{...consent,acceptedAt:now.toISOString()},now);
      if (purpose === "re_enrolment") await tx.query("insert into audit(actor,action,target) values($1,'onboarding.re_enrolment',$2)",[account.id,id]);
      return id;
    },this.options.db);
    return this.afterEmailProven(principal,opId);
  }
}
