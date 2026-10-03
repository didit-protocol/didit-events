import { z } from "zod";
import type { ApplicantDrawer } from "../contracts/event-model.ts";
import { DiditClient } from "../didit/client.ts";
import { getDb,type Db } from "../db/index.ts";
import type { Queryable } from "../db/tx.ts";
import { queryable,withTx } from "../db/tx.ts";
import { ModelError } from "../domain/model-error.ts";
import { profileDraft } from "../domain/profile.ts";
import { IdentityError } from "../identity/shared.ts";
import type { StaffPrincipal } from "../domain/services.ts";
import { dbNow } from "../verification/shared.ts";
import { approvalChecks,registrationChecks } from "./policies.ts";
import { guestRegistrationView,verificationBadges } from "./requests.ts";
import { eventBy,registrationBy,requireEventActor } from "./shared.ts";
export async function applicantDrawer(actor:StaffPrincipal,eventId:string,id:string,db:Db=getDb()):Promise<ApplicantDrawer> {
  return withTx(async tx=>{
    if(tx.kind==="postgres")await tx.query("set transaction isolation level repeatable read read only");
    const registration=await registrationBy(tx,id),event=await eventBy(tx,eventId);
    if(!event || registration.eventId!==event.id)throw new ModelError("not_found");
    await requireEventActor(tx,actor,event.id,"guests.view");
    const now=await dbNow(tx);
    if (registration.applicationPurgedAt || event.endsAt.getTime() + 90 * 86400_000 <= now.getTime()) throw new ModelError("retained_data_expired");
    // An account that is deleted or being deleted has no profile to show: staff still see what was decided about the request.
    const checks=await registrationChecks(tx,registration,event,now).catch((e:unknown)=>{if(e instanceof IdentityError&&e.code==="AccountUnavailable")return null;throw e;});
    if(!checks){
      const {items}=await historyPage(tx,id);
      return {registrationId:id,eventId:event.id,accountId:registration.accountId,admission:registration.admission,readiness:"review_required",accountDeleted:true,
        profile:{fullName:"",headline:"",company:"",jobRole:"",bio:"",links:[],email:"",version:0,photoUrl:null},profileVersionAtRequest:null,updatedSinceRequest:false,
        acceptedPolicyVersion:registration.policyVersion,formVersion:registration.formVersion,badges:[],answers:[],history:items,staffNote:registration.staffNote,lateCancellation:registration.lateCancellation,
        actions:{approve:false,waitlist:false,reject:false,revoke:false,resendRenewal:false,blockedReason:"This account was deleted"}};
    }
    const view=await guestRegistrationView(tx,registration,event,now),account=checks.account;
    const answers:ApplicantDrawer["answers"]=registration.applicationPurgedAt?[]:checks.policy.form.questions.map(question=>{
      const value=registration.applicationV2?.answers[question.id]??registration.application[question.id]??null;
      const display=(v:unknown)=>"options" in question ? question.options.find(o=>o.id===v)?.label??String(v??""):typeof v==="boolean"?v?"Yes":"No":String(v??"");
      return {id:question.id,label:question.label,kind:question.kind,value,displayValue:Array.isArray(value)?value.map(display).join(", "):display(value),required:question.required};
    });
    if (registration.legacyImported) for (const [key, value] of Object.entries(registration.application).slice(0, 100)) {
      if (key.startsWith("_") || key === "blocked" || answers.some(a => a.id === key)) continue;
      if (typeof value !== "string" && typeof value !== "boolean") continue;
      answers.push({ id: key, label: `Legacy answer: ${key.slice(0, 200)}`, kind: "legacy", value: typeof value === "string" ? [...value].slice(0, 2000).join("") : value, displayValue: String(value).slice(0, 2000), required: false });
    }
    if (registration.applicationV2?.fields.phone_number) answers.unshift({ id: "phone_number", label: "Contact phone", kind: "short", value: registration.applicationV2.fields.phone_number, displayValue: registration.applicationV2.fields.phone_number, required: checks.policy.form.fields.phone_number === "required" });
    const {items:history}=await historyPage(tx,id);
    const approval=await approvalChecks(tx,registration,event,now).then(()=>true,()=>false),decidable=["pending","waitlisted"].includes(registration.admission)&&event.status==="published"&&event.startsAt>now;
    return {registrationId:id,eventId:event.id,accountId:account.id,admission:registration.admission,readiness:view.readiness,
      profile:{...profileDraft(account),email:account.email,version:account.profileVersion,photoUrl:account.photo?`/api/admin/events/${event.id}/applicants/${id}/photo`:null},
      profileVersionAtRequest:registration.requestReceipt?.profileVersion??null,updatedSinceRequest:!!registration.requestReceipt&&registration.requestReceipt.profileVersion!==account.profileVersion,
      acceptedPolicyVersion:registration.policyVersion,formVersion:registration.formVersion,badges:verificationBadges(checks,account.emailVerifiedAt),answers,
      history:history.sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id)).slice(0,100),staffNote:registration.staffNote,lateCancellation:registration.lateCancellation,
      actions:{approve:decidable&&approval,waitlist:decidable&&registration.admission!=="waitlisted",reject:decidable,revoke:registration.admission==="approved",resendRenewal:registration.admission==="approved"&&view.readiness==="renewal_required",blockedReason:approval?null:"Applicant must complete the accepted checks"}};
  },db);
}
export async function applicantPhoto(actor:StaffPrincipal,eventId:string,id:string,db:Db=getDb()):Promise<Response> {
  const q=queryable(db);await requireEventActor(q,actor,eventId,"guests.photo");
  const [association] = await q.query<{ expired: boolean }>("select r.application_purged_at is not null or e.ends_at<=clock_timestamp()-interval '90 days' expired from registrations r join events e on e.id=r.event_id where r.id=$1 and r.event_id=$2", [id,eventId]);
  if (!association) throw new ModelError("not_found");
  if (association.expired) throw new ModelError("retained_data_expired");
  const [photo]=await q.query<{photo:Uint8Array|null}>("select a.photo from accounts a join registrations r on r.account_id=a.id where r.id=$1 and r.event_id=$2 and a.deleting_at is null and a.deleted_at is null",[id,eventId]);
  if(!photo?.photo)throw new ModelError("not_found");
  return new Response(new Uint8Array(photo.photo),{headers:{"Content-Type":"image/jpeg","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
const SELFIE_MAX_BYTES=8*1024*1024;
/**
 * The selfie Didit approved for the applicant's current (or latest approved) face proof, for staff only: read from the
 * Didit decision on demand (`liveness_checks[].reference_image`), never stored here, answered `private, no-store`.
 */
export async function applicantSelfie(actor:StaffPrincipal,eventId:string,id:string,deps:{client?:Pick<DiditClient,"getDecision">;fetch?:typeof fetch}={},db:Db=getDb()):Promise<Response> {
  // The selfie is a staff/host capability (guests.photo); door operators never receive it.
  const q=queryable(db);await requireEventActor(q,actor,eventId,"guests.photo");
  const [association] = await q.query<{ expired: boolean }>("select r.application_purged_at is not null or e.ends_at<=clock_timestamp()-interval '90 days' expired from registrations r join events e on e.id=r.event_id where r.id=$1 and r.event_id=$2", [id,eventId]);
  if (!association) throw new ModelError("not_found");
  if (association.expired) throw new ModelError("retained_data_expired");
  const [proof]=await q.query<{session:string}>(`select v.didit_session_id::text session from evidence e join verifications v on v.id=e.verification_id and v.account_id=e.account_id
    join registrations r on r.account_id=e.account_id join accounts a on a.id=r.account_id
    where r.id=$1 and r.event_id=$2 and e.kind='face' and e.provider_status='approved' and e.invalidated_at is null and e.source<>'legacy' and a.deleting_at is null and a.deleted_at is null
    order by (e.activation='active') desc,e.established_at desc limit 1`,[id,eventId]);
  if(!proof)throw new ModelError("not_found");
  const decision=await (deps.client??new DiditClient({apiKey:process.env.DIDIT_API_KEY??""})).getDecision(proof.session).catch(()=>{throw new ModelError("provider_unavailable");});
  const url=(decision.liveness_checks??[]).map(l=>(l as {reference_image?:unknown}).reference_image).find((u):u is string=>typeof u==="string"&&u.startsWith("https://"));
  if(!url)throw new ModelError("not_found");
  const image=await (deps.fetch??fetch)(url,{redirect:"error",signal:AbortSignal.timeout(10_000)}).catch(()=>null);
  const type=image?.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()??"";
  if(!image?.ok||!["image/jpeg","image/png","image/webp"].includes(type))throw new ModelError("provider_unavailable");
  const body=new Uint8Array(await image.arrayBuffer());
  if(body.byteLength>SELFIE_MAX_BYTES)throw new ModelError("provider_unavailable");
  return new Response(body,{headers:{"Content-Type":type,"Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
}
const historyCursor=z.object({at:z.iso.datetime({offset:true}),id:z.uuid(),kind:z.enum(["admission","submission","checkin"])}).strict();
async function historyPage(q:Queryable,id:string,cursor?:string|null) {
 let before:z.infer<typeof historyCursor>|null=null;
 if(cursor){try{if(cursor.length>500)throw new Error();before=historyCursor.parse(JSON.parse(Buffer.from(cursor,"base64url").toString("utf8")));}catch{throw new ModelError("invalid","Invalid history cursor");}}
 const rows=await q.query<{id:string;at:Date;kind:"admission"|"submission"|"checkin";label:string;actor_label:string;reason:string|null}>(`with history as (
   select id,date_trunc('milliseconds',created_at) as at,'admission'::text kind,coalesce("from"::text,'New')||' → '||"to"::text label,actor actor_label,reason from admission_history where registration_id=$1
   union all select id,date_trunc('milliseconds',created_at),'submission','Request submitted · policy '||policy_version::text,'Guest',null from registration_submissions where registration_id=$1
   union all select id,date_trunc('milliseconds',checked_in_at),'checkin',case when undone_at is null then method||' check-in' else 'Check-in undone' end,'Door',null from checkins where registration_id=$1
 ) select * from history where $2::timestamptz is null or (at,id,kind)<($2::timestamptz,$3::uuid,$4::text) order by at desc,id desc,kind desc limit 101`,[id,before?.at??null,before?.id??null,before?.kind??null]);
 const items=rows.slice(0,100).map(r=>({id:r.id,at:r.at.toISOString(),kind:r.kind,label:r.label,actorLabel:r.actor_label,reason:r.reason})),last=items.at(-1);
 return {items,nextCursor:rows.length>100&&last?Buffer.from(JSON.stringify({at:last.at,id:last.id,kind:last.kind})).toString("base64url"):null};
}
export async function applicantHistory(actor:StaffPrincipal,eventId:string,id:string,db:Db=getDb(),cursor?:string|null) {
 return withTx(async tx=>{
  const registration=await registrationBy(tx,id),event=await eventBy(tx,eventId);
  if(!event || registration.eventId!==eventId)throw new ModelError("not_found");
  await requireEventActor(tx,actor,event.id,"guests.view");
  if(registration.applicationPurgedAt || event.endsAt.getTime()+90*86400_000<=(await dbNow(tx)).getTime())throw new ModelError("retained_data_expired");
  const page=await historyPage(tx,id,cursor);
  const submissions=await tx.query("select id,policy_version,form_version,application,created_at from registration_submissions where registration_id=$1 and payload_purged_at is null order by created_at desc,id desc limit 2",[id]);
  return {...page,submissions};
 },db);
}
