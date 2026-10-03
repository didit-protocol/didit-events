import { randomUUID } from "node:crypto";
import { Requests } from "../admission/requests.ts";
import type { Db } from "../db/index.ts";
import { queryable } from "../db/tx.ts";
import type { GuestPrincipal,StaffPrincipal } from "../domain/services.ts";
export async function staffFixture(db:Db, actor:StaffPrincipal) {
  const q=queryable(db);
  await q.query("insert into staff(email,role) values($1,$2) on conflict(email) do nothing",[actor.email,actor.role]);
  await q.query("insert into sessions(id,token_hash,principal,auth_method,staff_email,expires_at) values($1,$2,'staff','email_otp',$3,clock_timestamp()+interval '1 day')",[actor.sessionId,randomUUID(),actor.email]);
}
export async function guestFixture(db:Db,email=`${randomUUID()}@example.test`):Promise<GuestPrincipal> {
  const q=queryable(db),id=randomUUID(),sessionId=randomUUID(),verificationId=randomUUID();
  await q.query(`insert into accounts(id,email,first_name,last_name,full_name,headline,company,job_role,bio,profile_links,email_verified_at,email_proof_method,email_proof_ref)
    values($1,$2,'Test','Guest','Test Guest','Builder','Independent','','Building software','[{"kind":"website","label":"Website","href":"https://example.test/"}]',clock_timestamp(),'didit_otp','fixture')`,[id,email]);
  await q.query("insert into sessions(id,token_hash,principal,auth_method,account_id,expires_at) values($1,$2,'guest','email_otp',$3,clock_timestamp()+interval '1 day')",[sessionId,randomUUID(),id]);
  await q.query("insert into verifications(id,account_id,didit_session_id,workflow_id,vendor_data,status) values($1,$2,$3,$4,$5,'approved')",[verificationId,id,randomUUID(),randomUUID(),email]);
  await q.query("insert into evidence(account_id,verification_id,kind,established_at,valid_until,activation,provider_status) values($1,$2,'face',clock_timestamp(),clock_timestamp()+interval '170 days','active','approved')",[id,verificationId]);
  return {principal:'guest',accountId:id,sessionId,authenticatedAt:new Date()};
}
export async function requestFixture(db:Db,guest:GuestPrincipal,eventId:string,joinWaitlist=false) {
  const c=await new Requests(db).getRequestContext(guest,eventId);
  return {expectedPolicyVersion:c.event.policyVersion,expectedFormVersion:c.event.formVersion,profileVersion:c.onboarding.profileVersion,application:{fields:{},answers:{}},consent:{disclosureVersion:'events-profile-v2',shareProfileWithHosts:true as const,eventConsentAccepted:true as const,acceptedChecks:['face' as const]},joinWaitlist,idempotencyKey:randomUUID()};
}
export const emptyForm={version:1 as const,mode:'request' as const,closes_at:null,waitlist:true,fields:{phone_number:'off' as const},questions:[],consent_text:null};
