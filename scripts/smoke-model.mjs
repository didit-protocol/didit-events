import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {queryable,withTx} from '../packages/core/src/db/tx.ts';
import {fakeDiditServer} from '../packages/core/src/didit/fake-server.ts';
import {DiditClient} from '../packages/core/src/didit/client.ts';
import {createIdentityServices} from '../packages/core/src/identity/index.ts';
import {createModelServices} from '../packages/core/src/verification/model-runtime.ts';
import {applyModelDecision} from '../packages/core/src/verification/model-verification.ts';
import {provisionEventModel} from '../packages/core/src/verification/provision.ts';
import {Requests} from '../packages/core/src/admission/requests.ts';
import {Admissions} from '../packages/core/src/admission/admission.ts';
import {EventEditor} from '../packages/core/src/admission/event-editor.ts';
import {applicantDrawer} from '../packages/core/src/admission/applicants.ts';
import {Door} from '../packages/core/src/door/service.ts';
import {staffFixture} from '../packages/core/src/testing/model.ts';

/** Runs only in smoke-local's disposable database, using independent fake provider state. */
export async function smokeModel(database,step){
 const fake=await fakeDiditServer(),q=queryable(database),client=new DiditClient({apiKey:'fake',fetch:fake.fetch});
 try{
  const model=createModelServices({db:database,client,appUrl:'https://smoke.example.test'}),requests=new Requests(database),editor=new EventEditor(database),admissions=new Admissions(database);
  const staff={principal:'staff',email:'model-smoke@didit.me',role:'owner',sessionId:randomUUID()};await staffFixture(database,staff);
  await provisionEventModel(database,client,[18]);
  const consent={disclosureVersion:'events-profile-v2',shareProfileWithHosts:true,eventConsentAccepted:true,acceptedChecks:['face','phone','id_document','name_from_id','age']};
  const identity=createIdentityServices({db:database,didit:client,secret:'synthetic-smoke-secret'.repeat(3)}),sent=await identity.auth.sendOtp('model-smoke@example.test','model-smoke');
  const login=await identity.auth.checkOtp(sent.challengeId,'481903',{otpCookie:sent.cookie,consent}),guest=login.principal;
  await model.onboarding.saveOnboardingProfile(guest,{expectedProfileVersion:1,fullName:'Model Guest',headline:'Builder',company:'Synthetic',jobRole:'',bio:'Synthetic local smoke.',links:[{kind:'website',label:'Website',href:'https://example.test/'}]});
  const [face]=await q.query('select didit_session_id from verification_ops where account_id=$1',[guest.accountId]);
  const decide=async(sessionId,proofs)=>{
    const current=fake.decisions.get(sessionId),at=new Date().toISOString();assert.ok(current);
    fake.decisions.set(sessionId,{...current,...proofs,status:'Approved',events:[{event_type:'SESSION_STATUS_CHANGED',feature_step:null,created_at:at,details:{current_status:'Approved'}}]});
    return withTx(tx=>applyModelDecision(tx,guest.accountId,sessionId,client),database);
  };
  await decide(face.didit_session_id,{liveness_checks:[{status:'Approved',matches:[],warnings:[]}]});
  const base={name:'Model smoke',description:'',descriptionMd:'',startsAt:new Date(Date.now()+2*86400_000).toISOString(),endsAt:new Date(Date.now()+2*86400_000+3600_000).toISOString(),timezone:'UTC',venue:'HQ',address:'One Street',placeId:null,lat:null,lng:null,mapsUrl:null,capacity:10,checks:{version:1,required:[],max_age:{}},door:{kiosk:false},form:{version:1,mode:'request',closes_at:null,waitlist:true,fields:{phone_number:'off'},questions:[],consent_text:null},emails:{version:1,templates:{}},cover:{kind:'theme',theme:'aqua'}};
  async function event(checks=base.checks){const e=await editor.create(staff,{...base,checks});return editor.lifecycle(staff,e.eventId,'publish',e.editVersion);}
  async function draft(e){return requests.saveRequestDraft(guest,e.eventId,{expectedVersion:1,policyVersion:e.policyVersion,formVersion:e.formVersion,application:{fields:{},answers:{}},consent});}
  async function submit(e){const c=await requests.getRequestContext(guest,e.eventId);return requests.submitRequest(guest,e.eventId,{expectedPolicyVersion:c.event.policyVersion,expectedFormVersion:c.event.formVersion,profileVersion:c.onboarding.profileVersion,application:c.prefill,consent,joinWaitlist:false,idempotencyKey:randomUUID()});}
  const matches=[{session_id:face.didit_session_id,similarity_percentage:97,is_blocklisted:false,status:'Approved',api_service:null}];
  let phoneEvent,phoneRequest;
  await step('phone-only check, saved draft resume and proof reuse',async()=>{
   phoneEvent=await event({version:1,required:['phone'],max_age:{}});const d=await draft(phoneEvent);
   const resumed=await new Requests(database).getRequestContext(guest,phoneEvent.eventId);assert.equal(resumed.draft.id,d.draft.id);
   assert.equal((await q.query('select id from registrations where account_id=$1 and event_id=$2',[guest.accountId,phoneEvent.eventId])).length,0);
   const start=await model.verification.startRequestChecks(guest,phoneEvent.eventId,d.draft.id,{expectedPolicyVersion:1,consent});assert.equal(start.state,'ready');
   const [op]=await q.query('select * from verification_ops where origin_event_id=$1',[phoneEvent.eventId]);
   const [registry]=await q.query('select feature_key from didit_workflows where key=$1',[op.workflow_key]);assert.equal(registry.feature_key,'PHONE_VERIFICATION');
   await decide(op.didit_session_id,{phone_verifications:[{status:'Approved',full_number:'+34600600600',verified_at:new Date().toISOString()}]});
   phoneRequest=await submit(phoneEvent);const count=fake.count('POST','/v3/session/');assert.equal((await model.verification.startRequestChecks(guest,phoneEvent.eventId,d.draft.id,{expectedPolicyVersion:1,consent})).state,'not_needed');assert.equal(fake.count('POST','/v3/session/'),count);
  });
  await step('age failure stays blocked; explicit OCR alternative proves name and age without another enrolled face',async()=>{
   const e=await event({version:1,required:[],age_min:18,max_age:{}}),d=await draft(e);
   await model.verification.startRequestChecks(guest,e.eventId,d.draft.id,{expectedPolicyVersion:1,consent});
   let [op]=await q.query('select * from verification_ops where origin_event_id=$1 order by created_at desc',[e.eventId]);
   await decide(op.didit_session_id,{liveness_checks:[{status:'Approved',matches,warnings:[],age_estimation:17.99}]});
   assert.equal((await requests.getRequestContext(guest,e.eventId)).canSubmit,false);
   assert.equal((await model.verification.startRequestChecks(guest,e.eventId,d.draft.id,{expectedPolicyVersion:1,consent})).state,'blocked');
   await model.verification.startRequestChecks(guest,e.eventId,d.draft.id,{expectedPolicyVersion:1,consent,idFallbackConsented:true});
   [op]=await q.query('select * from verification_ops where origin_event_id=$1 order by created_at desc',[e.eventId]);
   await decide(op.didit_session_id,{liveness_checks:[{status:'Approved',matches,warnings:[]}],face_matches:[{status:'Approved'}],id_verifications:[{status:'Approved',full_name:'Model Guest',date_of_birth:'2000-01-01',expiration_date:'2035-01-01'}]});
   assert.equal((await requests.getRequestContext(guest,e.eventId)).canSubmit,true);
   const name=await event({version:1,required:['id_document','name_from_id'],age_min:18,max_age:{}});assert.equal((await requests.getRequestContext(guest,name.eventId)).canSubmit,true);
   assert.equal((await q.query("select id from evidence where account_id=$1 and kind='face'",[guest.accountId])).length,1);
  });
  await step('accepted policy stays pinned; approval and cancellation never start checks or duplicate notices',async()=>{
   const count=fake.count('POST','/v3/session/');const current=await editor.view(staff,phoneEvent.eventId);
   await editor.save(staff,phoneEvent.eventId,{...current.values,expectedVersion:current.editVersion,checks:{version:1,required:['phone','name_from_id'],max_age:{}}});
   await admissions.transition(staff,phoneRequest.registration.id,'approved');
   const drawer=await applicantDrawer(staff,phoneEvent.eventId,phoneRequest.registration.id,database);assert.equal(drawer.acceptedPolicyVersion,1);assert.equal(drawer.readiness,'ready');
   const cancelled=await requests.withdrawOrCancel(guest,phoneRequest.registration.id,{expectedAdmission:'approved'});assert.equal(cancelled.admission,'cancelled_by_guest');
   const outbox=(await q.query('select id from outbox')).length;assert.equal((await requests.withdrawOrCancel(guest,phoneRequest.registration.id,{expectedAdmission:'approved'})).admission,'cancelled_by_guest');assert.equal((await q.query('select id from outbox')).length,outbox);assert.equal(fake.count('POST','/v3/session/'),count);
  });
  await step('v5 re-join: withdraw → request again and cancel → request the place again, one tap each, no new checks; then status only',async()=>{
   const count=fake.count('POST','/v3/session/');
   const w=await event(),first=await submit(w);assert.equal(first.registration.admission,'pending');
   await requests.withdrawOrCancel(guest,first.registration.id,{expectedAdmission:'pending'});
   let c=await requests.getRequestContext(guest,w.eventId);assert.equal(c.nextAction,'submit');assert.equal(c.registration.rejoin.kind,'withdrew');assert.equal(c.registration.rejoin.canRequest,true);
   assert.equal((await submit(w)).registration.admission,'pending');
   await requests.withdrawOrCancel(guest,first.registration.id,{expectedAdmission:'pending'});
   c=await requests.getRequestContext(guest,w.eventId);assert.equal(c.nextAction,'status');assert.equal(c.registration.rejoin.blockedBy,'once');
   const a=await event(),placed=await submit(a);await admissions.transition(staff,placed.registration.id,'approved');
   await requests.withdrawOrCancel(guest,placed.registration.id,{expectedAdmission:'approved'});
   c=await requests.getRequestContext(guest,a.eventId);assert.equal(c.registration.rejoin.kind,'cancelled');assert.equal(c.registration.rejoin.outcome,'pending');
   assert.equal((await submit(a)).registration.admission,'pending');
   assert.equal(fake.count('POST','/v3/session/'),count,'a request again never starts a face or extras session');
  });
  await step('legacy request repair and kiosk-off manual admission use the same completed baseline',async()=>{
   const e=await event();const [r]=await q.query('insert into registrations(account_id,event_id,legacy_imported,policy_version,form_version) values($1,$2,true,1,1) returning id',[guest.accountId,e.eventId]);
   const repaired=await submit(e);assert.equal(repaired.registration.id,r.id);await admissions.transition(staff,r.id,'approved');
   const current=await editor.view(staff,e.eventId);await editor.save(staff,e.eventId,{...current.values,expectedVersion:current.editVersion,startsAt:new Date(Date.now()-3600_000).toISOString(),endsAt:new Date(Date.now()+3600_000).toISOString()});
   const door=new Door({db:database,client});assert.ok((await door.manualCheckin(staff,r.id,'Guest requested manual entry')).checkinId);
   // Synthetic fixture expiry in the disposable database; no production timestamps are modified.
   await q.query("update evidence set established_at=clock_timestamp()-interval '181 days',valid_until=clock_timestamp()-interval '1 second' where account_id=$1 and kind='face'",[guest.accountId]);
   assert.equal((await model.onboarding.getOnboarding(guest)).step,'face_expired');
   await assert.rejects(()=>door.manualCheckin(staff,r.id,'Recheck after expiry'),/VerificationRequired/);
  });
 }finally{await fake.close();}
}
