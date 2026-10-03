import { z } from "zod";
import type { GuestRegistrationView,RequestContext,SubmitResult,VerificationBadge } from "../contracts/event-model.ts";
import { getDb,type Db } from "../db/index.ts";
import { lockForSeatGrant,queryable,withTx,type Queryable } from "../db/tx.ts";
import { draftWriteSchema,eventConsentText,submitRequestSchema,validateApplication,type Application,type ProofCheck,type RequestReceipt } from "../domain/event-model.ts";
import { missingChecks,requiredChecks,type MissingResult } from "../domain/missing-checks.ts";
import { ModelError } from "../domain/model-error.ts";
import type { DomainEvent,GuestPrincipal,Invite,Registration } from "../domain/services.ts";
import type { Admission } from "../domain/transitions.ts";
import { configHash } from "../domain/workflow-plan.ts";
import { accountFacts,completeOnboardingInTx,Onboarding } from "../identity/onboarding.ts";
import { assertGuest,hash } from "../identity/shared.ts";
import { notifyHostsOfRequest } from "../notifications/host-requests.ts";
import { dbNow } from "../verification/shared.ts";
import { Admissions } from "./admission.ts";
import { acceptedEvent,registrationChecks } from "./policies.ts";
import { availabilityOf,reapplicable,rejoin,type Rejoin } from "./rejoin.ts";
import { audit,eventBy,mail,one,registrationBy,signal,staffAdmitting } from "./shared.ts";

/** Public requests close at the start (or the form's close time). An invitation stays usable until the event ends, so staff can invite walk-ins at the door. */
export function requestOpen(event: DomainEvent, now: Date, invited: boolean): boolean {
  if (invited) return staffAdmitting(event, now);
  return event.status === "published" && now < event.startsAt && (!event.form.closes_at || now < new Date(event.form.closes_at));
}

export function verificationBadges(result: MissingResult, emailAt: Date | null | undefined): VerificationBadge[] {
  const labels: Record<ProofCheck, string> = { face: "Human / face", phone: "Phone verified", id_document: "ID document", name_from_id: "Name from ID", age: "Age" };
  return [{ check: "email", label: "Email", state: result.baseline.email ? "verified" : "missing", verifiedAt: emailAt?.toISOString() ?? null, validUntil: null, source: "sign_in" },
    ...([...new Set<ProofCheck>([...Object.keys(result.satisfied) as ProofCheck[],...result.missing.map(m=>m.check)])]).map(check => {
      const proof=result.satisfied[check],missing=result.missing.find(m=>m.check===check);
      return {check,label:labels[check],state:proof?"verified":missing?.reason==="expired"?"expired":missing?.reason==="revoked"?"revoked":missing?.reason==="absent"?"missing":"in_review",
        verifiedAt:proof?.establishedAt.toISOString()??null,validUntil:proof?.validUntil.toISOString() ?? null,source:(proof?.source ?? "legacy") as VerificationBadge["source"],...(missing?.minimum?{minimum:missing.minimum}:{})} satisfies VerificationBadge;
    })];
}
export async function guestRegistrationView(q:Queryable,registration:Registration,event:DomainEvent,now:Date):Promise<GuestRegistrationView> {
  const result=await registrationChecks(q,registration,event,now,true);
  const [checkin]=await q.query<{checked_in_at:Date}>("select checked_in_at from checkins where registration_id=$1 and undone_at is null",[registration.id]);
  const [position]=registration.admission==="waitlisted"?await q.query<{n:number}>("select count(*)::int n from registrations where event_id=$1 and admission='waitlisted' and (applied_at,id)<=($2,$3::uuid)",[event.id,registration.appliedAt,registration.id]):[];
  const allowed=["pending","waitlisted","approved"].includes(registration.admission) && event.status==="published" && now<event.startsAt;
  const again=await rejoinOf(q,registration,event,now,!!checkin);
  return {id:registration.id,eventId:event.id,slug:event.slug,admission:registration.admission,
    readiness:result.canSubmit?"ready":registration.legacyImported && (!result.baseline.email || !result.baseline.profile)?"legacy_completion":result.baseline.email && result.baseline.profile && result.missing.length > 0 && result.missing.every(m=>m.reason==="expired")?"renewal_required":"review_required",
    policyVersion:registration.policyVersion,formVersion:registration.formVersion,missing:result.missing,badges:verificationBadges(result,result.account.emailVerifiedAt),
    nextExpiryAt:result.nextExpiryAt?.toISOString() ?? null,checkedInAt:checkin?.checked_in_at.toISOString() ?? null,
    withdrawal:{allowed,label:registration.admission==="approved"?"Cancel place":"Withdraw request",late:allowed && registration.admission==="approved" && event.startsAt.getTime()-now.getTime()<86400_000,unavailableReason:allowed?null:"Cancellation is closed"},
    canReapply:again.canRequest,rejoin:again,
    waitlistPosition:position?.n ?? null};
}
/** The invitation this account accepted for the registration, and whether it still admits (not revoked or expired). */
async function redeemedInvite(q:Queryable,registrationId:string,accountId:string,now:Date):Promise<{id:string;valid:boolean;skipApproval:boolean}|null> {
  const [row]=await q.query<{id:string;revoked_at:Date|null;expires_at:Date;skip_approval:boolean}>(`select i.id,i.revoked_at,i.expires_at,i.skip_approval from invite_redemptions ir join invites i on i.id=ir.invite_id
    where ir.registration_id=$1 and ir.account_id=$2 order by ir.created_at desc limit 1`,[registrationId,accountId]);
  return row?{id:row.id,valid:!row.revoked_at && row.expires_at>now,skipApproval:row.skip_approval}:null;
}
/** The re-join decision for an existing registration (see rejoin.ts): the facts come from history, the invite and the seats. */
export async function rejoinOf(q:Queryable,registration:Registration,event:DomainEvent,now:Date,checkedIn:boolean):Promise<Rejoin> {
  const [left]=registration.admission==="cancelled_by_guest"?await q.query<{from:Admission|null}>('select "from" from admission_history where registration_id=$1 and "to"=\'cancelled_by_guest\' order by created_at desc,id desc limit 1',[registration.id]):[];
  const invite=reapplicable(registration.admission)?await redeemedInvite(q,registration.id,registration.accountId,now):null;
  const [seats]=await q.query<{n:number}>("select count(*)::int n from registrations where event_id=$1 and admission='approved'",[event.id]);
  return rejoin({admission:registration.admission,cancelledFrom:left?.from ?? null,reapplicationCount:registration.reapplicationCount,blocked:registration.blocked,checkedIn,
    invite:invite?{valid:invite.valid,skipApproval:invite.skipApproval}:null,
    event:{mode:event.form.mode,waitlist:event.form.waitlist,full:(seats?.n ?? 0)>=event.capacity,requests:availabilityOf(event,now,false),invited:availabilityOf(event,now,true)}});
}
const readOnboarding=(db:Db)=>new Onboarding({db,launch:async()=>({state:"blocked",code:"provider_unavailable"})});
export class Requests {
  constructor(readonly db:Db=getDb()) {}
  private async context(q:Queryable,principal:GuestPrincipal,event:DomainEvent,now:Date,pinnedOp?:string):Promise<RequestContext> {
    const registration=await one<Registration>(q,"select * from registrations where account_id=$1 and event_id=$2",[principal.accountId,event.id]);
    const repair=!!registration?.legacyImported && !registration.requestReceipt && ["pending","waitlisted","approved"].includes(registration.admission);
    if(repair)event=await acceptedEvent(q,registration!,event);
    const account=await accountFacts(q,principal.accountId),missing=missingChecks(account,event,now),onboarding=await readOnboarding(this.db).viewInTx(q,account.id,now);
    const [draft]=await q.query<{id:string;version:number;expires_at:Date;application:Application;policy_version:number;form_version:number;invite_id:string|null}>("select * from registration_drafts where account_id=$1 and event_id=$2 and expires_at>$3",[account.id,event.id,now]);
    const [seats]=await q.query<{n:number}>("select count(*)::int n from registrations where event_id=$1 and admission='approved'",[event.id]);
    // The account's own event_checks operation, picked by identity (not by the workflow the still-missing checks would
    // need now: a phone+age check that proved the phone but found the guest under age maps to another workflow). It is
    // the one whose expected checks cover a check this event still misses; it may come from another event (resumed by
    // createExtraOperation). The live one first, else the most recently settled.
    // A tab waiting on the operation it launched pins it (another overlapping one, e.g. from another event, must not hide
    // its outcome); a pin that is not this account's event_checks operation is ignored.
    const extraChecks=[...new Set(missing.missing.filter(m=>m.check!=="face").map(m=>m.check))];
    type ChecksOpRow={id:string;state:NonNullable<RequestContext["checksOperation"]>["state"];expires_at:Date;provider_status:string|null};
    const [pinned]=pinnedOp?await q.query<ChecksOpRow>(
      `select op.id,op.state,op.expires_at,v.provider_status from verification_ops op left join verifications v on v.id=op.verification_id
       where op.id=$1 and op.account_id=$2 and op.purpose='event_checks'`,[pinnedOp,account.id]):[];
    const [checksOp]=pinned?[pinned]:extraChecks.length?await q.query<ChecksOpRow>(
      `select op.id,op.state,op.expires_at,v.provider_status from verification_ops op left join verifications v on v.id=op.verification_id
       where op.account_id=$1 and op.purpose='event_checks' and op.expected_checks && $2::text[]
       order by (op.state in ('creating','active') and op.expires_at>$3) desc,op.created_at desc,op.id desc limit 1`,[account.id,extraChecks,now]):[];
    const application=draft?.application ?? (repair?registration?.applicationV2:null) ?? {fields:{},answers:{}};
    const prefill:Application={fields:event.form.fields.phone_number==="off"?{}:application.fields,answers:Object.fromEntries(Object.entries(application.answers).filter(([id])=>event.form.questions.some(question=>question.id===id)))};
    const missingQuestions=event.form.questions.filter(question=>question.required && prefill.answers[question.id]===undefined).map(q=>q.id);
    if(event.form.fields.phone_number==="required" && !prefill.fields.phone_number) missingQuestions.push("phone_number");
    const view=registration?await guestRegistrationView(q,registration,event,now):null;
    // An accepted invitation that still stands admits a rejoin like the draft's own invite (until the event ends).
    const invited=!!draft?.invite_id || view?.rejoin.kind==="invited";
    const full=(seats?.n ?? 0)>=event.capacity;
    const window=availabilityOf(event,now,invited);
    const availability:RequestContext["availability"]=window!=="open"?window:!repair && !invited && event.form.mode==="invite_only"?"invite_only":full && !repair?event.form.waitlist?"waitlist":"full":"open";
    const available=availability==="open" || availability==="waitlist";
    // A registration on file shows its status unless this account may request again (one re-request per event).
    const active=!!registration && !repair && !view!.rejoin.canRequest;
    const canSubmit=available && missing.canSubmit && !missingQuestions.length && !active;
    return {event:{id:event.id,slug:event.slug,name:event.name,policyVersion:event.policyVersion,formVersion:event.formVersion,checks:event.checks,form:{...event.form,consent_text:eventConsentText(event.form)},door:event.door},onboarding,
      draft:draft?{id:draft.id,version:draft.version,expiresAt:draft.expires_at.toISOString(),application:prefill}:null,prefill,missingQuestions,missing:missing.missing,badges:verificationBadges(missing,account.emailVerifiedAt),
      consent:{disclosureVersion:"events-profile-v2",text:"Your profile and answers are shared with this event's hosts.",checksToAccept:["face",...requiredChecks(event).map(c=>c.check)],eventConsentText:eventConsentText(event.form)},
      canSubmit,submitLabel:full?"Join waitlist":event.form.mode==="invite_only"?"Accept invitation":event.form.mode==="open"?"Join event":"Request to join",
      nextAction:active?"status":!available?"unavailable":!missing.baseline.email || !missing.baseline.profile?"profile":!missing.baseline.face?"face":missing.missing.length?"extras":missingQuestions.length?"answers":"submit",
      availability,registration:view,
      checksOperation:checksOp?{id:checksOp.id,state:checksOp.expires_at<=now && ["active","creating"].includes(checksOp.state)?"expired":checksOp.state,providerStatus:checksOp.provider_status}:null};
  }
  /** `checksOp`: the event_checks operation this tab launched, reported instead of the overlap pick when it is the guest's. */
  async getRequestContext(principal:GuestPrincipal,eventId:string,opts:{checksOp?:string}={}) {
    return withTx(async tx=>{await assertGuest(tx,principal);const event=await eventBy(tx,eventId);if(!event || event.status==="draft") throw new ModelError("not_found");return this.context(tx,principal,event,await dbNow(tx),opts.checksOp);},this.db);
  }
  private async invite(q:Queryable,eventId:string,account:{id:string;email:string},token?:string,inviteId?:string|null):Promise<Invite|null> {
    if(!token && !inviteId)return null;
    const invite=await one<Invite>(q,"select * from invites where event_id=$1 and (($2::text is not null and token_hash=$2) or ($3::uuid is not null and id=$3))",[eventId,token?hash(token):null,inviteId ?? null]);
    if(!invite || invite.revokedAt || invite.expiresAt<=await dbNow(q) || invite.email && invite.email!==account.email)throw new ModelError("invite_invalid");
    // A guest rejoining with the invitation they already accepted does not use it up again.
    if(invite.uses>=invite.maxUses && !await this.redeemedBy(q,invite.id,account.id))throw new ModelError("invite_invalid");
    return invite;
  }
  private async redeemedBy(q:Queryable,inviteId:string,accountId:string):Promise<boolean> {
    return (await q.query("select 1 from invite_redemptions where invite_id=$1 and account_id=$2",[inviteId,accountId])).length>0;
  }
  async saveRequestDraft(principal:GuestPrincipal,eventId:string,raw:z.infer<typeof draftWriteSchema>):Promise<RequestContext> {
    const input=draftWriteSchema.parse(raw);
    return withTx(async tx=>{
      await lockForSeatGrant(tx,[principal.accountId],eventId);const account=await assertGuest(tx,principal),event=await eventBy(tx,eventId),now=await dbNow(tx);
      if(!event || !requestOpen(event,now,true))throw new ModelError("closed");
      if(event.policyVersion!==input.policyVersion || event.formVersion!==input.formVersion)throw new ModelError("context_changed","The request form changed",undefined,await this.context(tx,principal,event,now));
      const application=validateApplication(event.form,input.application,{partial:true});
      await tx.query("delete from registration_drafts where account_id=$1 and event_id=$2 and expires_at<=$3",[account.id,event.id,now]);
      const [draft]=await tx.query<{id:string;version:number;invite_id:string|null}>("select id,version,invite_id from registration_drafts where account_id=$1 and event_id=$2 for update",[account.id,event.id]);
      if((draft?.version ?? 1)!==input.expectedVersion)throw new ModelError("context_changed");
      const invite=await this.invite(tx,event.id,account,input.inviteToken);
      if(!requestOpen(event,now,!!invite || !!draft?.invite_id))throw new ModelError("closed");
      await tx.query(`insert into registration_drafts(account_id,event_id,policy_version,form_version,application,consent,invite_id,expires_at)
        values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8) on conflict(account_id,event_id) do update set version=registration_drafts.version+1,policy_version=excluded.policy_version,
        form_version=excluded.form_version,application=excluded.application,consent=excluded.consent,invite_id=coalesce(excluded.invite_id,registration_drafts.invite_id),expires_at=excluded.expires_at,updated_at=clock_timestamp()`,
      [account.id,event.id,event.policyVersion,event.formVersion,JSON.stringify(application),JSON.stringify({...input.consent,acceptedAt:now.toISOString()}),invite?.id ?? null,new Date(now.getTime()+30*86400_000)]);
      return this.context(tx,principal,event,now);
    },this.db);
  }
  async submitRequest(principal:GuestPrincipal,eventId:string,raw:unknown):Promise<SubmitResult> {
    const input=submitRequestSchema.parse(raw),{idempotencyKey,...body}=input,inputHash=configHash(body);
    return withTx(async tx=>{
      await tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`submission:${idempotencyKey}`]);
      await lockForSeatGrant(tx,[principal.accountId],eventId);const account=await assertGuest(tx,principal),now=await dbNow(tx);let event=await eventBy(tx,eventId);
      if(!event)throw new ModelError("not_found");
      let registration=await one<Registration>(tx,"select * from registrations where account_id=$1 and event_id=$2",[account.id,event.id]);
      const repair=!!registration?.legacyImported && !registration.requestReceipt && ["pending","waitlisted","approved"].includes(registration.admission);
      if(repair)event=await acceptedEvent(tx,registration!,event);
      const [prior]=await tx.query<{account_id:string;event_id:string;input_hash:string;registration_id:string}>("select * from registration_submissions where id=$1",[idempotencyKey]);
      if(prior){if(prior.account_id!==account.id)throw new ModelError("not_found");if(prior.event_id!==event.id || prior.input_hash!==inputHash)throw new ModelError("idempotency_conflict");return {registration:await guestRegistrationView(tx,await registrationBy(tx,prior.registration_id),event,now),replayed:true,redirectTo:`/me/events/${event.slug}`};}
      if(!requestOpen(event,now,true))throw new ModelError("closed");
      if(event.policyVersion!==input.expectedPolicyVersion || event.formVersion!==input.expectedFormVersion || account.profileVersion!==input.profileVersion)throw new ModelError("context_changed","The request context changed",undefined,await this.context(tx,principal,event,now));
      const facts=await accountFacts(tx,account.id),checks=missingChecks(facts,event,now);
      if(!checks.canSubmit)throw new ModelError(!checks.baseline.email || !checks.baseline.profile || !checks.baseline.face?"onboarding_required":"checks_required","Complete the required checks",undefined,await this.context(tx,principal,event,now));
      const application=validateApplication(event.form,input.application);
      if(!input.consent.acceptedChecks.includes("face") || requiredChecks(event).some(c=>!input.consent.acceptedChecks.includes(c.check)) || eventConsentText(event.form) && !input.consent.eventConsentAccepted)throw new ModelError("invalid","Consent is required");
      if(application.fields.phone_number && checks.satisfied.phone){const phone=facts.evidence.find(e=>e.id===checks.satisfied.phone!.evidenceId);if((phone?.value as {e164?:string})?.e164!==application.fields.phone_number)throw new ModelError("invalid","Contact phone must match the verified phone");}
      const [draft]=input.draftId?await tx.query<{id:string;invite_id:string|null;policy_version:number;form_version:number}>("select * from registration_drafts where id=$1 and account_id=$2 and event_id=$3 and expires_at>$4",[input.draftId,account.id,event.id,now]):[];
      if(input.draftId && !draft)throw new ModelError("not_found");
      if(draft && (draft.policy_version!==event.policyVersion || draft.form_version!==event.formVersion))throw new ModelError("context_changed");
      // A rejoin reuses the invitation this account accepted for the registration while it stands; a lapsed one makes it a normal request.
      const [kept]=!input.inviteToken && registration && !repair && reapplicable(registration.admission)?await tx.query<{invite_id:string}>("select invite_id from invite_redemptions where registration_id=$1 and account_id=$2 order by created_at desc limit 1",[registration.id,account.id]):[];
      const invite=await this.invite(tx,event.id,account,input.inviteToken,draft?.invite_id ?? kept?.invite_id).catch(e=>{if(kept && !draft?.invite_id && e instanceof ModelError && e.code==="invite_invalid")return null;throw e;});
      if(!requestOpen(event,now,!repair && !!invite))throw new ModelError("closed");
      if(!repair && event.form.mode==="invite_only" && !invite)throw new ModelError("invite_required");
      const [count]=await tx.query<{n:number}>("select count(*)::int n from registrations where event_id=$1 and admission='approved'",[event.id]);const full=count!.n>=event.capacity;
      if(!repair && full && !event.form.waitlist)throw new ModelError("capacity");if(input.joinWaitlist && !full)throw new ModelError("context_changed");
      if(registration && !repair && (!reapplicable(registration.admission) || registration.reapplicationCount>=1 || registration.blocked))throw new ModelError("context_changed");
      await completeOnboardingInTx(tx,account.id,now);
      const receipt:RequestReceipt={version:1,evaluatedAt:now.toISOString(),emailVerifiedAt:account.emailVerifiedAt!.toISOString(),profileVersion:account.profileVersion,
        evidenceIds:Object.fromEntries(Object.entries(checks.satisfied).map(([k,v])=>[k,v!.evidenceId])) as RequestReceipt["evidenceIds"],consent:{...input.consent,acceptedAt:now.toISOString()}};
      const reapply=!!registration && !repair,oldAdmission=registration?.admission;
      if(registration) registration=(await one<Registration>(tx,`update registrations set admission=case when $8 then admission else 'pending' end,reapplication_count=reapplication_count+case when $8 then 0 else 1 end,policy_version=$2,form_version=$3,
        application_v2=$4::jsonb,request_receipt=$5::jsonb,request_completed_at=$6,profile_version_at_request=$7,legacy_imported=false,reason=null,late_cancellation=false,undo_rejection=case when $8 then undo_rejection else null end,applied_at=$6,updated_at=$6 where id=$1 returning *`,
      [registration.id,event.policyVersion,event.formVersion,JSON.stringify(application),JSON.stringify(receipt),now,account.profileVersion,repair]))!;
      else registration=(await one<Registration>(tx,`insert into registrations(event_id,account_id,policy_version,form_version,application_v2,request_receipt,request_completed_at,profile_version_at_request,applied_at)
        values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$7) returning *`,[event.id,account.id,event.policyVersion,event.formVersion,JSON.stringify(application),JSON.stringify(receipt),now,account.profileVersion]))!;
      await tx.query(`insert into registration_submissions(id,registration_id,account_id,event_id,policy_version,form_version,application,receipt,input_hash,created_at)
        values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)`,[idempotencyKey,registration.id,account.id,event.id,event.policyVersion,event.formVersion,JSON.stringify(application),JSON.stringify(receipt),inputHash,now]);
      if(!repair)await tx.query('insert into admission_history(registration_id,"from","to",actor) values($1,$2,\'pending\',$3)',[registration.id,reapply?oldAdmission:null,account.id]);
      if(invite && !repair && !await this.redeemedBy(tx,invite.id,account.id)){const used=await tx.query("update invites set uses=uses+1 where id=$1 and uses<max_uses and revoked_at is null and expires_at>$2 returning id",[invite.id,now]);if(!used.length)throw new ModelError("invite_invalid");await tx.query("insert into invite_redemptions(invite_id,account_id,registration_id) values($1,$2,$3)",[invite.id,account.id,registration.id]);}
      if(repair){await audit(tx,event.id,account.id,"request.legacy_completed",registration.id,{admission:oldAdmission});}
      else if(full){registration=(await one<Registration>(tx,"update registrations set admission='waitlisted' where id=$1 returning *",[registration.id]))!;await tx.query('insert into admission_history(registration_id,"from","to",actor) values($1,\'pending\',\'waitlisted\',$2)',[registration.id,account.id]);await mail(tx,"M-09",registration,idempotencyKey);await notifyHostsOfRequest(tx,registration,event,now);}
      else if(event.form.mode==="open" || invite?.skipApproval)registration=await new Admissions(this.db).grantSeat(tx,registration.id,"system");
      else {await mail(tx,"M-02",registration,idempotencyKey);await notifyHostsOfRequest(tx,registration,event,now);}
      await tx.query("update registration_drafts set submitted_registration_id=$3 where account_id=$1 and event_id=$2",[account.id,event.id,registration.id]);
      await signal(tx,event.id,"request.submitted");return {registration:await guestRegistrationView(tx,registration,event,now),replayed:false,redirectTo:`/me/events/${event.slug}`};
    },this.db);
  }
  async withdrawOrCancel(principal:GuestPrincipal,registrationId:string,input:{reason?:string;expectedAdmission:Admission}):Promise<GuestRegistrationView> {
    const hint=await registrationBy(queryable(this.db),registrationId);
    return withTx(async tx=>{
      await lockForSeatGrant(tx,[principal.accountId],hint.eventId);await assertGuest(tx,principal);
      const r=await registrationBy(tx,registrationId),event=(await eventBy(tx,r.eventId))!,now=await dbNow(tx);
      if(r.accountId!==principal.accountId)throw new ModelError("not_found");
      if(r.admission==="cancelled_by_guest" || r.admission!==input.expectedAdmission)return guestRegistrationView(tx,r,event,now);
      if(!["pending","waitlisted","approved"].includes(r.admission) || event.status!=="published" || now>=event.startsAt)throw new ModelError("closed");
      const reason=z.string().trim().max(500).parse(input.reason ?? (r.admission==="approved"?"Guest cancelled place":"Guest withdrew request"));
      const late=r.admission==="approved" && event.startsAt.getTime()-now.getTime()<86400_000;
      const [history]=await tx.query<{id:string}>('insert into admission_history(registration_id,"from","to",actor,reason) values($1,$2,\'cancelled_by_guest\',$3,$4) returning id',[r.id,r.admission,principal.accountId,reason]);
      const next=(await one<Registration>(tx,"update registrations set admission='cancelled_by_guest',reason=$2,late_cancellation=$3,updated_at=$4 where id=$1 returning *",[r.id,reason,late,now]))!;
      await tx.query("update link_tokens set revoked_at=coalesce(revoked_at,$2) where registration_id=$1",[r.id,now]);
      await tx.query("update outbox set status='sent',payload=null,provider_id='cancelled:withdrawal',sent_at=$2 where status='pending' and payload->'data'->>'registrationId'=$1 and kind in ('email:M-06','email:M-03','email:M-05','email:M-25')",[r.id,now]);
      await mail(tx,"M-20",next,history!.id,{kind:r.admission==="approved"?"cancelled":"withdrawn"});
      await audit(tx,event.id,principal.accountId,"admission.cancelled_by_guest",r.id,{from:r.admission,lateCancellation:late});
      if(r.admission==="approved")await new Admissions(this.db).schedulePromotion(tx,event.id);
      await signal(tx,event.id,"admission");return guestRegistrationView(tx,next,event,now);
    },this.db);
  }
}
