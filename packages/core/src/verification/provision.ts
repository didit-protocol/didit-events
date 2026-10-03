import type { Db } from "../db/index.ts";
import type { DiditClient } from "../didit/client.ts";
import { planWorkflow } from "../domain/workflow-plan.ts";
import { WorkflowRegistry } from "./workflow-registry.ts";
/** Explicit coordinator command: verify the pinned face workflow, then provision immutable minimal extras. */
export async function provisionEventModel(db:Db,client:DiditClient,ageThresholds:number[]=[]){
  if(ageThresholds.some(n=>!Number.isInteger(n)||n<1||n>100))throw new Error("Age thresholds must be integers from 1 to 100");
  const registry=new WorkflowRegistry(client,db),ready=[await registry.ensure("face")];
  for(const phone of [false,true])for(const document of [false,true])for(const name of [false,true])for(const minimum of [undefined,...new Set(ageThresholds)])for(const idFallbackConsented of [false,true]){
    const missing=[...(phone?[{check:"phone" as const,reason:"absent" as const}]:[]),...(document?[{check:"id_document" as const,reason:"absent" as const}]:[]),...(name?[{check:"name_from_id" as const,reason:"absent" as const}]:[]),...(minimum?[{check:"age" as const,reason:"absent" as const,minimum}]:[])];
    const plan=planWorkflow(missing,{baselineReady:true,ageMinimum:minimum,idFallbackConsented});
    if(plan.kind!=="extras"||ready.some(r=>r.configHash===plan.configHash))continue;
    ready.push(await registry.ensure(plan));
  }
  return ready.map(r=>({key:r.key,workflowId:r.workflowId,providerVersionId:r.providerVersionId,configHash:r.configHash,minPriceMicros:Number(r.minPriceMicros),maxPriceMicros:Number(r.maxPriceMicros),verifiedAt:r.verifiedAt}));
}
