import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { acceptedEvent } from "../admission/policies.ts";
import { eventBy,registrationBy,requireActor } from "../admission/shared.ts";
import type { VerificationLaunch } from "../contracts/event-model.ts";
import type { Db } from "../db/index.ts";
import { lockAccount,queryable,withTx,type Tx } from "../db/tx.ts";
import type { DiditClient } from "../didit/client.ts";
import { decisionSchema,establishedAt,type DiditDecision } from "../didit/types.ts";
import { consentSchema,documentFactSchema,phoneFactSchema,renewalInputSchema,type ConsentInput } from "../domain/event-model.ts";
import { deriveEvidence,type EvidenceRecovery } from "../domain/evidence.ts";
import { missingChecks } from "../domain/missing-checks.ts";
import { ModelError } from "../domain/model-error.ts";
import type { DomainEvent,Evidence,GuestPrincipal,StaffPrincipal,Verification } from "../domain/services.ts";
import { planWorkflow,type WorkflowPlan } from "../domain/workflow-plan.ts";
import { accountFacts,baselinePolicy,completeOnboardingInTx,Onboarding } from "../identity/onboarding.ts";
import { assertGuest } from "../identity/shared.ts";
import { withJobLock } from "../jobs.ts";
import { notifyInTx } from "../notify.ts";
import { enqueue } from "../outbox.ts";
import { reserve,settle } from "../spend.ts";
import { providerState,terminal } from "./proofs.ts";
import { adoptSessionInTx,decisionBelongsToOperation,resolveVerificationAccount,type VerificationOperation } from "./session-binding.ts";
import { dbNow,isTombstoned,liveAccount,rows,VerificationIgnored } from "./shared.ts";
import { WorkflowRegistry,type RegistryRow } from "./workflow-registry.ts";

export interface ModelVerificationOptions { db: Db; client: DiditClient; appUrl: string; appDailyCapUsd?: number; eventDailyCapUsd?: number; totalCapUsd?: number }
const hosted = (url: unknown) => {
  try { const u = new URL(String(url)); return u.protocol === "https:" && u.hostname === "verify.didit.me" && !u.username && !u.password && !u.port ? u.href : null; } catch { return null; }
};
export class ModelVerification {
  readonly registry: WorkflowRegistry;
  constructor(readonly options: ModelVerificationOptions) { this.registry = new WorkflowRegistry(options.client,options.db); }
  async launch(opId: string): Promise<VerificationLaunch> {
    const locked = await withJobLock(`verification-create:${opId}`, async (): Promise<VerificationLaunch> => {
      const q = queryable(this.options.db);
      const [op] = await rows<VerificationOperation>(q,"select * from verification_ops where id=$1",[opId]);
      if (!op || op.purpose === "legacy") throw new ModelError("not_found");
      await liveAccount(q,op.accountId);
      const resumable = op.expiresAt > await dbNow(q) && ["creating","active","completed"].includes(op.state);
      if (op.diditSessionId && op.verificationId) {
        const [v] = await rows<Verification>(q,"select * from verifications where id=$1 and account_id=$2",[op.verificationId,op.accountId]);
        const url = hosted(v?.hostedUrl);
        if (v && terminal(v.providerStatus ?? "")) return {state:"not_needed"};
        if (resumable && url) return {state:"ready",opId:op.id,url,expiresAt:op.expiresAt.toISOString()};
      }
      if (!resumable) return {state:"blocked",code:"review_required"};
      let [workflow] = await rows<RegistryRow>(q,"select * from didit_workflows where key=$1",[op.workflowKey]);
      if (!workflow) return {state:"blocked",code:"provider_unavailable"};
      if (workflow.state !== "ready") {
        if (op.purpose === "event_checks") return {state:"blocked",code:"provider_unavailable"};
        try { workflow = await this.registry.ensure("face"); } catch { return {state:"blocked",code:"provider_unavailable"}; }
      }
      const candidates: DiditDecision[] = [];
      let conflictingUnfinished = false, listingComplete = false;
      for (let offset=0;offset<10_000;) {
        const page = await this.options.client.listSessions({workflow_id:op.workflowId,vendor_data:op.vendorData,limit:100,offset});
        for (const candidate of page.results) {
          if (await isTombstoned(q,candidate.session_id)) continue;
          const decision = await this.options.client.getDecision(candidate.session_id);
          if (decisionBelongsToOperation(op,decision,workflow.configHash) && !await resolveVerificationAccount(q,candidate.session_id)) candidates.push(decision);
          else if (["Not Started", "In Progress", "Awaiting User"].includes(decision.status)) conflictingUnfinished = true;
        }
        if (!page.next) { listingComplete=true; break; } if (!page.results.length) return {state:"blocked",code:"review_required"}; offset+=page.results.length;
      }
      if (!listingComplete) return {state:"blocked",code:"review_required"};
      const unique = [...new Map(candidates.map(d=>[d.session_id,d])).values()];
      if (unique.length>1) return {state:"blocked",code:"review_required"};
      let decision = unique[0], url = decision ? hosted(decision.url ?? decision.session_url) : null;
      if (!decision) {
        if (conflictingUnfinished) return {state:"blocked",code:"review_required"};
        // Ambiguous dispatch is never retried blindly; listing must adopt the existing metadata match.
        if (op.attempts>0) return {state:"blocked",code:"review_required"};
        const reservation = await reserve({op:op.purpose === "event_checks" ? "session_extras" : "session_renewal",usdMax:workflow.maxPriceMicros!/1e6,
          scopes:[{kind:"app/day",id:"events",usdCap:this.options.appDailyCapUsd ?? 300},{kind:"total",id:"events",usdCap:this.options.totalCapUsd ?? 300},
            ...(op.originEventId ? [{kind:"event/day" as const,id:op.originEventId,usdCap:this.options.eventDailyCapUsd ?? 100}] : [])]},this.options.db);
        try {
          await withTx(async tx=>{
            await lockAccount(tx,op.accountId); await liveAccount(tx,op.accountId);
            const [current] = await tx.query("select id from verification_ops where id=$1 and state='creating' and expires_at>clock_timestamp() and attempts=0",[op.id]);
            if (!current) throw new ModelError("review_required");
            if (op.originEventId && !(await tx.query("select id from events where id=$1 and status in ('published','live') and ends_at>clock_timestamp() and ($2::uuid is null or (status='published' and starts_at>clock_timestamp() and (form->>'closes_at' is null or (form->>'closes_at')::timestamptz>clock_timestamp()))) for share",[op.originEventId,op.originDraftId])).length) throw new ModelError("closed");
            await tx.query("update verification_ops set attempts=attempts+1 where id=$1",[op.id]);
          },this.options.db);
          this.options.client.registerVerifiedWorkflow(op.workflowId,workflow.maxPriceMicros!/1e6,op.purpose === "event_checks" ? "extras" : "renewal");
          const made = await this.options.client.createSession({workflow_id:op.workflowId,vendor_data:op.vendorData,
            metadata:{events_op_id:op.id,events_account_id:op.accountId,events_config_hash:workflow.configHash},
            callback:new URL("/onboarding",this.options.appUrl).href,callback_method:"both",contact_details:{send_notification_emails:false}},reservation);
          decision = await this.options.client.getDecision(made.session_id); url=hosted(made.url);
          if (!decisionBelongsToOperation(op,decision,workflow.configHash)) return {state:"blocked",code:"review_required"};
        } finally {
          const [spent] = await q.query<{dispatched_at:Date|null}>("select dispatched_at from spend where id=$1",[reservation.id]);
          await settle(reservation.id,spent?.dispatched_at ? "uncertain" : 0,this.options.db);
        }
      }
      if (!decision) return {state:"creating",opId:op.id,retryAfterMs:5000};
      const finalDecision = decision;
      await withTx(async tx=>{
        await lockAccount(tx,op.accountId); await liveAccount(tx,op.accountId,finalDecision.session_id);
        const claimed = await resolveVerificationAccount(tx,finalDecision.session_id);
        if (claimed && claimed.opId !== op.id) throw new ModelError("review_required");
        await tx.query(`insert into verifications(account_id,didit_session_id,workflow_id,vendor_data,status,provider_status,hosted_url,created_at,next_fetch_at)
          values($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()) on conflict(didit_session_id) do nothing`,
        [op.accountId,finalDecision.session_id,op.workflowId,op.vendorData,providerState(finalDecision.status),finalDecision.status,url,new Date(finalDecision.created_at)]);
        const [v] = await tx.query<{id:string;account_id:string}>("select id,account_id from verifications where didit_session_id=$1",[finalDecision.session_id]);
        if (v?.account_id !== op.accountId) throw new VerificationIgnored();
        await tx.query("update verification_ops set didit_session_id=$2,verification_id=$3,state='active' where id=$1",[op.id,finalDecision.session_id,v.id]);
        await enqueue(tx,{kind:"verification.refresh",dedupeKey:`verification.refresh:${op.id}`,payload:{accountId:op.accountId,sessionId:finalDecision.session_id}});
      },this.options.db);
      return url ? {state:"ready",opId:op.id,url,expiresAt:op.expiresAt.toISOString()} : {state:"creating",opId:op.id,retryAfterMs:5000};
    },this.options.db);
    return locked.acquired ? locked.value : {state:"creating",opId,retryAfterMs:1000};
  }
  async adoptDiscoveredSession(opId:string,sessionId:string):Promise<boolean> {
    const decision=await this.options.client.getDecision(sessionId);
    return withTx(tx=>adoptSessionInTx(tx,opId,decision,this.options.client),this.options.db);
  }
  async startRegistrationRenewal(principal:GuestPrincipal,id:string,raw:z.input<typeof renewalInputSchema>):Promise<VerificationLaunch> {
    const input=renewalInputSchema.parse(raw);
    const prepare=async(tx:Tx)=>{
      await lockAccount(tx,principal.accountId); await assertGuest(tx,principal);
      const r=await registrationBy(tx,id); if(r.accountId!==principal.accountId)throw new ModelError("not_found");
      const e=await eventBy(tx,r.eventId);if(!e || !["pending","waitlisted","approved"].includes(r.admission))throw new ModelError("closed");
      await tx.query("select id from events where id=$1 for share",[e.id]);
      const now=await dbNow(tx);if(!["published","live"].includes(e.status)||e.endsAt<=now)throw new ModelError("closed");
      const event=await acceptedEvent(tx,r,e),account=await accountFacts(tx,principal.accountId),missing=missingChecks(account,event,now);
      const old=r.requestReceipt?.consent;
      const consent=input.consent ?? (old ? consentSchema.parse({disclosureVersion:old.disclosureVersion,shareProfileWithHosts:old.shareProfileWithHosts,eventConsentAccepted:old.eventConsentAccepted,acceptedChecks:old.acceptedChecks}):null);
      return {r,event,account,now,missing,consent};
    };
    const first=await withTx(prepare,this.options.db);
    if(first.missing.canSubmit)return {state:"not_needed"};
    if(!first.missing.baseline.email || !first.missing.baseline.profile)throw new ModelError("onboarding_required");
    if(!first.consent || first.missing.missing.some(m=>!first.consent!.acceptedChecks.includes(m.check)) || input.strategy==="id_alternative" && (!input.consent || !input.consent.acceptedChecks.includes("id_document")))return {state:"blocked",code:"consent_required"};
    if(!first.missing.baseline.face)return new Onboarding({db:this.options.db,launch:id=>this.launch(id)}).ensureFaceSession(principal,{purpose:"face_renewal",consent:first.consent});
    const plan=planWorkflow(first.missing.missing,{baselineReady:true,ageMinimum:first.event.checks.age_min,idFallbackConsented:input.strategy==="id_alternative"});
    if(plan.kind!=="extras")return {state:"blocked",code:"review_required"};
    const registry=await this.registry.ensure(plan);
    const opId=await withTx(async tx=>{
      const current=await prepare(tx);
      const fresh=planWorkflow(current.missing.missing,{baselineReady:current.missing.baseline.face,ageMinimum:current.event.checks.age_min,idFallbackConsented:input.strategy==="id_alternative"});
      if(fresh.kind!=="extras" || fresh.configHash!==registry.configHash)throw new ModelError("context_changed");
      return createExtraOperation(tx,current.account,current.event.id,current.event.policyVersion,null,fresh,registry,first.consent!,current.now);
    },this.options.db);
    return this.launch(opId);
  }
  async recoverFace(actor:StaffPrincipal,verificationId:string,reason:string) {
    const q=queryable(this.options.db),[v]=await rows<Verification>(q,"select * from verifications where id=$1",[verificationId]);
    if(!v)throw new ModelError("not_found");
    return withTx(async tx=>{
      await lockAccount(tx,v.accountId);await requireActor(tx,actor,["owner","admin"],true);
      // A live, role-checked token is the API authentication authority; browser sessions still need recent sign-in.
      const [session]=actor.apiTokenId ? [{authenticated_at:await dbNow(tx)}] : await tx.query<{authenticated_at:Date}>("select authenticated_at from sessions where id=$1",[actor.sessionId]);
      const now=await dbNow(tx);
      if(!session || now.getTime()-session.authenticated_at.getTime()>=900_000 || !reason.trim() || reason.length>500)throw new ModelError("forbidden");
      return applyModelDecision(tx,v.accountId,v.diditSessionId,this.options.client,{staff:actor.email,role:actor.role,authenticatedAt:session.authenticated_at,reason});
    },this.options.db);
  }
  async attestEvidenceBinding(actor:StaffPrincipal,verificationId:string,subjectFaceId:string,reason:string) {
    const [v]=await rows<Verification>(queryable(this.options.db),"select * from verifications where id=$1",[verificationId]);
    if(!v)throw new ModelError("not_found");
    return withTx(async tx=>{
      await lockAccount(tx,v.accountId);await requireActor(tx,actor,["owner","admin"],true);
      // requireActor holds the token and staff rows through this evidence mutation.
      const now=await dbNow(tx),[s]=actor.apiTokenId ? [{authenticated_at:now}] : await tx.query<{authenticated_at:Date}>("select authenticated_at from sessions where id=$1",[actor.sessionId]);
      if(!s || now.getTime()-s.authenticated_at.getTime()>=900_000 || !reason.trim() || reason.length>500)throw new ModelError("forbidden");
      const facts=await accountFacts(tx,v.accountId),face=facts.evidence.find(e=>e.id===subjectFaceId && e.kind==="face" && e.providerStatus==="approved" && e.activation==="active" && !e.invalidatedAt);
      const [op]=await rows<VerificationOperation>(tx,"select * from verification_ops where verification_id=$1",[v.id]);
      if(!face || op?.subjectFaceId!==subjectFaceId)throw new ModelError("invalid");
      const result=await applyModelDecision(tx,v.accountId,v.diditSessionId,this.options.client);
      await tx.query("update evidence set activation='active',state='active',recovered_by=$3,recovery_reason=$4 where verification_id=$1 and subject_face_id=$2 and activation='pending_continuity' and provider_status='approved' and invalidated_at is null and valid_until>$5",[v.id,subjectFaceId,actor.email,reason,now]);
      await tx.query("insert into audit(actor,action,target,data) values($1,'evidence.binding_attested',$2,$3::jsonb)",[actor.email,v.id,JSON.stringify({subjectFaceId,reason})]);
      return {...result,evidence:await rows<Evidence>(tx,"select * from evidence where verification_id=$1",[v.id]),changed:true};
    },this.options.db);
  }
  async startRequestChecks(principal: GuestPrincipal,eventId:string,draftId:string,input:{expectedPolicyVersion:number;consent:ConsentInput;idFallbackConsented?:boolean}):Promise<VerificationLaunch> {
    const consent=consentSchema.parse(input.consent);
    // Prepare the plan under account/event locks, provision without holding locks, then recheck before writing intent.
    const prepare=async(tx:Tx)=>{
      await lockAccount(tx,principal.accountId); await assertGuest(tx,principal);
      const [e]=await tx.query("select * from events where id=$1 for share",[eventId]);
      const [d]=await tx.query("select * from registration_drafts where id=$1 and account_id=$2 and event_id=$3 and expires_at>clock_timestamp()",[draftId,principal.accountId,eventId]);
      if (!e || !d) throw new ModelError("not_found");
      if (e.policy_version!==input.expectedPolicyVersion || d.policy_version!==e.policy_version) throw new ModelError("context_changed");
      const account=await accountFacts(tx,principal.accountId),now=await dbNow(tx);
      if (!missingChecks(account,baselinePolicy,now).canSubmit) throw new ModelError("onboarding_required");
      const event=(await rows<DomainEvent>(tx,"select * from events where id=$1",[eventId]))[0]!;
      if (event.status !== "published" || event.startsAt <= now || event.form.closes_at && new Date(event.form.closes_at) <= now) throw new ModelError("closed");
      const missing=missingChecks(account,event,now);
      if (missing.missing.some(m=>!consent.acceptedChecks.includes(m.check)) || input.idFallbackConsented && !consent.acceptedChecks.includes("id_document")) throw new ModelError("invalid","Consent required");
      return {account,event,now,plan:planWorkflow(missing.missing,{baselineReady:true,ageMinimum:event.checks.age_min,idFallbackConsented:!!input.idFallbackConsented})};
    };
    const prepared=await withTx(prepare,this.options.db);
    if (prepared.plan.kind === "none") return {state:"not_needed"};
    if (prepared.plan.kind !== "extras") return {state:"blocked",code:"review_required"};
    const registry=await this.registry.ensure(prepared.plan);
    const opId=await withTx(async tx=>{
      const {account,event,now,plan}=await prepare(tx);
      if (plan.kind !== "extras" || plan.configHash!==registry.configHash) throw new ModelError("context_changed");
      return createExtraOperation(tx,account,event.id,event.policyVersion,draftId,plan,registry,consent,now);
    },this.options.db);
    return this.launch(opId);
  }
}

async function createExtraOperation(tx:Tx,account:Awaited<ReturnType<typeof accountFacts>>,eventId:string,policyVersion:number,draftId:string|null,
  plan:Extract<WorkflowPlan,{kind:"extras"}>,registry:RegistryRow,consent:ConsentInput,now:Date) {
  await tx.query("update verification_ops set state='expired' where account_id=$1 and state in ('creating','active') and expires_at<=$2",[account.id,now]);
  const [op]=await rows<VerificationOperation>(tx,"select * from verification_ops where account_id=$1 and workflow_id=$2 and state in ('creating','active')",[account.id,registry.workflowId]);
  const id=randomUUID(),face=account.evidence.find(e=>e.kind==="face" && e.activation==="active" && e.providerStatus==="approved");
  if(op){ if(op.purpose!=="event_checks" || op.workflowKey!==registry.key || plan.checks.some(c=>!op.expectedChecks.includes(c)) || plan.needsFaceBinding && op.subjectFaceId !== face?.id) throw new ModelError("review_required"); return op.id; }
  await tx.query(`insert into verification_ops(id,account_id,workflow_id,workflow_key,kind,purpose,vendor_data,email_at_creation,expected_checks,origin_event_id,origin_policy_version,origin_draft_id,subject_face_id,consent,expires_at)
    values($1,$2,$3,$4,'extras','event_checks',$5,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
  [id,account.id,registry.workflowId,registry.key,account.email,plan.checks,eventId,policyVersion,draftId,plan.needsFaceBinding?face?.id:null,JSON.stringify({...consent,acceptedAt:now.toISOString()}),new Date(now.getTime()+86400_000)]);
  await enqueue(tx,{kind:"verification.create",dedupeKey:`verification.create:${id}`,payload:{opId:id}});return id;
}

export async function applyModelDecision(tx:Tx,accountId:string,sessionId:string,client:Pick<DiditClient,"getDecision">,recovery?:EvidenceRecovery) {
  await lockAccount(tx,accountId);const account=await liveAccount(tx,accountId,sessionId),now=await dbNow(tx);
  const mapping=await resolveVerificationAccount(tx,sessionId);
  if(mapping?.accountId!==accountId || !mapping.opId) throw new VerificationIgnored();
  const [op]=await rows<VerificationOperation>(tx,"select * from verification_ops where id=$1",[mapping.opId]);
  const [registry]=await rows<RegistryRow>(tx,"select * from didit_workflows where key=$1 and state='ready'",[op?.workflowKey]);
  if(!op || !registry) throw new VerificationIgnored();
  const decision=decisionSchema.parse(await client.getDecision(sessionId));
  if(decision.session_id !== sessionId || !decisionBelongsToOperation(op,decision,registry.configHash)) throw new VerificationIgnored();
  const [verification]=await rows<Verification>(tx,"select * from verifications where id=$1",[mapping.verificationId]);
  if(!verification) throw new VerificationIgnored();
  const existing=await rows<Evidence>(tx,"select * from evidence where account_id=$1",[accountId]);
  const own=existing.filter(e=>e.verificationId===verification.id),at=verification.firstApprovedAt ?? establishedAt(decision);
  const approved=decision.status==="Approved" && !!at && at<=now && at>=new Date(decision.created_at) && at>=op.createdAt;
  const live=(decision.liveness_checks ?? []).filter(l=>l.status==="Approved");
  // On time if approved before the operation expired, or a re-delivery of THIS verification whose proof is already established (`own` = evidence from this verification only).
  const timely=(!!at && at<=op.expiresAt) || own.some(e=>e.activation!=="pending_continuity");
  let changed=false,review=false;
  if(op.purpose!=="event_checks") {
    const proofs=approved && live.length && timely ? [{kind:"face" as const,value:null}] : [];
    const history=await rows<Verification>(tx,"select * from verifications where account_id=$1",[accountId]);
    const change=deriveEvidence({accountId,verificationId:verification.id,providerStatus:approved && proofs.length ? "approved" : decision.status==="Approved" ? "in_review" : own.length ? "withdrawn" : "in_review",
      establishedAt:at,observedAt:now,proofs,matches:live.flatMap(l=>l.matches),recovery},
    {evidence:existing,hasFaceHistory:account.hasFaceHistory || existing.some(e=>e.kind==="face"),sessionIds:new Map(history.map(v=>[v.id,v.diditSessionId]))});
    for(const e of change.update) await tx.query(`update evidence set provider_status=$2,activation=$3,state=$4,invalidated_at=$5,invalidated_reason=$6,superseded_at=$7,continuity_of=$8,recovered_by=$9,recovery_reason=$10 where id=$1`,
      [e.id,e.providerStatus,e.activation,e.state,e.invalidatedAt,e.invalidatedReason,e.supersededAt,e.continuityOf,e.recoveredBy,e.recoveryReason]);
    for(const e of change.insert) await tx.query(`insert into evidence(account_id,verification_id,kind,value,source,binding,established_at,valid_until,provider_status,activation,state,continuity_of,recovered_by,recovery_reason)
      values($1,$2,'face',null,'liveness','legacy_chain',$3,$4,$5,$6,$7,$8,$9,$10)`,[accountId,verification.id,e.establishedAt,e.validUntil,e.providerStatus,e.activation,e.state,e.continuityOf,e.recoveredBy,e.recoveryReason]);
    changed=!!change.insert.length || !!change.update.length;
    if(change.recoveryAudit) await tx.query("insert into audit(actor,action,target,data) values($1,'evidence_recovered',$2,$3::jsonb)",[change.recoveryAudit.actor,verification.id,JSON.stringify({reason:change.recoveryAudit.reason})]);
    if(proofs.length) await tx.query("update accounts set has_face_history=true where id=$1",[accountId]);
    review=!approved || !proofs.length;
  } else {
    const anchor=existing.find(e=>e.id===op.subjectFaceId && e.kind==="face");
    const [anchorSession]=anchor?await tx.query<{didit_session_id:string}>("select didit_session_id from verifications where id=$1",[anchor.verificationId]):[];
    const matched=!!anchorSession && live.some(l=>l.matches.some(m=>m.session_id===anchorSession.didit_session_id && m.similarity_percentage>=90 && m.similarity_percentage<=100 && !m.is_blocklisted && !m.api_service && (m.status==null || m.status==="Approved")));
    const proofs:{kind:"phone"|"document"|"age";source:"phone"|"document"|"age_estimation";value:Record<string,unknown>|number;bound:boolean;at:Date;until:Date}[]=[];
    if(approved && at && timely) {
      if(op.expectedChecks.includes("phone")) for(const phone of decision.phone_verifications ?? []) {
        const valid=phoneFactSchema.safeParse({e164:phone.full_number});const when=phone.verified_at?new Date(phone.verified_at):null;
        if(phone.status==="Approved" && valid.success && when && when<=now && when>=new Date(decision.created_at) && when>=op.createdAt) {proofs.push({kind:"phone",source:"phone",value:valid.data,bound:true,at:when,until:new Date(when.getTime()+365*86400_000)});break;}
      }
      const document=(decision.id_verifications ?? []).find(d=>d.status==="Approved");
      const doc=documentFactSchema.safeParse({legal_name:document?.full_name,birth_date:document?.date_of_birth ?? null,expires_on:document?.expiration_date ?? null});
      const usesOcr = (registry.desiredConfig as {features?:{feature:string}[]}).features?.some(f=>f.feature==="OCR");
      if(usesOcr && doc.success && live.length && (decision.face_matches ?? []).some(m=>m.status==="Approved")) {
        const until=new Date(Math.min(at.getTime()+365*86400_000,doc.data.expires_on ? Date.parse(`${doc.data.expires_on}T00:00:00Z`)+86400_000 : Infinity));
        if(until>at) proofs.push({kind:"document",source:"document",value:doc.data,bound:matched,at,until});
      } else if(!usesOcr && op.expectedChecks.includes("age")) {
        const age=live.find(l=>typeof l.age_estimation==="number" && Number.isFinite(l.age_estimation) && l.age_estimation>=0)?.age_estimation;
        if(typeof age==="number") proofs.push({kind:"age",source:"age_estimation",value:age,bound:matched,at,until:new Date(at.getTime()+365*86400_000)});
      }
    }
    for(const p of proofs) {
      const prior=own.find(e=>e.kind===p.kind);
      if(prior?.activation==="revoked" || prior?.activation==="superseded") continue;
      const activation=p.bound || prior?.activation==="active" ? "active" : "pending_continuity";
      await tx.query(`insert into evidence(account_id,verification_id,kind,value,source,binding,subject_face_id,established_at,valid_until,provider_status,activation,state)
        values($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,'approved',$10::text,$10::text::evidence_state)
        on conflict(verification_id,kind) do update set value=excluded.value,provider_status='approved',activation=excluded.activation,state=excluded.state,
        invalidated_at=null,invalidated_reason=null where evidence.activation not in ('revoked','superseded')`,
      [accountId,verification.id,p.kind,JSON.stringify(p.value),p.source,p.kind==="phone"?"account":"face_chain",p.kind==="phone"?null:op.subjectFaceId,p.at,p.until,activation]);changed=true;
    }
    for(const prior of own) if(!proofs.some(p=>p.kind===prior.kind)) {
      await tx.query("update evidence set provider_status=$2,invalidated_at=coalesce(invalidated_at,$3),invalidated_reason='provider_withdrawn' where id=$1",[prior.id,decision.status==="Approved"?"in_review":"withdrawn",now]);changed=true;
    }
    review=!proofs.length || proofs.some(p=>!p.bound);
  }
  const evidence=await rows<Evidence>(tx,"select * from evidence where verification_id=$1",[verification.id]);
  review ||= evidence.some(e=>e.activation==="pending_continuity");
  const status=decision.status==="Approved" && review ? "in_review" : providerState(decision.status);
  const [saved]=await rows<Verification>(tx,`update verifications set status=$2,provider_status=$3,policy_state=$4,policy_reason=$5,first_approved_at=coalesce(first_approved_at,$6),
    evidence_expires_at=coalesce((select max(valid_until) from evidence where verification_id=$1),evidence_expires_at),decided_at=coalesce(decided_at,$7),fetched_at=$7,next_fetch_at=$8,decision=$9::jsonb,reconcile_state='ready',fetch_attempts=0,last_error=null where id=$1 returning *`,
  [verification.id,status,decision.status,review?"in_review":null,review?"proof or continuity requires review":null,at,now,new Date(now.getTime()+(review?300_000:86400_000)),JSON.stringify(storedDecision(decision))]);
  if(terminal(decision.status)) await tx.query("update verification_ops set state=$2 where id=$1",[op.id,op.expiresAt<=now?"expired":decision.status==="Approved"?"completed":"failed"]);
  await completeOnboardingInTx(tx,accountId,now);
  await notifyInTx(tx,`account_${accountId}`,{type:"verification.updated",event_id:accountId});
  for(const r of await tx.query<{event_id:string}>("select distinct event_id from registrations where account_id=$1",[accountId])) await notifyInTx(tx,`event_${r.event_id}`,{type:"verification.updated",event_id:r.event_id});
  return {verification:saved!,evidence,changed:changed || verification.status!==status};
}

/** Retain only proof fields used by the evaluator; drop provider media and enrichment immediately. */
function storedDecision(d:DiditDecision) {
 return {session_id:d.session_id,workflow_id:d.workflow_id,vendor_data:d.vendor_data,status:d.status,created_at:d.created_at,
  metadata:d.metadata?{events_op_id:d.metadata.events_op_id,events_account_id:d.metadata.events_account_id,events_config_hash:d.metadata.events_config_hash}:null,
  events:d.events?.map(e=>({event_type:e.event_type,created_at:e.created_at,feature_step:e.feature_step,details:{current_status:e.details?.current_status}})),
  liveness_checks:d.liveness_checks?.map(l=>({status:l.status,node_id:l.node_id,age_estimation:l.age_estimation,matches:l.matches,warnings:[]})),
  phone_verifications:d.phone_verifications?.map(p=>({status:p.status,full_number:p.full_number,verified_at:p.verified_at})),
  id_verifications:d.id_verifications?.map(p=>({status:p.status,full_name:p.full_name,date_of_birth:p.date_of_birth,expiration_date:p.expiration_date})),
  face_matches:d.face_matches?.map(p=>({status:p.status}))};
}
