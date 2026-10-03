import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {DiditClient, DiditNotFound} from '../../packages/core/src/didit/client.ts';
import {compatibleWorkflow, FACE_CONFIG, workflowFeatures} from '../../packages/core/src/verification/workflow-registry.ts';
import {reserve, settle} from '../../packages/core/src/spend.ts';

/** Only this module reads a real key (DIDIT_SANDBOX_API_KEY). Never inherit DIDIT_API_KEY or DIDIT_API_URL. */
export async function sandboxContracts(rt) {
  const key=(process.env.DIDIT_SANDBOX_API_KEY??'').trim();
  assert.ok(key,'DIDIT_SANDBOX_API_KEY is not set');
  const errors=[];
  const client=new DiditClient({apiKey:key,baseUrl:'https://verification.didit.me/v3/',timeoutMs:30000,faceTimeoutMs:30000,fetch:async(input,init)=>{
    const response=await fetch(input,init);
    if(!response.ok){
      const body=await response.clone().json().catch(()=>({detail:'non-JSON response'}));
      const safe=JSON.parse(JSON.stringify(body,(k,v)=>/secret|token|key/i.test(k)?'[withheld]':v).replaceAll(key,'[withheld]'));
      errors.push({method:init.method,path:new URL(input).pathname,status:response.status,validation:safe});
      await writeFile(join(rt.receipts,'sandbox-http-errors.json'),JSON.stringify(errors,null,2),{mode:0o600});
    }
    return response;
  }});
  let sessionId,faceWorkflowId;
  const destinations=new Set();
  const spend=async(op,usdMax,call)=>{
    const reservation=await reserve({op,usdMax,scopes:[{kind:'app/day',id:'journey-sandbox',usdCap:3},{kind:'total',id:'journey-sandbox',usdCap:3}]},rt.db);
    try {const result=await call(reservation);await settle(reservation.id,usdMax,rt.db);return result;}
    catch(error){await settle(reservation.id,'uncertain',rt.db);throw error;}
  };
  try {
    const workflows=await rt.step('sandbox: provision CLI and exact workflow feature order',async()=>{
      const candidates=[];
      for(let offset=0;offset<10000;offset+=100){
        const page=await client.listWorkflows({limit:100,offset});
        for(const row of page.results)if(row.workflow_label==='Didit Events · Selfie renewal' && row.status==='published' && !row.is_archived){
          const detail=await client.getWorkflow(row.uuid);if(compatibleWorkflow(detail,FACE_CONFIG,true))candidates.push(detail);
        }
        if(!page.next)break;
      }
      assert.equal(candidates.length,1,'Exactly one compatible sandbox liveness-only workflow');
      faceWorkflowId=candidates[0].workflow_id;
      let output;
      try {output=execFileSync(process.execPath,['--experimental-transform-types',join(rt.root,'apps/events/scripts/provision.mjs'),'18'],{
        cwd:rt.root,env:{...process.env,DATABASE_URL:rt.databaseUrl,DIDIT_API_KEY:key,DIDIT_RENEWAL_WORKFLOW_ID:faceWorkflowId,DIDIT_API_URL:'https://verification.didit.me/v3/'},encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:180000});}
      catch(error){
        const diagnostic=String(error.stderr??'').replaceAll(key,'[redacted]');
        await writeFile(join(rt.receipts,'sandbox-provision-error.log'),diagnostic,{mode:0o600});
        const rows=await rt.q.query('select feature_key,state,last_error_code from didit_workflows');
        await writeFile(join(rt.receipts,'sandbox-provision-state.json'),JSON.stringify(rows,null,2),{mode:0o600});
        throw new Error(`Sandbox provisioning CLI failed; sanitized diagnostic: ${rt.receipts}/sandbox-provision-error.log`);
      }
      const rows=JSON.parse(output);assert.equal(rows.length,6);
      const orders=[];
      for(const row of rows){
        const [saved]=await rt.q.query('select desired_config from didit_workflows where key=$1',[row.key]);
        const workflow=await client.getWorkflow(row.providerVersionId);
        assert.equal(workflow.workflow_id,row.workflowId);
        assert.ok(compatibleWorkflow(workflow,saved.desired_config,row.workflowId===faceWorkflowId),`Incompatible workflow ${row.key}`);
        assert.deepEqual(workflowFeatures(workflow).map(f=>f.feature),saved.desired_config.features.map(f=>f.feature));
        orders.push(workflowFeatures(workflow).map(f=>f.feature).join('+'));
      }
      assert.deepEqual(new Set(orders),new Set(['LIVENESS','AGE_ESTIMATION','OCR+LIVENESS+FACE_MATCH','PHONE_VERIFICATION','PHONE_VERIFICATION+AGE_ESTIMATION','PHONE_VERIFICATION+OCR+LIVENESS+FACE_MATCH']));
      await writeFile(join(rt.receipts,'sandbox-workflows.json'),JSON.stringify(rows,null,2),{mode:0o600});
      return rows;
    });
    await rt.step('sandbox: SDK creates liveness-only session addressed by email',async()=>{
      const face=workflows.find(w=>w.workflowId===faceWorkflowId);assert.ok(face);
      client.registerVerifiedWorkflow(face.workflowId,face.maxPriceMicros/1e6,'renewal');
      const email=`journey-${randomUUID()}@example.test`;
      const session=await spend('session_renewal',Math.max(.1,face.maxPriceMicros/1e6),r=>client.createSession({workflow_id:face.workflowId,vendor_data:email,contact_details:{email,send_notification_emails:false}},r));
      sessionId=session.session_id;
      assert.equal(session.workflow_id,face.workflowId);assert.equal(session.vendor_data,email);assert.equal(session.status,'Not Started');
      assert.equal(new URL(session.url).protocol,'https:');
      const decision=await client.getDecision(sessionId);
      assert.equal(decision.session_id,sessionId);assert.equal(decision.vendor_data,email);
      return {sessionId,workflowId:face.workflowId,vendorData:email,status:session.status,humanSelfie:'not performed; subsequent local journey uses signed decision stubs'};
    });
    await rt.step('sandbox: webhook destination register, rotate by replacement, remove',async()=>{
      // PATCH does not rotate a signing secret. Create a replacement then remove the old destination.
      // Disabled, unique destinations prevent unrelated sandbox traffic reaching a test address.
      const runId=randomUUID();
      const input={label:`Journey ${runId}`,url:`https://events.example.invalid/api/webhooks/didit/${runId}`,enabled:false,webhook_version:'v3',subscribed_events:['status.updated','data.updated']};
      const first=await client.createWebhookDestination(input);destinations.add(first.uuid);
      assert.ok(first.secret_shared_key);assert.equal(first.enabled,false);
      const second=await client.createWebhookDestination({...input,url:`${input.url}/rotated`,label:'Journey rotated'});destinations.add(second.uuid);
      assert.ok(second.secret_shared_key);assert.notEqual(second.secret_shared_key,first.secret_shared_key);
      const updated=await client.patchWebhookDestination(second.uuid,{label:'Journey current',enabled:false});
      assert.equal(updated.uuid,second.uuid);assert.equal(updated.enabled,false);
      assert.equal((await client.getWebhookDestination(second.uuid)).url,`${input.url}/rotated`);
      const list=await client.listWebhookDestinations();assert.ok(list.some(w=>w.uuid===first.uuid));assert.ok(list.some(w=>w.uuid===second.uuid));
      for(const id of [first.uuid,second.uuid]){await client.deleteWebhookDestination(id);destinations.delete(id);await assert.rejects(()=>client.getWebhookDestination(id),DiditNotFound);}
      return {registered:2,rotated:true,removed:2,secrets:'withheld'};
    });
    await rt.step('sandbox: real portrait face-search through SDK',async()=>{
      const jpeg=await readFile(new URL('./fixtures/johnson.jpg',import.meta.url));
      const response=await spend('face_search',.05,r=>client.faceSearch(new Blob([jpeg],{type:'image/jpeg'}),r));
      assert.ok(response.request_id);assert.ok(['Approved','Declined'].includes(response.face_search.status));
      assert.ok(Array.isArray(response.face_search.matches));assert.ok(response.face_search.matches.length<=5);
      // Retain contract facts only: sandbox matches may belong to another sandbox test.
      return {status:response.face_search.status,totalMatches:response.face_search.total_matches,bytes:jpeg.length,saveApiRequest:false};
    });
  } finally {
    await rt.step('sandbox: remove owned provider resources',async()=>{
      for(const id of destinations){await client.deleteWebhookDestination(id);destinations.delete(id);}
      if(sessionId){const result=await client.deleteSession(sessionId);return {sessionRemoved:true,erasureConfirmed:result.erasureConfirmed};}
      return {destinationsRemaining:destinations.size};
    });
  }
}
