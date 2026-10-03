import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { queryable } from "../db/tx.ts";
import { DiditClient } from "../didit/client.ts";
import { fakeDiditServer } from "../didit/fake-server.ts";
import { planWorkflow } from "../domain/workflow-plan.ts";
import * as planner from "../domain/workflow-plan.ts";
import { provisionEventModel } from "./provision.ts";
import { testDatabase } from "../testing/database.ts";
import { skipPostgres } from "../testing/postgres.ts";
import { configuredFaceWorkflowId,WorkflowRegistry } from "./workflow-registry.ts";
describe.each(["pglite",...(skipPostgres?[]:["postgres"])] as const)("durable workflow provisioning (%s)",driver=>{
 let database:Awaited<ReturnType<typeof testDatabase>>,fake:Awaited<ReturnType<typeof fakeDiditServer>>,client:DiditClient,registry:WorkflowRegistry;
 beforeAll(async()=>{database=await testDatabase(driver as "pglite"|"postgres");fake=await fakeDiditServer();client=new DiditClient({apiKey:"fake",fetch:fake.fetch,timeoutMs:60_000});registry=new WorkflowRegistry(client,database.db);},60000);
 afterAll(async()=>{await fake?.close();await database?.close();});
 it("concurrent creation converges to one immutable workflow and price",async()=>{
  const plan=planWorkflow([{check:"phone",reason:"absent"}],{baselineReady:true,idFallbackConsented:false});if(plan.kind!=="extras")throw new Error();
  const results=await Promise.allSettled(Array.from({length:4},()=>registry.ensure(plan)));expect(results.some(r=>r.status==="fulfilled")).toBe(true);
  const ready=await registry.ensure(plan);expect(ready.state).toBe("ready");expect(Number(ready.maxPriceMicros)).toBe(100000);expect(fake.count("POST","/v3/workflows/")).toBe(1);
  expect(ready.label.length).toBeLessThanOrEqual(50);
  await expect(queryable(database.db).query("update didit_workflows set max_price_micros=max_price_micros+1 where key=$1",[ready.key])).rejects.toThrow("workflow_config_immutable");
 });
 it("adopts a lost create response by exact config without another POST",async()=>{
  const plan=planWorkflow([{check:"age",reason:"absent"}],{baselineReady:true,ageMinimum:21,idFallbackConsented:false});if(plan.kind!=="extras")throw new Error();
  const original=client.createWorkflow.bind(client);vi.spyOn(client,"createWorkflow").mockImplementationOnce(async input=>{await original(input);throw new Error("Lost reply");});
  await expect(registry.ensure(plan)).rejects.toThrow("provider_unavailable");const before=fake.count("POST","/v3/workflows/");
  expect((await registry.ensure(plan)).state).toBe("ready");expect(fake.count("POST","/v3/workflows/")).toBe(before);
 });
 it("uses the configured app's face workflow; a pin from another app is re-pinned and re-verified, never guessed",async()=>{
  const workflowId=randomUUID(),versionId=randomUUID();
  const original=[...fake.workflows.values()][0]!;
  fake.workflows.set(versionId,{...original,uuid:versionId,workflow_id:workflowId});
  vi.stubEnv("DIDIT_RENEWAL_WORKFLOW_ID",workflowId);
  try {
   expect(configuredFaceWorkflowId()).toBe(workflowId);
   expect((await registry.ensure("face")).workflowId).toBe(workflowId);
   // The environment moves to another Didit app (staging → sandbox, 2026-10-02): the pin follows the configuration and is
   // re-verified against that app; a workflow the app doesn't have stays unavailable (never a guessed pin or price).
   const movedId=randomUUID(),movedVersion=randomUUID();
   fake.workflows.set(movedVersion,{...original,uuid:movedVersion,workflow_id:movedId});
   vi.stubEnv("DIDIT_RENEWAL_WORKFLOW_ID",movedId);
   const moved=await registry.ensure("face");
   expect(moved).toMatchObject({ workflowId:movedId, providerVersionId:movedVersion, state:"ready" });
   vi.stubEnv("DIDIT_RENEWAL_WORKFLOW_ID",randomUUID());
   await expect(registry.ensure("face")).rejects.toThrow("provider_unavailable");
   const [row]=await queryable(database.db).query<{state:string;max_price_micros:unknown}>("select state,max_price_micros from didit_workflows where key=$1",[moved.key]);
   expect(row).toEqual({ state:"uncertain", max_price_micros:null });
   vi.stubEnv("DIDIT_RENEWAL_WORKFLOW_ID","invalid");
   expect(()=>configuredFaceWorkflowId()).toThrow("review_required");
  } finally {vi.unstubAllEnvs();}
 });
 // Eight workflows on a fresh database: 4–10 s locally, over 30 s on CI runners; retried because a loaded runner sometimes
 // drops a call to the local fake Didit server (fresh database per attempt).
 it("provisions consented ID alternatives and name-from-ID variants without duplicate workflows",{timeout:120_000,retry:2},async()=>{
  // The configured-face test above owns a different pin; provision in a fresh database.
  const fresh=await testDatabase(driver as "pglite"|"postgres"),plans=vi.spyOn(planner,"planWorkflow");
  try {
   const ready=await provisionEventModel(fresh.db,client,[18,21,18]);
   expect(plans.mock.calls.some(([missing,context])=>context.idFallbackConsented && missing.some(m=>m.check==="age") && !missing.some(m=>m.check==="id_document"))).toBe(true);
   expect(plans.mock.calls.some(([missing])=>missing.some(m=>m.check==="name_from_id"))).toBe(true);
   const rows=await queryable(fresh.db).query<{config_hash:string;state:string}>("select config_hash,state from didit_workflows");
   expect(rows).toHaveLength(8);expect(new Set(ready.map(r=>r.configHash)).size).toBe(8);
   for(const row of rows)expect(row.state).toBe("ready");
   const before=fake.count("POST","/v3/workflows/");
   await provisionEventModel(fresh.db,client,[18,21]);expect(fake.count("POST","/v3/workflows/")).toBe(before);
  } finally {plans.mockRestore();await fresh.close();}
 });
});
