import { bootstrapApiToken } from "../api-tokens.ts";
import { requireStaffByToken } from "../identity/tokens.ts";
import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import { applicantDrawer } from "../admission/applicants.ts";
import { EventEditor } from "../admission/event-editor.ts";
import { Requests } from "../admission/requests.ts";
import { retainRequestData } from "../admission/retention.ts";
import { queryable,withTx } from "../db/tx.ts";
import { DiditClient } from "../didit/client.ts";
import { fakeDiditServer } from "../didit/fake-server.ts";
import type { DiditDecision } from "../didit/types.ts";
import { FACE_WORKFLOW_ID,type ConsentInput,type EventChecks } from "../domain/event-model.ts";
import type { GuestPrincipal,StaffPrincipal } from "../domain/services.ts";
import { planWorkflow } from "../domain/workflow-plan.ts";
import { createIdentityServices } from "../identity/index.ts";
import { testDatabase } from "../testing/database.ts";
import { skipPostgres } from "../testing/postgres.ts";
import { createModelServices } from "./model-runtime.ts";
import { applyModelDecision } from "./model-verification.ts";
import { adoptSessionInTx } from "./session-binding.ts";

const consent:ConsentInput={disclosureVersion:"events-profile-v2",shareProfileWithHosts:true,eventConsentAccepted:true,acceptedChecks:["face","phone","id_document","name_from_id","age"]};
describe.each(["pglite",...(skipPostgres?[]:["postgres"])] as const)("request-time proof and recovery contracts (%s)",driver=>{
 let database:Awaited<ReturnType<typeof testDatabase>>,fake:Awaited<ReturnType<typeof fakeDiditServer>>,model:ReturnType<typeof createModelServices>,requests:Requests,guest:GuestPrincipal,staff:StaffPrincipal,faceSession:string;
 const q=()=>queryable(database.db);
 beforeAll(async()=>{
  database=await testDatabase(driver as "pglite"|"postgres");fake=await fakeDiditServer();const client=new DiditClient({apiKey:"fake",fetch:fake.fetch});
  model=createModelServices({db:database.db,client,appUrl:"https://events.test"});requests=new Requests(database.db);
  const identity=createIdentityServices({db:database.db,didit:client,secret:"s".repeat(40)}),sent=await identity.auth.sendOtp("proof@example.test","ip");
  const login=await identity.auth.checkOtp(sent.challengeId,"481903",{otpCookie:sent.cookie,consent});guest=login.principal;
  await model.onboarding.saveOnboardingProfile(guest,{expectedProfileVersion:1,fullName:"Alex Smith",headline:"Builder",company:"Independent",jobRole:"",bio:"Building things.",links:[{kind:"website",label:"Website",href:"https://example.test/"}]});
  faceSession=[...fake.decisions.keys()][0]!;await decide(faceSession,{liveness_checks:[{status:"Approved",matches:[],warnings:[]}]});
  staff={principal:"staff",email:"owner@didit.me",role:"owner",sessionId:randomUUID()};await q().query("insert into staff(email,role) values($1,'owner')",[staff.email]);
  await q().query("insert into sessions(id,token_hash,principal,auth_method,staff_email,expires_at) values($1,$2,'staff','email_otp',$3,clock_timestamp()+interval '1 day')",[staff.sessionId,randomUUID(),staff.email]);
 },60000);
 afterAll(async()=>{await fake?.close();await database?.close();});
 async function decide(sessionId:string,proofs:Partial<DiditDecision>) {
  const pending=fake.decisions.get(sessionId)!,at=new Date().toISOString();fake.decisions.set(sessionId,{...pending,...proofs,status:"Approved",events:[{event_type:"SESSION_STATUS_CHANGED",feature_step:null,created_at:at,details:{current_status:"Approved"}}]});
  return withTx(tx=>applyModelDecision(tx,guest.accountId,sessionId,model.verification.options.client),database.db);
 }
 async function event(checks:EventChecks) {
  const editor=new EventEditor(database.db);
  const created=await editor.create(staff,{name:"Proof fixture",description:"",descriptionMd:"",startsAt:new Date(Date.now()+86400_000).toISOString(),endsAt:new Date(Date.now()+90000_000).toISOString(),timezone:"UTC",venue:"HQ",address:"Street",placeId:null,lat:null,lng:null,mapsUrl:null,capacity:3,checks,door:{kiosk:false},form:{version:1,mode:"request",closes_at:null,waitlist:true,fields:{phone_number:"off"},questions:[],consent_text:null},emails:{version:1,templates:{}},cover:{kind:"theme",theme:"aqua"}});
  return editor.lifecycle(staff,created.eventId,"publish",created.editVersion);
 }
 async function draft(eventId:string) {return requests.saveRequestDraft(guest,eventId,{expectedVersion:1,policyVersion:1,formVersion:1,application:{fields:{},answers:{}},consent});}
 const matches=()=>[{session_id:faceSession,similarity_percentage:96,is_blocklisted:false,api_service:null,status:"Approved"}];
 async function ensure(check:"phone"|"age"|"id_document",minimum?:number,alternative=false) {
  const plan=planWorkflow([{check,reason:"absent"}],{baselineReady:true,ageMinimum:minimum,idFallbackConsented:alternative});if(plan.kind!=="extras")throw new Error("Expected extras");return model.verification.registry.ensure(plan);
 }
 it("runs only phone for phone, rejects null timestamps, binds to account and reuses without another session",async()=>{
  await ensure("phone");const e=await event({version:1,required:["phone"],max_age:{}}),saved=await draft(e.eventId);
  const launch=await model.verification.startRequestChecks(guest,e.eventId,saved.draft!.id,{expectedPolicyVersion:1,consent});expect(launch.state).toBe("ready");
  const session=[...fake.decisions.values()].find(d=>d.workflow_id!==FACE_WORKFLOW_ID)!;
  // Another event needing the same workflow sees the operation this account already has open (it is resumed, not duplicated).
  const other=await event({version:1,required:["phone"],max_age:{}});
  expect((await requests.getRequestContext(guest,other.eventId)).checksOperation).toMatchObject({id:launch.state==="ready"?launch.opId:"",state:"active"});
  await ensure("id_document");expect((await requests.getRequestContext(guest,(await event({version:1,required:["id_document"],max_age:{}})).eventId)).checksOperation).toBeNull();
  await decide(session.session_id,{phone_verifications:[{status:"Approved",full_number:"+34600600600",verified_at:null}]});expect((await requests.getRequestContext(guest,e.eventId)).canSubmit).toBe(false);
  await decide(session.session_id,{phone_verifications:[{status:"Approved",full_number:"+34600600600",verified_at:new Date().toISOString()}]});
  expect((await requests.getRequestContext(guest,e.eventId)).canSubmit).toBe(true);
  const [proof]=await q().query("select binding,subject_face_id,value from evidence where kind='phone'");expect(proof).toMatchObject({binding:"account",subject_face_id:null,value:{e164:"+34600600600"}});
  const before=fake.count("POST","/v3/session/");expect(await model.verification.startRequestChecks(guest,e.eventId,saved.draft!.id,{expectedPolicyVersion:1,consent})).toEqual({state:"not_needed"});expect(fake.count("POST","/v3/session/")).toBe(before);
 });
 it("does not round an age failure and accepts an explicitly consented ID alternative bound to the enrolled face",async()=>{
  await ensure("age",18);const e=await event({version:1,required:[],age_min:18,max_age:{}}),saved=await draft(e.eventId);
  const launch=await model.verification.startRequestChecks(guest,e.eventId,saved.draft!.id,{expectedPolicyVersion:1,consent});expect(launch.state).toBe("ready");
  const [op]=await q().query<{didit_session_id:string}>("select didit_session_id from verification_ops where origin_event_id=$1",[e.eventId]);
  await decide(op!.didit_session_id,{liveness_checks:[{status:"Approved",matches:matches(),warnings:[],age_estimation:17.99}]});
  const underage=await requests.getRequestContext(guest,e.eventId);
  expect(underage.missing).toContainEqual({check:"age",reason:"below_minimum",minimum:18});
  // Didit approved the check, the requirement is still unmet: the context carries the completed operation (the client says "not eligible").
  expect(underage).toMatchObject({nextAction:"extras",checksOperation:{id:launch.state==="ready"?launch.opId:"",state:"completed"}});
  expect((await model.verification.startRequestChecks(guest,e.eventId,saved.draft!.id,{expectedPolicyVersion:1,consent})).state).toBe("blocked");
  await model.verification.startRequestChecks(guest,e.eventId,saved.draft!.id,{expectedPolicyVersion:1,consent,idFallbackConsented:true});
  const ops=await q().query<{didit_session_id:string}>("select didit_session_id from verification_ops where origin_event_id=$1 order by created_at desc",[e.eventId]);
  for(const proofs of [
    {id_verifications:[],face_matches:[{status:"Approved"}]},
    {id_verifications:[{status:"Approved",full_name:"",date_of_birth:"2000-01-01"}],face_matches:[{status:"Approved"}]},
    {id_verifications:[{status:"Approved",full_name:"Alex Smith",date_of_birth:"2000-01-01"}],face_matches:[{status:"Declined"}]},
  ]) {
    const result=await decide(ops[0]!.didit_session_id,{...proofs,liveness_checks:[{status:"Approved",matches:matches(),warnings:[],age_estimation:99}]});
    expect(result.evidence).toEqual([]);
    expect((await requests.getRequestContext(guest,e.eventId)).canSubmit).toBe(false);
  }
  await decide(ops[0]!.didit_session_id,{liveness_checks:[{status:"Approved",matches:matches(),warnings:[]}],face_matches:[{status:"Approved"}],id_verifications:[{status:"Approved",full_name:"Alex Smith",date_of_birth:"2000-01-01",expiration_date:"2035-01-01"}]});
  expect((await requests.getRequestContext(guest,e.eventId)).canSubmit).toBe(true);
  expect(await q().query("select id from evidence where verification_id=(select verification_id from verification_ops where didit_session_id=$1) and kind='face'",[ops[0]!.didit_session_id])).toHaveLength(0);
  const nameEvent=await event({version:1,required:["name_from_id"],age_min:18,max_age:{}});expect((await requests.getRequestContext(guest,nameEvent.eventId)).canSubmit).toBe(true);
  const profile=await model.onboarding.getOnboarding(guest);await model.onboarding.saveOnboardingProfile(guest,{expectedProfileVersion:profile.profileVersion,fullName:"Different Name"});
  expect((await requests.getRequestContext(guest,nameEvent.eventId)).missing).toEqual([{check:"name_from_id",reason:"name_mismatch"}]);
  await model.onboarding.saveOnboardingProfile(guest,{expectedProfileVersion:profile.profileVersion+1,fullName:"Alex Smith"});
 });
 it("keeps a combined check's operation once part of it passed, never an unrelated or another account's one",async()=>{
  const client=model.verification.options.client,identity=createIdentityServices({db:database.db,didit:client,secret:"s".repeat(40)});
  const enrol=async(email:string)=>{
   const sent=await identity.auth.sendOtp(email,`${email}-ip`),{principal}=await identity.auth.checkOtp(sent.challengeId,"481903",{otpCookie:sent.cookie,consent});
   await model.onboarding.saveOnboardingProfile(principal,{expectedProfileVersion:1,fullName:"Combo Guest",headline:"Engineer",company:"Test",bio:"Building.",links:[{kind:"website",label:"Site",href:"https://example.test"}]});
   const face=[...fake.decisions.values()].find(d=>d.vendor_data===email)!;
   fake.decisions.set(face.session_id,{...face,status:"Approved",liveness_checks:[{status:"Approved",matches:[],warnings:[]}],events:[{event_type:"SESSION_STATUS_CHANGED",feature_step:null,created_at:new Date().toISOString(),details:{current_status:"Approved"}}]});
   await withTx(tx=>applyModelDecision(tx,principal.accountId,face.session_id,client),database.db);
   return {principal,faceSession:face.session_id};
  };
  const a=await enrol("combo-a@example.test"),b=await enrol("combo-b@example.test");
  const plan=planWorkflow([{check:"phone",reason:"absent"},{check:"age",reason:"absent"}],{baselineReady:true,ageMinimum:18,idFallbackConsented:false});
  if(plan.kind!=="extras")throw new Error("Expected extras");await model.verification.registry.ensure(plan);
  const e=await event({version:1,required:["phone"],age_min:18,max_age:{}});
  const saved=await requests.saveRequestDraft(a.principal,e.eventId,{expectedVersion:1,policyVersion:1,formVersion:1,application:{fields:{},answers:{}},consent});
  const launch=await model.verification.startRequestChecks(a.principal,e.eventId,saved.draft!.id,{expectedPolicyVersion:1,consent});
  if(launch.state!=="ready")throw new Error("Expected a launch");
  const [op]=await q().query<{didit_session_id:string;expected_checks:string[]}>("select didit_session_id,expected_checks from verification_ops where id=$1",[launch.opId]);
  expect(op!.expected_checks).toEqual(["phone","age"]);
  const pending=fake.decisions.get(op!.didit_session_id)!;
  fake.decisions.set(op!.didit_session_id,{...pending,status:"Approved",phone_verifications:[{status:"Approved",full_number:"+34600600601",verified_at:new Date().toISOString()}],
   liveness_checks:[{status:"Approved",matches:[{session_id:a.faceSession,similarity_percentage:96,is_blocklisted:false,api_service:null,status:"Approved"}],warnings:[],age_estimation:17.5}],
   events:[{event_type:"SESSION_STATUS_CHANGED",feature_step:null,created_at:new Date().toISOString(),details:{current_status:"Approved"}}]});
  await withTx(tx=>applyModelDecision(tx,a.principal.accountId,op!.didit_session_id,client),database.db);
  // Phone passed, age did not: the age alone now maps to another workflow, the operation that ran both is still the one shown.
  const underage=await requests.getRequestContext(a.principal,e.eventId);
  expect(underage.missing).toEqual([{check:"age",reason:"below_minimum",minimum:18}]);
  expect(underage).toMatchObject({nextAction:"extras",checksOperation:{id:launch.opId,state:"completed"}});
  // An event that needs none of the checks it ran does not pick it up.
  expect((await requests.getRequestContext(a.principal,(await event({version:1,required:["id_document"],max_age:{}})).eventId)).checksOperation).toBeNull();
  // Another account missing the same checks never sees it.
  const other=await requests.getRequestContext(b.principal,e.eventId);
  expect(other.missing.map(m=>m.check).sort()).toEqual(["age","phone"]);
  expect(other.checksOperation).toBeNull();
  // An age-only operation opened from another event overlaps: without a pin the live one wins (the overlap pick) and hides
  // the settled phone+age outcome; the tab that launched the phone+age check pins it and sees its under-age outcome.
  const otherEvent=await event({version:1,required:[],age_min:21,max_age:{}});
  // Fixture operations reuse the launched one's registered workflow (the binding guard requires a registered one).
  const insertOp=async(accountId:string,checks:string[],eventId:string)=>(await q().query<{id:string}>(`insert into verification_ops(account_id,workflow_id,workflow_key,kind,purpose,vendor_data,email_at_creation,expected_checks,origin_event_id,origin_policy_version,consent,state,expires_at)
   select $1,workflow_id,workflow_key,'extras','event_checks','fixture','fixture@example.test',$3::text[],$4,1,consent,'active',clock_timestamp()+interval '1 day' from verification_ops where id=$2 returning id`,[accountId,launch.opId,checks,eventId]))[0]!.id;
  const ageOnly=await insertOp(a.principal.accountId,["age"],otherEvent.eventId);
  expect((await requests.getRequestContext(a.principal,e.eventId)).checksOperation).toMatchObject({id:ageOnly,state:"active"});
  expect(await requests.getRequestContext(a.principal,e.eventId,{checksOp:launch.opId})).toMatchObject({nextAction:"extras",missing:[{check:"age",reason:"below_minimum",minimum:18}],checksOperation:{id:launch.opId,state:"completed"}});
  // A pin that is another account's operation, another purpose's (a's face check) or unknown is ignored: the overlap pick stands.
  const foreign=await insertOp(b.principal.accountId,["phone","age"],e.eventId);
  const [face]=await q().query<{id:string}>("select id from verification_ops where account_id=$1 and purpose='onboarding' limit 1",[a.principal.accountId]);
  for(const pin of [foreign,face!.id,randomUUID()])expect((await requests.getRequestContext(a.principal,e.eventId,{checksOp:pin})).checksOperation).toMatchObject({id:ageOnly,state:"active"});
  expect((await requests.getRequestContext(b.principal,e.eventId,{checksOp:launch.opId})).checksOperation).toMatchObject({id:foreign});
 });
 it("repairs a legacy request without changing its state and expires host access after retention",async()=>{
  const e=await event({version:1,required:[],max_age:{}});
  const [r]=await q().query<{id:string}>("insert into registrations(account_id,event_id,legacy_imported,policy_version,form_version) values($1,$2,true,1,1) returning id",[guest.accountId,e.eventId]);
  const context=await requests.getRequestContext(guest,e.eventId);expect(context.canSubmit).toBe(true);
  const saved=await requests.submitRequest(guest,e.eventId,{expectedPolicyVersion:1,expectedFormVersion:1,profileVersion:context.onboarding.profileVersion,application:context.prefill,consent,joinWaitlist:false,idempotencyKey:randomUUID()});expect(saved.registration).toMatchObject({id:r!.id,admission:"pending"});
  await q().query("update events set starts_at=clock_timestamp()-interval '92 days',ends_at=clock_timestamp()-interval '91 days',status='ended' where id=$1",[e.eventId]);
  await expect(applicantDrawer(staff,e.eventId,r!.id,database.db)).rejects.toMatchObject({code:"retained_data_expired"});
  expect(await retainRequestData(database.db)).toBe(1);expect(await retainRequestData(database.db)).toBe(0);
  expect(await q().query("select application_v2,request_receipt,staff_note from registrations where id=$1",[r!.id])).toEqual([{application_v2:null,request_receipt:null,staff_note:null}]);
 });
 it("lets a live staff token recover evidence without a session UUID, audits the email and fences revocation",async()=>{
  const issued=await bootstrapApiToken(staff.email,"evidence review",database.db),actor=await requireStaffByToken(issued.token,["owner"],database.db);
  expect(actor.sessionId).toBe("");
  const launch=await model.onboarding.ensureFaceSession(guest,{purpose:"re_enrolment",consent});expect(launch.state).toBe("ready");
  const [op]=await q().query<{verification_id:string;didit_session_id:string}>("select verification_id,didit_session_id from verification_ops where account_id=$1 and purpose='re_enrolment' order by created_at desc limit 1",[guest.accountId]);
  await decide(op!.didit_session_id,{liveness_checks:[{status:"Approved",matches:[],warnings:[]}]});
  expect(await q().query("select activation from evidence where verification_id=$1 and kind='face'",[op!.verification_id])).toEqual([{activation:"pending_continuity"}]);
  await model.verification.recoverFace(actor,op!.verification_id,"Checked the guest identity at reception");
  expect(await q().query("select activation,recovered_by from evidence where verification_id=$1 and kind='face'",[op!.verification_id])).toEqual([{activation:"active",recovered_by:staff.email}]);
  expect(await q().query("select actor from audit where action='evidence_recovered' and target=$1",[op!.verification_id])).toEqual([{actor:staff.email}]);
  await q().query("update api_tokens set revoked_at=clock_timestamp() where id=$1",[actor.apiTokenId]);
  await expect(model.verification.recoverFace(actor,op!.verification_id,"Repeat after revocation")).rejects.toThrow("Forbidden");
 });
 it("recovers a lost create response only when the operation has one authoritative candidate",async()=>{
  const identity=createIdentityServices({db:database.db,didit:model.verification.options.client,secret:"s".repeat(40)});
  const sent=await identity.auth.sendOtp("lost-create@example.test","another-ip");fake.control.dropNextCreate=true;
  const login=await identity.auth.checkOtp(sent.challengeId,"481903",{otpCookie:sent.cookie,consent});
  const [op]=await q().query<{id:string;didit_session_id:string|null}>("select id,didit_session_id from verification_ops where account_id=$1",[login.principal.accountId]);
  expect(op!.didit_session_id).toBeNull();
  const remote=[...fake.decisions.values()].find(d=>d.vendor_data==="lost-create@example.test")!;
  const duplicate={...remote,session_id:randomUUID()};fake.decisions.set(duplicate.session_id,duplicate);
  expect(await model.verification.adoptDiscoveredSession(op!.id,remote.session_id)).toBe(false);
  expect(await q().query("select id from verifications where account_id=$1",[login.principal.accountId])).toHaveLength(0);
  fake.decisions.delete(duplicate.session_id);
  const client=model.verification.options.client,page=await client.listSessions({workflow_id:remote.workflow_id!,vendor_data:remote.vendor_data!});
  const listing=vi.spyOn(client,"listSessions").mockResolvedValue({...page,next:"more"});
  try {
   expect(await model.verification.adoptDiscoveredSession(op!.id,remote.session_id)).toBe(false);
   expect(listing).toHaveBeenCalledTimes(5);
   expect(await q().query("select didit_session_id from verification_ops where id=$1",[op!.id])).toEqual([{didit_session_id:null}]);
  } finally {listing.mockRestore();}
  // A local account change during the unlocked provider lookup must fence adoption.
  await withTx(async tx=>{
   const queries=vi.spyOn(tx,"query"),list=vi.spyOn(client,"listSessions").mockImplementationOnce(async()=>{
    expect(queries.mock.calls.some(([sql])=>sql.includes("pg_advisory_xact_lock"))).toBe(false);
    await tx.query("update accounts set deleting_at=clock_timestamp() where id=$1",[login.principal.accountId]);
    return page;
   });
   try {expect(await adoptSessionInTx(tx,op!.id,remote,client)).toBe(false);}
   finally {list.mockRestore();queries.mockRestore();}
   await tx.query("update accounts set deleting_at=null where id=$1",[login.principal.accountId]);
  },database.db);
  let pages=0;
  const lastPage=vi.spyOn(client,"listSessions").mockImplementation(async()=>({...page,next:++pages<5?"more":null}));
  try {
   expect(await model.verification.adoptDiscoveredSession(op!.id,remote.session_id)).toBe(true);
   expect(lastPage).toHaveBeenCalledTimes(5);
  } finally {lastPage.mockRestore();}
  expect(await model.verification.adoptDiscoveredSession(op!.id,remote.session_id)).toBe(true);
  expect(await model.verification.adoptDiscoveredSession(op!.id,remote.session_id)).toBe(true);
  expect(await q().query("select didit_session_id from verification_ops where id=$1",[op!.id])).toEqual([{didit_session_id:remote.session_id}]);
 });
 it.each([[-1,true],[0,true],[1,false]] as const)("judges a delayed face approval %s ms from operation expiry by approval time",async(offset,accepted)=>{
  const client=model.verification.options.client,identity=createIdentityServices({db:database.db,didit:client,secret:"s".repeat(40)});
  const email=`late-face-${offset}@example.test`,sent=await identity.auth.sendOtp(email,`late-ip-${offset}`);
  const login=await identity.auth.checkOtp(sent.challengeId,"481903",{otpCookie:sent.cookie,consent});
  const pending=[...fake.decisions.values()].find(d=>d.vendor_data===email)!;
  const expires=new Date(Date.now()-10000),created=new Date(expires.getTime()-60000),approvedAt=new Date(expires.getTime()+offset);
  await q().query("update verification_ops set created_at=$2,expires_at=$3,state='expired' where didit_session_id=$1",[pending.session_id,created,expires]);
  fake.decisions.set(pending.session_id,{...pending,created_at:created.toISOString(),status:"Approved",liveness_checks:[{status:"Approved",matches:[],warnings:[]}],events:[{event_type:"SESSION_STATUS_CHANGED",feature_step:null,created_at:approvedAt.toISOString(),details:{current_status:"Approved"}}]});
  const result=await withTx(tx=>applyModelDecision(tx,login.principal.accountId,pending.session_id,client),database.db);
  expect(result.evidence).toHaveLength(accepted?1:0);
  if(accepted)expect(result.evidence[0]).toMatchObject({kind:"face",activation:"active",establishedAt:approvedAt});
  else expect(result.verification.status).toBe("in_review");
 });
 it("a declined onboarding face shows the retry state and a fresh approved session completes it",async()=>{
  const client=model.verification.options.client,identity=createIdentityServices({db:database.db,didit:client,secret:"s".repeat(40)});
  const sent=await identity.auth.sendOtp("retry-face@example.test","retry-ip");
  const login=await identity.auth.checkOtp(sent.challengeId,"481903",{otpCookie:sent.cookie,consent});
  const principal=login.principal;
  await model.onboarding.saveOnboardingProfile(principal,{expectedProfileVersion:1,fullName:"Retry Guest",headline:"Engineer",company:"Test",bio:"Building.",links:[{kind:"website",label:"Site",href:"https://example.test"}]});
  const pending=[...fake.decisions.values()].find(d=>d.vendor_data==="retry-face@example.test")!;
  fake.decisions.set(pending.session_id,{...pending,status:"Declined",liveness_checks:[{status:"Declined",matches:[],warnings:[]}]});
  await withTx(tx=>applyModelDecision(tx,principal.accountId,pending.session_id,client),database.db);
  expect(await model.onboarding.getOnboarding(principal)).toMatchObject({step:"face_failed",canRequest:false,operation:{state:"failed"}});
  const [declinedOp]=await q().query<{id:string}>("select id from verification_ops where didit_session_id=$1",[pending.session_id]);
  const before=fake.count("POST","/v3/session/");
  // A delayed verification.create outbox delivery must finish, never retry a terminal decline.
  expect(await model.verification.launch(declinedOp!.id)).toEqual({state:"not_needed"});
  expect(fake.count("POST","/v3/session/")).toBe(before);
  expect((await model.onboarding.ensureFaceSession(principal,{purpose:"onboarding",consent})).state).toBe("ready");
  const retry=[...fake.decisions.values()].find(d=>d.vendor_data===pending.vendor_data && d.session_id!==pending.session_id)!;
  expect(retry).toBeDefined();
  fake.decisions.set(retry.session_id,{...retry,status:"Approved",liveness_checks:[{status:"Approved",matches:[],warnings:[]}],events:[{event_type:"SESSION_STATUS_CHANGED",feature_step:null,created_at:new Date().toISOString(),details:{current_status:"Approved"}}]});
  await withTx(tx=>applyModelDecision(tx,principal.accountId,retry.session_id,client),database.db);
  expect(await model.onboarding.getOnboarding(principal)).toMatchObject({step:"complete",canRequest:true,operation:{state:"completed"}});
 });

});
