import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createRequire} from 'node:module';
import {bootstrapApiToken} from '../../packages/core/src/api-tokens.ts';
import {DiditClient} from '../../packages/core/src/didit/client.ts';
import {FACE_WORKFLOW_ID} from '../../packages/core/src/domain/event-model.ts';
import {signV2} from '../../packages/core/src/webhook/signature.ts';
import {provisionEventModel} from '../../packages/core/src/verification/provision.ts';
import {fields} from './http.mjs';

const consent={disclosureVersion:'events-profile-v2',shareProfileWithHosts:true,eventConsentAccepted:true,acceptedChecks:['face','phone']};
const from='Didit Events <events@updates.didit.me>', replyTo='events@example.com';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fixture=name=>readFile(new URL(`./fixtures/${name}.jpg`,import.meta.url));

export async function scenario(rt) {
  const {step,until,rpc}=rt;
  await step('fixtures: four distinct real portraits, JPEG decode, hashes and <=60 KB',async()=>{
    const require=createRequire(join(rt.root,'packages/core/package.json')),sharp=require('sharp');
    const manifest=JSON.parse(await readFile(new URL('./fixtures/manifest.json',import.meta.url),'utf8'));
    for(const entry of manifest){const bytes=await readFile(new URL(`./fixtures/${entry.file}`,import.meta.url));assert.equal(hash(bytes),entry.sha256);assert.ok(bytes.length<=60000);assert.equal((await sharp(bytes).metadata()).format,'jpeg');await sharp(bytes).raw().toBuffer();}
    assert.equal(new Set(manifest.filter(m=>m.source).map(m=>m.sha256)).size,4);
    return manifest.map(({file,bytes,sha256})=>({file,bytes,sha256}));
  });
  await step('servers: isolated Events, Didit and captured Resend',()=>rt.boot());
  await step('fake: provision minimal workflows and provider capabilities',async()=>{
    const rows=await provisionEventModel(rt.db,new DiditClient({apiKey:'fake',baseUrl:rt.providers.diditUrl}),[18]);
    assert.equal(rows.length,6);return rows;
  });
  // `door` is the entrance laptop: a separate browser that ends up holding only a door-scoped session.
  const staff=rt.session(),anonymous=rt.session(),door=rt.session();
  let token,event,questionId=randomUUID();
  const mcp=async(name,args={})=>{
    const response=await fetch(`${rt.eventsUrl}/api/mcp`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','mcp-protocol-version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(60000)});
    const body=await response.json();assert.equal(response.status,200);assert.ok(!body.error,JSON.stringify(body));assert.ok(!body.result.isError,JSON.stringify(body));
    assert.deepEqual(JSON.parse(body.result.content[0].text),body.result.structuredContent);return body.result.structuredContent;
  };
  await step('staff: unified admin HTTP session and MCP token',async()=>{
    const response=await staff.request('/api/auth/dev?as=staff&email=events.owner%40didit.me');assert.equal(response.status,307);await response.text();await staff.get('/admin');
    ({token}=await bootstrapApiToken('events.owner@didit.me','journey',rt.db));
    const actor=await mcp('whoami');assert.equal(actor.email,'events.owner@didit.me');return {email:actor.email};
  });
  await step('fake: webhook destination management contract',async()=>{
    const client=new DiditClient({apiKey:'fake',baseUrl:rt.providers.diditUrl});
    const made=await client.createWebhookDestination({label:'Journey',url:`${rt.eventsUrl}/api/webhooks/didit`,webhook_version:'v3',subscribed_events:['status.updated']});
    assert.ok(made.secret_shared_key);assert.ok((await client.listWebhookDestinations()).some(w=>w.uuid===made.uuid));
    assert.equal((await client.patchWebhookDestination(made.uuid,{label:'Journey rotated URL'})).label,'Journey rotated URL');
    await client.deleteWebhookDestination(made.uuid);assert.equal((await client.listWebhookDestinations()).length,0);return {created:1,removed:1};
  });
  const webhook=async(verification,status,{face,phone,bad=false,eventId=randomUUID()}={})=>{
    const decision=await rpc('decision',{sessionId:verification.didit_session_id,status,face,phone});
    const payload={event_id:eventId,session_id:decision.session_id,workflow_id:decision.workflow_id,vendor_data:decision.vendor_data,status,timestamp:Math.floor(Date.now()/1000),created_at:new Date().toISOString(),webhook_type:'status.updated',environment:'sandbox',decision};
    const raw=JSON.stringify(payload),headers={'content-type':'application/json','x-signature-v2':bad?'0'.repeat(64):signV2(raw,rt.webhookSecret),'x-timestamp':String(payload.timestamp)};
    const send=()=>fetch(`${rt.eventsUrl}/api/webhooks/didit`,{method:'POST',headers,body:raw,signal:AbortSignal.timeout(30000)});
    const response=await send();const body=await response.text();
    if(bad){assert.equal(response.status,401,body);return;}
    assert.equal(response.status,200,body);
    await until(async()=>(await rt.q.query('select state from verification_ops where verification_id=$1',[verification.id]))[0]?.state===(status==='Approved'?'completed':'failed'),'decision applied');
    const snapshot=await rpc('snapshot');assert.ok(snapshot.decisionReads.includes(`/v3/session/${decision.session_id}/decision/`),'C-contract decision re-fetch');
    if(face){const media=await fetch(decision.liveness_checks[0].reference_image);assert.equal(media.status,200);assert.equal(hash(Buffer.from(await media.arrayBuffer())),hash(await fixture(face)));}
    return {send,decision,eventId};
  };
  const guests={};
  const signup=async(letter,face,decline=false)=>{
    const session=rt.session(),email=`journey.${letter.toLowerCase()}@example.test`;
    const sent=await session.action('/login','signInAction',[{step:'choose'},fields({intent:'send',email})]);assert.equal(sent.step,'code');
    const verified=await session.action('/login','signInAction',[sent,fields({intent:'verify',email,code:'481903',onboardingConsent:JSON.stringify(consent),next:'/me/events'})]);assert.ok(verified.redirect);
    const [account]=await rt.q.query('select id,email,email_verified_at from accounts where email=$1',[email]);assert.ok(account.email_verified_at);
    const onboarding=await session.api('/api/me/onboarding');assert.equal(onboarding.step,'profile_required');assert.equal(onboarding.canRequest,false);
    const profile={fullName:`Journey Guest ${letter}`,headline:'Engineer',company:'Journey Company',jobRole:'Builder',bio:`Profile for guest ${letter}.`,links:[{kind:'linkedin',label:'LinkedIn',href:`https://www.linkedin.com/in/journey-${letter.toLowerCase()}`} ]};
    await session.api('/api/me/profile','PATCH',{expectedProfileVersion:onboarding.profileVersion,...profile});
    let verification=await until(async()=>(await rt.q.query('select * from verifications where account_id=$1',[account.id]))[0],'face session');
    assert.equal(verification.workflow_id,FACE_WORKFLOW_ID);assert.equal(verification.vendor_data,email);
    const input=(await rpc('snapshot')).createsInput.find(c=>c.vendor_data===email);assert.equal(input.workflow_id,FACE_WORKFLOW_ID);
    if(decline){
      await webhook(verification,'Declined',{face});
      const failed=await session.api('/api/me/onboarding');assert.equal(failed.step,'face_failed');assert.equal(failed.canRequest,false);
      // Flow v3: the deep-link fallback shows the modal's own declined state (never the old stepper).
      const page=await session.get('/onboarding');assert.match(page,/couldn(?:'|&#x27;)t confirm it(?:'|&#x27;)s you/);assert.match(page,/Try again/);assert.ok(!page.includes('STEP 2 OF 3'));
      const retry=await session.api('/api/me/onboarding/face','POST',{purpose:'onboarding',consent,returnTo:'/me/events'});assert.ok(['ready','creating'].includes(retry.state));
      const old=verification.didit_session_id;
      verification=await until(async()=>(await rt.q.query('select * from verifications where account_id=$1 and didit_session_id<>$2',[account.id,old]))[0],'retry session');assert.notEqual(verification.didit_session_id,old);
    }
    const delivered=await webhook(verification,'Approved',{face});
    const complete=await until(async()=>{const row=await session.api('/api/me/onboarding');return row.step==='complete'&&row;},'onboarding complete');
    assert.equal(complete.email.verified,true);assert.equal(complete.face.state,'verified');assert.ok(complete.onboardedAt);assert.deepEqual(complete.profile,profile);
    guests[letter]={session,email,account,profile,face,verification,delivered};
    return {accountId:account.id,email,face,sessionId:verification.didit_session_id,step:complete.step,retried:decline};
  };
  await step('1A: OTP, mandatory profile, liveness-only session, signed face decision',()=>signup('A','johnson'));
  await step('1B: declined face exposes retry; new session approves',()=>signup('B','astronaut',true));
  await step('2: v2 event, Markdown, phone extra, questions, hosts, hidden list, cover, publish',async()=>{
    const values={slug:`journey-${randomUUID().slice(0,8)}`,name:'Journey Event',description:'HTTP journey event',descriptionMd:'## Meet the builders\n\nA **working** journey.\n\n<script>alert(1)</script>',startsAt:new Date(Date.now()+3600_000).toISOString(),endsAt:new Date(Date.now()+7200_000).toISOString(),timezone:'Europe/Madrid',venue:'Didit HQ',address:'Barcelona',capacity:10,
      checks:{version:1,required:['phone'],max_age:{}},door:{kiosk:true,mode:'strict',match_threshold:80},form:{version:1,mode:'request',closes_at:null,waitlist:true,fields:{phone_number:'required'},questions:[{id:questionId,kind:'long',label:'What are you building?',required:true}],consent_text:null},emails:{version:1,templates:{}},cover:{kind:'theme',theme:'aqua',privacy:{guestList:'hidden'}},speakers:[{name:'Journey Host',role:'Host',email:'uma.bramwell@didit.me'}]};
    await rt.q.query("insert into staff(email,role) values('uma.bramwell@didit.me','staff') on conflict do nothing");
    const made=await mcp('event_create',values);assert.ok(made.id);event=made;
    const editor=await staff.api(`/api/admin/events/${event.id}/editor`);assert.match(editor.descriptionHtml,/<h2>Meet the builders<\/h2>/);assert.ok(!editor.descriptionHtml.includes('<script>'));assert.equal(editor.values.cover.privacy.guestList,'hidden');assert.equal(editor.values.speakers[0].name,'Journey Host');
    const form=new FormData();form.set('expectedEventVersion',String(editor.editVersion));form.set('alt','Journey cover');form.set('cover',new Blob([await fixture('astronaut')],{type:'image/jpeg'}),'cover.jpg');
    const upload=await staff.request(`/api/admin/events/${event.id}/cover`,{method:'POST',body:form}),body=await upload.json();assert.equal(upload.status,200,JSON.stringify(body));
    const saved=await staff.api(`/api/admin/events/${event.id}/editor`);assert.equal(saved.values.cover.privacy.guestList,'hidden');
    await staff.api(`/api/admin/events/${event.id}/lifecycle`,'POST',{action:'publish',expectedVersion:saved.editVersion});
    const asset=await anonymous.request(body.data.url);assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/image\//);assert.ok((await asset.arrayBuffer()).byteLength>0);
    return {eventId:event.id,slug:event.slug,cover:body.data.url,door:saved.values.door,hosts:saved.values.speakers};
  });
  const joinGuest=async(letter)=>{
    const guest=guests[letter],session=guest.session;
    let context=await session.api(`/api/events/${event.id}/request`);
    assert.equal(context.onboarding.step,'complete');assert.deepEqual(context.missing.map(m=>m.check),['phone']);assert.deepEqual(new Set(context.missingQuestions),new Set([questionId,'phone_number']));
    assert.ok(context.badges.filter(b=>['email','face'].includes(b.check)).every(b=>b.state==='verified'));
    const phone=`+3460060060${'ABCD'.indexOf(letter)}`,application={fields:{phone_number:phone},answers:{[questionId]:`${letter}: reliable event software`}};
    context=await session.api(`/api/events/${event.id}/request`,'PUT',{policyVersion:context.event.policyVersion,formVersion:context.event.formVersion,expectedVersion:context.draft?.version??1,application,consent});
    const before=(await rpc('snapshot')).creates;
    const launch=await session.api(`/api/events/${event.id}/request/checks`,'POST',{draftId:context.draft.id,expectedPolicyVersion:context.event.policyVersion,consent});assert.ok(['ready','creating'].includes(launch.state));
    const verification=await until(async()=>(await rt.q.query("select v.* from verifications v join verification_ops op on op.verification_id=v.id where v.account_id=$1 and op.purpose='event_checks'",[guest.account.id]))[0],'phone-only extra session');
    assert.notEqual(verification.workflow_id,FACE_WORKFLOW_ID);
    const [registry]=await rt.q.query('select desired_config from didit_workflows where workflow_id=$1',[verification.workflow_id]);assert.deepEqual(registry.desired_config.features.map(f=>f.feature),['PHONE_VERIFICATION']);
    await webhook(verification,'Approved',{phone});
    context=await session.api(`/api/events/${event.id}/request`);assert.deepEqual(context.missing,[]);assert.deepEqual(context.missingQuestions,[]);assert.equal(context.canSubmit,true);
    const input={expectedPolicyVersion:context.event.policyVersion,expectedFormVersion:context.event.formVersion,profileVersion:context.onboarding.profileVersion,application,consent,joinWaitlist:false,idempotencyKey:randomUUID()};
    const saved=await session.api(`/api/events/${event.id}/request/submit`,'POST',input);assert.equal(saved.registration.admission,'pending');assert.equal(saved.replayed,false);
    const replay=await session.api(`/api/events/${event.id}/request/submit`,'POST',input);assert.equal(replay.replayed,true);assert.equal(replay.registration.id,saved.registration.id);
    assert.equal((await rt.q.query('select id from registrations where event_id=$1 and account_id=$2',[event.id,guest.account.id])).length,1);
    assert.equal((await rpc('snapshot')).creates,before+1,'submit never starts another face or extras session');
    guest.registration=saved.registration;
    const drawer=await staff.api(`/api/admin/events/${event.id}/applicants/${saved.registration.id}`);
    for(const [key,value] of Object.entries(guest.profile))assert.deepEqual(drawer.profile[key],value);
    assert.equal(drawer.profile.email,guest.email);assert.ok(drawer.answers.some(a=>a.value===application.answers[questionId]));assert.equal(drawer.readiness,'ready');
    return {registrationId:saved.registration.id,workflowId:verification.workflow_id,missingInitially:['phone',questionId,'phone_number'],replayed:true};
  };
  const mailFor=async(letter,code)=>until(async()=>(await rpc('snapshot')).emails.find(e=>e.body.to.includes(guests[letter].email)&&e.body.tags?.some(t=>t.value===code.replace('-','_'))),`${code} for ${letter}`);
  const assertMail=record=>{assert.equal(record.body.from,from);assert.equal(record.body.reply_to,replyTo);assert.ok(record.body.subject);assert.ok(record.body.html);assert.ok(record.body.text);};
  const approve=async letter=>{await mcp('applicant_approve',{registrationId:guests[letter].registration.id});const mail=await mailFor(letter,'M-06');assertMail(mail);assert.match(mail.body.subject,/you.re in/i);assert.ok(!/verify your|complete verification/i.test(mail.body.text));return mail;};
  // Lane H: one M-25 per request To the first host (the creator = MCP staff actor), the other hosts (the staff speaker) in CC; the events inbox is Reply-To only.
  const hostMail=async letter=>{
    const url=`/admin/events/${event.id}/applicants?applicant=${guests[letter].registration.id}`,hosts=['events.owner@didit.me','uma.bramwell@didit.me'];
    const isHostMail=e=>e.body.tags?.some(t=>t.value==='M_25')&&e.body.text.includes(url);
    const mail=await until(async()=>(await rpc('snapshot')).emails.find(isHostMail),`M-25 host email for ${letter}`);
    assertMail(mail);assert.deepEqual(mail.body.to,[hosts[0]]);assert.deepEqual(mail.body.cc,hosts.slice(1));assert.ok(!mail.body.cc.some(e=>mail.body.to.includes(e)),'To is never repeated in CC');assert.equal(mail.body.subject,`New request: ${guests[letter].profile.fullName} for Journey Event`);
    assert.match(mail.body.html,new RegExp(`href="https?://[^"]+${url.replace(/[?]/g,'\\?')}"`));assert.ok(mail.body.html.includes('Verified by Didit'));
    assert.ok(!/selfie|liveness|biometric/i.test(mail.body.html));
    const all=(await rpc('snapshot')).emails.filter(isHostMail);assert.equal(all.length,1,'one host email per request; the replayed submit sent nothing');assert.ok(![...all[0].body.to,...all[0].body.cc].includes(guests[letter].email));
    return {to:mail.body.to,cc:mail.body.cc,subject:mail.body.subject,reviewUrl:url};
  };
  await step('3: A asks only for missing phone/questions; one submission and replay; full drawer; host email',async()=>({...await joinGuest('A'),hostEmail:await hostMail('A')}));
  await step('3: MCP approval sends ready email, valid logo; hidden public and visible admin list',async()=>{
    const before=(await rpc('snapshot')).creates,mail=await approve('A');assert.equal((await rpc('snapshot')).creates,before);
    const logo=mail.body.html.match(/src="([^"]*didit-logo\.png)"/);assert.ok(logo);const response=await fetch(logo[1]);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/image\//);await response.arrayBuffer();
    const page=await anonymous.get(`/e/${event.slug}`);assert.ok(!page.includes(guests.A.profile.fullName));assert.ok(!page.includes(guests.A.email));
    const list=await mcp('guests_list',{eventId:event.id});assert.ok(JSON.stringify(list).includes(guests.A.email));
    assert.match(await guests.A.session.get(`/me/events/${event.slug}`),/You(?:&#x27;|')re in/);
    return {subject:mail.body.subject,from:mail.body.from,replyTo:mail.body.reply_to,logo:logo[1],publicList:'hidden',adminList:'visible'};
  });
  await step('4: C onboards, requests and withdraws; history and receipt email',async()=>{
    await signup('C','tesla');await joinGuest('C');await mailFor('C','M-02');
    const result=await guests.C.session.api(`/api/registrations/${guests.C.registration.id}/cancel`,'POST',{expectedAdmission:'pending'});assert.equal(result.admission,'cancelled_by_guest');
    const mail=await mailFor('C','M-20');assertMail(mail);assert.match(mail.body.subject,/You withdrew your request/);
    const history=await rt.q.query('select "from","to" from admission_history where registration_id=$1 order by created_at,id',[result.id]);
    assert.ok(history.some(h=>h.from==='pending'&&h.to==='cancelled_by_guest'));
    assert.match(await guests.C.session.get(`/me/events/${event.slug}`),/You withdrew your request/);return {history};
  });
  await step('4: D onboards, approved then cancels within 24h; late flag/history/email',async()=>{
    await signup('D','hopper');await joinGuest('D');await hostMail('D');await approve('D'); // the host notice goes out before the decision (a decided request is not announced)
    const context=await guests.D.session.api(`/api/events/${event.id}/request`);assert.equal(context.registration.withdrawal.late,true);
    const result=await guests.D.session.api(`/api/registrations/${guests.D.registration.id}/cancel`,'POST',{expectedAdmission:'approved'});assert.equal(result.admission,'cancelled_by_guest');
    const mail=await mailFor('D','M-20');assertMail(mail);assert.match(mail.body.subject,/You cancelled your place/);
    const drawer=await staff.api(`/api/admin/events/${event.id}/applicants/${result.id}`);assert.equal(drawer.lateCancellation,true);
    const history=await rt.q.query('select "from","to" from admission_history where registration_id=$1 order by created_at,id',[result.id]);assert.ok(history.some(h=>h.from==='approved'&&h.to==='cancelled_by_guest'));return {history,lateCancellation:true};
  });
  // v5 re-join: the guest who withdrew / cancelled asks again in one tap — no onboarding, no profile, no new checks.
  const requestAgain=async(letter,kind)=>{
    const session=guests[letter].session;
    const context=await session.api(`/api/events/${event.id}/request`);
    assert.equal(context.onboarding.step,'complete');assert.deepEqual(context.missing,[]);assert.deepEqual(context.missingQuestions,[]);assert.equal(context.nextAction,'submit');
    assert.equal(context.registration.rejoin.kind,kind);assert.equal(context.registration.rejoin.canRequest,true);assert.equal(context.registration.rejoin.outcome,'pending');assert.ok(context.registration.rejoin.rule);
    const before=(await rpc('snapshot')).creates;
    const input={...(context.draft?{draftId:context.draft.id}:{}),expectedPolicyVersion:context.event.policyVersion,expectedFormVersion:context.event.formVersion,profileVersion:context.onboarding.profileVersion,application:context.prefill,consent,joinWaitlist:false,idempotencyKey:randomUUID()};
    const saved=await session.api(`/api/events/${event.id}/request/submit`,'POST',input);assert.equal(saved.registration.admission,'pending');assert.equal(saved.registration.id,guests[letter].registration.id);
    const replay=await session.api(`/api/events/${event.id}/request/submit`,'POST',input);assert.equal(replay.replayed,true);
    assert.equal((await rpc('snapshot')).creates,before,'a request again never starts a face or extras session');
    const [row]=await rt.q.query('select admission,reapplication_count from registrations where id=$1',[saved.registration.id]);assert.deepEqual(row,{admission:'pending',reapplication_count:1});
    return {kind,rule:context.registration.rejoin.rule,admission:row.admission,reapplicationCount:row.reapplication_count};
  };
  await step('4R: C withdrew → request again in one tap; withdrawing again leaves it at once (status only)',async()=>{
    const again=await requestAgain('C','withdrew');
    const result=await guests.C.session.api(`/api/registrations/${guests.C.registration.id}/cancel`,'POST',{expectedAdmission:'pending'});assert.equal(result.admission,'cancelled_by_guest');
    const context=await guests.C.session.api(`/api/events/${event.id}/request`);assert.equal(context.nextAction,'status');assert.equal(context.registration.rejoin.canRequest,false);assert.equal(context.registration.rejoin.blockedBy,'once');
    assert.match(await guests.C.session.get(`/me/events/${event.slug}`),/already requested again once/);
    return {...again,afterSecondWithdraw:context.registration.rejoin.blockedBy};
  });
  await step('4R: D cancelled → request the place again: approval again, one fresh host notice',async()=>{
    const again=await requestAgain('D','cancelled');
    const url=`/admin/events/${event.id}/applicants?applicant=${guests.D.registration.id}`;
    await until(async()=>(await rpc('snapshot')).emails.filter(e=>e.body.tags?.some(t=>t.value==='M_25')&&e.body.text.includes(url)).length===2,'one host notice per application for D');
    const drawer=await staff.api(`/api/admin/events/${event.id}/applicants/${guests.D.registration.id}`);assert.equal(drawer.admission,'pending');
    return again;
  });
  await step('5: admin email preview and arbitrary test recipient through captured Resend',async()=>{
    const editor=await staff.api(`/api/admin/events/${event.id}/editor`);
    const preview=await staff.api(`/api/admin/events/${event.id}/emails/preview`,'POST',{template:'M-06',preview:{kind:'guest',registrationId:guests.A.registration.id},expectedEventVersion:editor.editVersion});assert.equal(preview.from,from);assert.equal(preview.replyTo,replyTo);assert.ok(preview.html.includes('Journey'));
    const input={template:'M-06',preview:{kind:'sample'},to:'arbitrary.recipient@example.test',expectedEventVersion:editor.editVersion,idempotencyKey:randomUUID()};
    const sent=await staff.api(`/api/admin/events/${event.id}/emails/test`,'POST',input);const again=await staff.api(`/api/admin/events/${event.id}/emails/test`,'POST',input);assert.equal(again.testId,sent.testId);assert.ok(['queued','sent','delivered'].includes(again.status)); // idempotent: same test; the worker may already have sent it
    await until(async()=>(await staff.api(`/api/admin/events/${event.id}/emails/test/${sent.testId}`)).status==='sent','test sent');
    const emails=(await rpc('snapshot')).emails.filter(e=>e.body.to.includes(input.to));assert.equal(emails.length,1);assertMail(emails[0]);assert.match(emails[0].body.subject,/^\[Test\]/);return {to:input.to,subject:emails[0].body.subject,from};
  });
  await step('6: event live, strict 80; a door operator added from the Team tab starts door mode in Events',async()=>{
    const editor=await staff.api(`/api/admin/events/${event.id}/editor`);
    await staff.api(`/api/admin/events/${event.id}/editor`,'PATCH',{...editor.values,expectedVersion:editor.editVersion,startsAt:new Date(Date.now()-60_000).toISOString(),endsAt:new Date(Date.now()+3600_000).toISOString()});
    const operator='journey.operator@example.test';
    const added=await staff.action(`/admin/events/${event.id}/team`,'addMemberAction',[event.id,{status:'idle'},fields({email:operator,role:'operator'})]);assert.equal(added.status,'saved',JSON.stringify(added));
    await until(async()=>(await rpc('snapshot')).emails.some(e=>e.body.tags?.some(t=>t.value==='M_27')&&e.body.to.includes(operator)),'M-27 team invitation email');
    const signIn=await door.request(`/api/auth/dev?email=${encodeURIComponent(operator)}`);assert.equal(signIn.status,307);await signIn.text();
    // A member reaches only their event, and only what the operator role allows.
    const denied={};for(const path of ['/admin/team','/admin/calendar',`/admin/events/${event.id}/settings`,`/admin/events/${event.id}/team`]){const r=await door.request(path);denied[path]=r.status;assert.equal(r.status,403,path);await r.text();}
    const guestList=await door.request(`/admin/events/${event.id}/guests`);assert.equal(guestList.status,200);await guestList.text();
    const started=await door.json(`/api/door/${event.id}/start`,{station:'Journey door'});assert.equal(started.ok,true);
    assert.ok(door.jar.has('__Host-door'));assert.equal(door.jar.has('__Host-sid'),false,'the admin session is replaced by the door session');
    const elsewhere=await door.request(`/admin/events/${event.id}/guests`);assert.equal(elsewhere.status,307);assert.equal(new URL(elsewhere.headers.get('location'),rt.eventsUrl).pathname,'/login');await elsewhere.text();
    // The device shows the door page; it renders the door-bound CSRF token the door script sends (another page opened in this browser re-binds the shared CSRF cookie).
    const doorPage=await door.get(`/admin/events/${event.id}/door/kiosk`);assert.ok(!doorPage.includes('Start door mode'));
    const rendered=doorPage.match(/\\"csrf\\":\\"([A-Za-z0-9_-]{43})\\"/)?.[1];assert.ok(rendered,'door page renders its CSRF token');assert.equal(rendered,door.csrf);
    const contextResponse=await door.request(`/api/door/${event.id}/context`,{headers:{'x-csrf':door.csrf}}),context=await contextResponse.json();assert.equal(contextResponse.status,200,JSON.stringify(context));assert.equal(context.state,'live');assert.equal(context.doorMode,'strict');
    return {operator,denied,door:'started',mode:context.doorMode,threshold:context.threshold};
  });
  let scans=0;
  const welcomeCount=async()=>(await rpc('snapshot')).emails.filter(e=>e.body.tags?.some(t=>t.value==='M_13')).length;
  const scan=async(face,expected,{test=false,...options}={})=>{
    const image=await rpc('imageCase',{face,...options}),before=await rpc('snapshot'),emails=await welcomeCount(),checkins=(await rt.q.query('select id from checkins where event_id=$1',[event.id])).length;
    const doorSpend=async()=>Number((await rt.q.query("select coalesce(sum(value),0) value from counters where key='spend:total:door'"))[0].value);
    const reservedBefore=await doorSpend();
    await delay(1300);const result=await door.json(`/api/door/${event.id}/scan${test?'?test=1':''}`,await fixture(face),'image/jpeg');scans++;
    assert.equal(result.test,test);
    assert.equal(result.result,expected,JSON.stringify(result));
    const after=await rpc('snapshot');assert.equal(after.search,before.search+1);assert.equal(after.liveness,before.liveness+1);// Every door face search is stored in the Didit console (save_api_request=true, f53c8d8); liveness never is.
    assert.equal(after.saved,before.saved+1,'door face search stored in the Didit console');
    assert.deepEqual(after.images.slice(-2).map(i=>i.sha256),[image.sha256,image.sha256]);assert.ok(after.images.slice(-2).every(i=>i.bytes===image.bytes&&i.saved===(i.path==='/v3/face-search/')));
    const counters=await rt.q.query("select key,value from counters where key like 'scan:event:%' or key like 'scan:app:%'");assert.equal(counters.length,2);for(const counter of counters)assert.equal(Number(counter.value),scans);
    const spend=await rt.q.query("select op,state from spend where op in ('face_search','passive_liveness')");assert.equal(spend.length,scans*2);assert.ok(spend.every(s=>['settled','uncertain'].includes(s.state)));
    assert.equal(await doorSpend(),reservedBefore+100000,'strict scan reserves $0.10 including uncertain provider responses');
    const [row]=await rt.q.query('select result,test from scans where event_id=$1 order by created_at desc,id desc limit 1',[event.id]);assert.equal(row.result,expected);assert.equal(row.test,test);
    if(test){assert.equal(await welcomeCount(),emails);assert.equal((await rt.q.query('select id from checkins where event_id=$1',[event.id])).length,checkins,'Test mode never checks in');}
    else if(expected!=='welcomed'){assert.equal(await welcomeCount(),emails);assert.equal((await rt.q.query('select id from checkins where event_id=$1',[event.id])).length,1);}
    return {result,frame:face,...image,scanCount:scans,providerCalls:spend.length};
  };
  const match=(letter,similarity=99.5)=>({sessionId:guests[letter].verification.didit_session_id,similarity});
  await step('6T: Test mode recognises A (would be welcomed) and checks nobody in',()=>scan('johnson','welcomed',{matches:[match('A')],test:true}));
  await step('6A: A face welcomes, checks in, emails once and appears in live snapshot',async()=>{
    const receipt=await scan('johnson','welcomed',{matches:[match('A')]});assertMail(await mailFor('A','M-13'));
    const response=await staff.request(`/api/admin/events/${event.id}/live`);assert.equal(response.status,200);const live=await response.json();assert.equal(live.counts.checkedIn,1);assert.equal(live.checkins[0].registrationId,guests.A.registration.id);return {...receipt,checkedIn:live.counts.checkedIn};
  });
  await step('6B: unknown face returns unknown, no admission',()=>scan('astronaut','unknown'));
  // Door rule since 2026-10-02: close matches never go to the desk (no `ambiguous` result left); the approved guest on the
  // list among them wins, otherwise the closest. B has an account and a face but never joined this event.
  await step('6C: two close matches take the approved guest on the list, even when another account is closer',async()=>({
    closest:await scan('johnson','welcome_back',{matches:[match('A',98),match('B',97.5)]}),
    onListWins:await scan('johnson','welcome_back',{matches:[match('B',99),match('A',96)]}),
  }));
  await step('6D: withdrawn C is not admitted',()=>scan('tesla','not_admitted',{matches:[match('C')]}));
  await step('6E: multiple-face frame cannot admit a single matched guest',()=>scan('multiple','inconclusive',{matches:[match('A')],warnings:[{risk:'MULTIPLE_FACES_DETECTED',log_type:'warning'}]}));
  await step('6F: no face returns no_face',()=>scan('no-face','no_face',{searchStatus:400,livenessStatus:400}));
  await step('6G: strict liveness failure blocks the matched guest',()=>scan('johnson','liveness_failed',{matches:[match('A')],liveness:'Declined'}));
  await step('6H: A returns, no duplicate attendance or welcome email',async()=>{
    const result=await scan('johnson','welcome_back',{matches:[match('A')]});
    await until(async()=>(await rt.q.query("select status from outbox where dedupe_key=$1",[`welcome:${guests.A.registration.id}`]))[0]?.status==='sent','welcome outbox sent');
    assert.equal(await welcomeCount(),1);assert.equal((await rt.q.query('select id from checkins where registration_id=$1',[guests.A.registration.id])).length,1);
    assert.equal((await rt.q.query('select id from outbox where dedupe_key=$1',[`welcome:${guests.A.registration.id}`])).length,1);return result;
  });
  await step('6I: two faces in one frame: two single-face crops, two scans in flight, two tag results; a far face on the strict door is told to come closer',async()=>{
    // The live door crops each tracked face from the same frame and sends both (≤3 in flight, 4 per 1.2 s allowed).
    const a=await rpc('imageCase',{face:'johnson',matches:[match('A')]}),c=await rpc('imageCase',{face:'tesla',matches:[match('C')]});
    const before=await rpc('snapshot'),rows=async()=>Number((await rt.q.query('select count(*)::int n from scans where event_id=$1',[event.id]))[0].n),scanRows=await rows();
    await delay(1300);
    const [ra,rc]=await Promise.all([door.json(`/api/door/${event.id}/scan?track=1&face=220`,await fixture('johnson'),'image/jpeg'),door.json(`/api/door/${event.id}/scan?track=2&face=180`,await fixture('tesla'),'image/jpeg')]);scans+=2;
    assert.deepEqual([ra.trackId,rc.trackId],[1,2]);
    assert.equal(ra.result,'welcome_back',JSON.stringify(ra));assert.equal(ra.outcome,'welcome_back');assert.ok(ra.displayName);assert.equal(ra.verified,true);assert.equal(ra.photo,'none');
    assert.equal(rc.result,'not_admitted',JSON.stringify(rc));assert.equal(rc.outcome,'not_approved');assert.ok(rc.displayName);
    const after=await rpc('snapshot');assert.equal(after.search,before.search+2);assert.equal(after.liveness,before.liveness+2);assert.equal(await rows(),scanRows+2);
    assert.equal(await welcomeCount(),1,'a second face scan sends no second welcome');
    // Strict door, face 80 px wide in the camera frame: no provider call, no spend, no scan row.
    await delay(1300);
    const far=await door.json(`/api/door/${event.id}/scan?track=3&face=80`,await fixture('johnson'),'image/jpeg');
    assert.equal(far.outcome,'liveness_needed');assert.equal(far.trackId,3);
    const last=await rpc('snapshot');assert.equal(last.search,after.search);assert.equal(last.liveness,after.liveness);assert.equal(await rows(),scanRows+2);
    return {faces:[{track:1,outcome:ra.outcome,image:a.sha256},{track:2,outcome:rc.outcome,image:c.sha256}],far:far.outcome,scanCount:scans};
  });
  await step('7A: MCP without token is 401 and guest admin resolves to 403 page',async()=>{
    const response=await fetch(`${rt.eventsUrl}/api/mcp`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'}),signal:AbortSignal.timeout(30000)});assert.equal(response.status,401);await response.text();
    const admin=await guests.A.session.request('/admin');assert.equal(admin.status,307);assert.equal(new URL(admin.headers.get('location'),rt.eventsUrl).pathname,'/admin/forbidden');await admin.text();
    const forbidden=await guests.A.session.request('/admin/forbidden');assert.equal(forbidden.status,403);assert.match(await forbidden.text(),/Signed in as/);return {mcp:401,guestAdmin:403};
  });
  await step('7B: bad HMAC rejected without state change; replay is idempotent',async()=>{
    const state=()=>rt.q.query('select provider_status,activation,state from evidence where account_id=$1 order by id',[guests.A.account.id]);
    const before=await state(),inbox=await rt.q.query('select id from inbox'),decisions=(await rpc('snapshot')).decisions;
    await webhook(guests.A.verification,'Declined',{face:'johnson',bad:true});assert.deepEqual(await state(),before);assert.equal((await rt.q.query('select id from inbox')).length,inbox.length);assert.equal((await rpc('snapshot')).decisions,decisions);
    // Restore only the provider stub; application state is never edited by this journey.
    await rpc('decision',{sessionId:guests.A.verification.didit_session_id,status:'Approved',face:'johnson'});
    const replay=await guests.A.delivered.send();assert.equal(replay.status,200);await replay.text();
    assert.equal((await rt.q.query('select id from inbox')).length,inbox.length);assert.deepEqual(await state(),before);assert.equal((await rpc('snapshot')).decisions,decisions);return {badSignature:401,replay:200,unchanged:true};
  });
  await step('8: flow v3 — SDK completion simulated server-side, no webhook: the verification stream reads Didit and pushes the result',async()=>{
    const session=rt.session(),email='journey.e@example.test';
    const sent=await session.action('/login','signInAction',[{step:'choose'},fields({intent:'send',email})]);assert.equal(sent.step,'code');
    const verified=await session.action('/login','signInAction',[sent,fields({intent:'verify',email,code:'481903',onboardingConsent:JSON.stringify({...consent,eventConsentAccepted:false,acceptedChecks:['face']}),next:`/e/${event.slug}?join=1`})]);
    assert.ok(verified.redirect?.startsWith(`/e/${event.slug}?join=1`),`sign-in returns to the join modal: ${verified.redirect}`);
    const [account]=await rt.q.query('select id from accounts where email=$1',[email]);
    const onboarding=await session.api('/api/me/onboarding');assert.equal(onboarding.step,'profile_required');
    await session.api('/api/me/profile','PATCH',{expectedProfileVersion:onboarding.profileVersion,fullName:'Journey Guest E',headline:'Founder & CEO',company:'Journey Company',jobRole:'',bio:'',links:[{kind:'linkedin',label:'LinkedIn',href:'https://www.linkedin.com/in/journey-e'}]});
    const verification=await until(async()=>(await rt.q.query('select * from verifications where account_id=$1',[account.id]))[0],'face session');
    const inbox=(await rt.q.query('select id from inbox')).length,reads=(await rpc('snapshot')).decisions;
    const ctrl=new AbortController(),res=await session.request('/api/me/verification/stream',{signal:ctrl.signal});assert.equal(res.status,200);
    const reader=res.body.getReader(),decoder=new TextDecoder();let text='';
    const read=async(done,label)=>{const deadline=Date.now()+45000;while(!done(text)){if(Date.now()>deadline)throw new Error(`stream: ${label}`);const chunk=await reader.read();if(chunk.done)throw new Error(`stream ended before ${label}`);text+=decoder.decode(chunk.value);}};
    try {
      await read(t=>t.includes('event: connected'),'connected');
      const offset=text.length;
      // The Didit SDK's onComplete in the browser: the provider now has the decision, and no webhook is sent.
      await rpc('decision',{sessionId:verification.didit_session_id,status:'Approved'});
      await read(t=>t.slice(offset).includes('"type":"verification.updated"'),'pushed decision');
    } finally { ctrl.abort(); }
    const complete=await until(async()=>{const row=await session.api('/api/me/onboarding');return row.step==='complete'&&row;},'onboarding complete');
    assert.equal((await rt.q.query('select id from inbox')).length,inbox,'no webhook involved');
    const [op]=await rt.q.query('select state from verification_ops where verification_id=$1',[verification.id]);assert.equal(op.state,'completed');
    const after=(await rpc('snapshot')).decisions;assert.ok(after>reads&&after-reads<=30,`bounded decision reads: ${after-reads}`);
    const modal=await session.get(`/e/${event.slug}?join=1`);assert.ok(modal.includes('data-join-modal'),'the join modal continues with the event step');
    return {accountId:account.id,step:complete.step,decisionReads:after-reads,webhooks:0};
  });
  await step('receipts: terminal worker/outbox states and captured emails',async()=>{
    await until(async()=>!(await rt.q.query("select id from outbox where status in ('pending','processing')")).length,'outbox drained');
    assert.deepEqual(await rt.q.query("select kind,status,error from outbox where status<>'sent'"),[],'all outbox work succeeded');
    assert.deepEqual(await rt.q.query('select id,error from inbox where processed_at is null or error is not null'),[],'all authenticated webhooks processed');
    const snapshot=await rpc('snapshot');for(const mail of snapshot.emails)assertMail(mail);
    await writeFile(join(rt.receipts,'provider-receipts.json'),JSON.stringify(snapshot,null,2),{mode:0o600});
    assert.equal(snapshot.counts.send,5);assert.equal(snapshot.counts.check,5);assert.equal(snapshot.creates,9);assert.equal(snapshot.saved,snapshot.search,'only door face searches are stored');
    return {otp:snapshot.counts,sessionCreates:snapshot.creates,decisionReads:snapshot.decisions,emails:snapshot.emails.length,scans,rawScansStored:0};
  });
}
