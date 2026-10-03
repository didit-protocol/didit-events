import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { renderSafeMarkdown } from "../content/markdown.ts";
import { queryable,withTx } from "../db/tx.ts";
import { DiditClient } from "../didit/client.ts";
import { fakeDiditServer } from "../didit/fake-server.ts";
import { FACE_WORKFLOW_ID,type ConsentInput } from "../domain/event-model.ts";
import type { GuestPrincipal,StaffPrincipal } from "../domain/services.ts";
import { createIdentityServices } from "../identity/index.ts";
import { eventEmailCodeSchema } from "../domain/event-model.ts";
import { bindEmail,enqueueEmail } from "../notifications/email.ts";
import { EventEmailsService } from "../notifications/event-emails.ts";
import { emailPreviewConfigFromEnv } from "../notifications/index.ts";
import { testDatabase } from "../testing/database.ts";
import { skipPostgres } from "../testing/postgres.ts";
import { createModelServices } from "../verification/model-runtime.ts";
import { applyModelDecision } from "../verification/model-verification.ts";
import { Admissions } from "./admission.ts";
import { applicantDrawer } from "./applicants.ts";
import { EventEditor } from "./event-editor.ts";
import { Requests } from "./requests.ts";
const consent:ConsentInput={disclosureVersion:"events-profile-v2",shareProfileWithHosts:true,eventConsentAccepted:true,acceptedChecks:["face"]};
describe.each(["pglite", ...(skipPostgres ? [] : ["postgres"])] as const)("v2 onboarding and request path with fake Didit (%s)",(driver)=>{
 let database:Awaited<ReturnType<typeof testDatabase>>,fake:Awaited<ReturnType<typeof fakeDiditServer>>,guest:GuestPrincipal,staff:StaffPrincipal,eventId:string,requestId:string;
 let identity:ReturnType<typeof createIdentityServices>,model:ReturnType<typeof createModelServices>,requests:Requests;
 beforeAll(async()=>{
  database=await testDatabase(driver as "pglite" | "postgres");fake=await fakeDiditServer();
  const client=new DiditClient({apiKey:"fake",fetch:fake.fetch});
  identity=createIdentityServices({db:database.db,didit:client,secret:"s".repeat(40),appUrl:"https://events.test"});
  model=createModelServices({db:database.db,client,appUrl:"https://events.test"});requests=new Requests(database.db);
  staff={principal:"staff",email:"admin@didit.me",role:"admin",sessionId:randomUUID()};
  const q=queryable(database.db);await q.query("insert into staff(email,role) values($1,'admin')",[staff.email]);
  await q.query("insert into sessions(id,token_hash,principal,auth_method,staff_email,expires_at) values($1,$2,'staff','email_otp',$3,now()+interval '1 day')",[staff.sessionId,randomUUID(),staff.email]);
 },60000);
 afterAll(async()=>{await fake?.close();await database?.close();});
 it("proves email, immediately creates one email-addressed liveness session, then completes profile and face",async()=>{
  const challenge=await identity.auth.sendOtp("Alex@Example.com","127.0.0.1");
  const result=await identity.auth.checkOtp(challenge.challengeId,"481903",{otpCookie:challenge.cookie,consent});guest=result.principal;
  expect(result.onboarding.step).toBe("profile_required");expect(result.faceLaunch.state).toBe("ready");
  const create=fake.calls.filter(c=>c.method==="POST"&&c.path==="/v3/session/");expect(create).toHaveLength(1);expect(create[0]!.body).toMatchObject({workflow_id:FACE_WORKFLOW_ID,vendor_data:"alex@example.com"});
  await model.onboarding.saveOnboardingProfile(guest,{expectedProfileVersion:1,fullName:"Alex Smith",headline:"Builder",company:"Example",jobRole:"Founder",bio:"I build software.",links:[{kind:"website",label:"Website",href:"https://example.com"}]});
  const decision=[...fake.decisions.values()][0]!,at=new Date().toISOString();
  fake.decisions.set(decision.session_id,{...decision,status:"Approved",liveness_checks:[{status:"Approved",matches:[],warnings:[]}],events:[{event_type:"SESSION_STATUS_CHANGED",feature_step:null,created_at:at,details:{current_status:"Approved"}}]});
  await withTx(tx=>applyModelDecision(tx,guest.accountId,decision.session_id,model.verification.options.client),database.db);
  expect((await model.onboarding.getOnboarding(guest)).step).toBe("complete");
  await model.onboarding.ensureFaceSession(guest,{purpose:"onboarding",consent});expect(fake.count("POST","/v3/session/")).toBe(1);
 });
 it("creates a canonical draft event; submits once; approval sends ready mail without provider work",async()=>{
  const editor=new EventEditor(database.db),start=new Date(Date.now()+86400_000),end=new Date(start.getTime()+3600_000);
  const draft=await editor.create(staff,{name:"Meetup",description:"Meet builders",descriptionMd:"## Hello\n<script>alert(1)</script>",startsAt:start.toISOString(),endsAt:end.toISOString(),timezone:"UTC",venue:"HQ",address:"One Street",placeId:null,lat:null,lng:null,mapsUrl:null,capacity:2,checks:{version:1,required:[],max_age:{}},door:{kiosk:false},form:{version:1,mode:"request",closes_at:null,waitlist:true,fields:{phone_number:"off"},questions:[],consent_text:null},emails:{version:1,templates:{}},cover:{kind:"theme",theme:"aqua"}});
  eventId=draft.eventId;await editor.lifecycle(staff,eventId,"publish",draft.editVersion);
  const context=await requests.getRequestContext(guest,eventId);expect(context.canSubmit).toBe(true);
  const input={expectedPolicyVersion:1,expectedFormVersion:1,profileVersion:2,application:{fields:{},answers:{}},consent,joinWaitlist:false,idempotencyKey:randomUUID()};
  const saved=await requests.submitRequest(guest,eventId,input);requestId=saved.registration.id;expect(saved.registration.admission).toBe("pending");
  expect((await requests.submitRequest(guest,eventId,input)).replayed).toBe(true);
  await new Admissions(database.db).decide(staff,requestId,"approved");
  expect(fake.count("POST","/v3/session/")).toBe(1);
  expect(await queryable(database.db).query("select kind from outbox where kind='verify_invite'")).toHaveLength(0);
  expect(await queryable(database.db).query("select id from outbox where kind='email:M-06'")).toHaveLength(1);
  const drawer=await applicantDrawer(staff,eventId,requestId,database.db);expect(drawer.profile.fullName).toBe("Alex Smith");expect(drawer.readiness).toBe("ready");
  await expect(editor.save(staff,eventId,{...draft.values,expectedVersion:1})).rejects.toThrow("context_changed");
 });
 it("uses safe Markdown and supports audited idempotent test mail to any address with a quota",async()=>{
  expect(renderSafeMarkdown('# Head\n[bad](javascript:alert(1))\n![x](https://user:pass@x.test/a)')).not.toMatch(/<h1|href="javascript|src="https:\/\/user/);
  const service=new EventEmailsService({db:database.db,baseUrl:"https://events.test",from:"Didit Events <events@updates.didit.me>",resend:{apiKey:"fake"}}),editor=await new EventEditor(database.db).view(staff,eventId);
  for(const template of eventEmailCodeSchema.options) {
    const preview=await service.preview(staff,eventId,{template,preview:{kind:"sample"},expectedEventVersion:editor.editVersion});
    expect(preview.html).toMatch(/<!doctype html/i);
    expect(preview.text).not.toMatch(/481903|3f1c9a2e/);
    expect(preview.from).toContain("events@updates.didit.me");
  }
  const input={template:"M-06",to:"outside@elsewhere.test",preview:{kind:"sample"},expectedEventVersion:editor.editVersion,idempotencyKey:randomUUID()};
  const a=await service.test(staff,eventId,input);expect(a.status).toBe("queued");expect(await service.test(staff,eventId,input)).toEqual(a);
  for(let i=0;i<9;i++)await service.test(staff,eventId,{...input,idempotencyKey:randomUUID()});
  await expect(service.test(staff,eventId,{...input,idempotencyKey:randomUUID()})).rejects.toThrow("rate_limited");
  expect((await service.preview(staff,eventId,{template:"M-06",preview:{kind:"guest",registrationId:requestId},expectedEventVersion:editor.editVersion})).text).toContain("Alex");
 });
 it("previews render without a Resend key; a test send needs one and says so, and queues nothing",async()=>{
  const service=new EventEmailsService(emailPreviewConfigFromEnv({APP_URL:"http://localhost:3000"},database.db)),editor=await new EventEditor(database.db).view(staff,eventId);
  expect(service.config.resend.apiKey).toBe("");
  const queued=async()=>(await queryable(database.db).query("select id from outbox where kind='email.test'")).length,before=await queued();
  const preview=await service.preview(staff,eventId,{template:"M-06",preview:{kind:"sample"},expectedEventVersion:editor.editVersion});
  expect(preview.html).toMatch(/<!doctype html/i);expect(preview.from).toContain("events@updates.didit.me");
  const send=service.test(staff,eventId,{template:"M-06",to:"outside@elsewhere.test",preview:{kind:"sample"},expectedEventVersion:editor.editVersion,idempotencyKey:randomUUID()});
  await expect(send).rejects.toMatchObject({code:"provider_unavailable",status:503,message:expect.stringContaining("RESEND_API_KEY")});
  expect(await queued()).toBe(before);
 });
 it("rechecks queued confirmation and renewal state and deduplicates legacy aliases",async()=>{
  const q=queryable(database.db),payload={code:"M-06" as const,accountId:guest.accountId,eventId};
  expect((await bindEmail(q,payload,"https://events.test")).data.renewalNeeded).toBe(false);
  // A local instance binds images it can never serve to an inbox onto the public asset base.
  const local=(await bindEmail(q,payload,"http://localhost:3332")).data as {assetsUrl:string;event:{coverImageUrl:string;url:string}};
  expect(local.assetsUrl).toBe("https://events.didit.me/email");
  expect(local.event.coverImageUrl).toMatch(/^https:\/\/events\.didit\.me\/email\/cover-(aqua|sky)\.jpg$/);
  expect(local.event.url).toMatch(/^http:\/\/localhost:3332\/e\//);
  expect(((await bindEmail(q,payload,"http://localhost:3332",new Date(),"https://cdn.didit.me")).data as {assetsUrl:string}).assetsUrl).toBe("https://cdn.didit.me/email");
  await q.query("update evidence set established_at=clock_timestamp()-interval '1 day',valid_until=clock_timestamp()-interval '1 second' where account_id=$1 and kind='face'",[guest.accountId]);
  expect((await bindEmail(q,payload,"https://events.test")).data).toMatchObject({renewalNeeded:true,renewalChecks:["selfie"]});
  const previewService=new EventEmailsService({db:database.db,baseUrl:"https://events.test",from:"Didit Events <events@updates.didit.me>",resend:{apiKey:"fake"}});
  const e=await new EventEditor(database.db).view(staff,eventId);
  const preview=await previewService.preview(staff,eventId,{template:"M-06",preview:{kind:"guest",registrationId:requestId},expectedEventVersion:e.editVersion});
  expect(preview.text).toContain("selfie");expect(preview.html).toContain("#email-preview");
  const admissions=new Admissions(database.db);
  await admissions.resend(staff,requestId);await admissions.resend(staff,requestId);
  expect(await q.query("select id from outbox where kind='email:M-03'")).toHaveLength(1);

  await q.query("update evidence set valid_until=clock_timestamp()+interval '1 day' where account_id=$1 and kind='face'",[guest.accountId]);
  await expect(bindEmail(q,{...payload,code:"M-03"},"https://events.test")).rejects.toThrow("suppressed_renewal_complete");
  await withTx(async tx=>{
    expect(await enqueueEmail(tx,{code:"E-03",dedupeKey:`email:E-03:${requestId}:alias`,accountId:guest.accountId,eventId})).toBeTruthy();
    expect(await enqueueEmail(tx,{code:"M-02",dedupeKey:`email:M-02:${requestId}:alias`,accountId:guest.accountId,eventId})).toBeNull();
  },database.db);
 });
 it("cancels once and returns authoritative state for a repeated action",async()=>{
  const cancelled=await requests.withdrawOrCancel(guest,requestId,{expectedAdmission:"approved"});expect(cancelled.admission).toBe("cancelled_by_guest");
  expect((await requests.withdrawOrCancel(guest,requestId,{expectedAdmission:"approved"})).admission).toBe("cancelled_by_guest");
  expect(await queryable(database.db).query("select id from outbox where kind='email:M-20'")).toHaveLength(1);
 });
});
