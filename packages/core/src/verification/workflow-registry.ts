import { randomUUID } from "node:crypto";
import { log } from "../log.ts";
import { getDb,type Db } from "../db/index.ts";
import type { diditWorkflows } from "../db/schema.ts";
import { queryable,type Tx } from "../db/tx.ts";
import type { DiditClient } from "../didit/client.ts";
import type { Workflow,WorkflowInput } from "../didit/types.ts";
import { FACE_WORKFLOW_ID } from "../domain/event-model.ts";
import { canonicalJson,configHash,SESSION_CONFIG,workflowConfig,type Feature,type WorkflowPlan } from "../domain/workflow-plan.ts";
import { rows } from "./shared.ts";
export type RegistryRow = typeof diditWorkflows.$inferSelect;
export const FACE_CONFIG = workflowConfig([{ feature: "LIVENESS", config: {} }]);
export const FACE_KEY = `LIVENESS:${configHash(FACE_CONFIG)}`;
export class WorkflowUnavailable extends Error { constructor(readonly code = "provider_unavailable", options?: { cause?: unknown }) { super(code, options); } }

/** The stable ID belongs to a Didit app. Sandbox and production have separate pins. */
export function configuredFaceWorkflowId(): string {
  const id = process.env.DIDIT_RENEWAL_WORKFLOW_ID || FACE_WORKFLOW_ID;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new WorkflowUnavailable("review_required");
  return id;
}

/**
 * The configured face workflow is the source of truth for the face pin. When an environment moves to another Didit app
 * (staging: production app → sandbox, 2026-10-01), the stored pin no longer matches and every new account failed on
 * `verification_workflow_binding` (found 2026-10-02). Re-pin in two steps the immutability guard allows: leave `ready`
 * (state only), then point the row at the configured workflow with no price; `ensure("face")` re-verifies it against
 * the current app before any spend. A matching pin (production) is never touched.
 */
async function repinFace(q: Pick<Tx, "query">, workflowId: string): Promise<void> {
  const stale = await q.query("update didit_workflows set state='uncertain',verified_at=null where key=$1 and workflow_id is distinct from $2 returning key", [FACE_KEY, workflowId]);
  if (!stale.length) return;
  await q.query(`update didit_workflows set workflow_id=$2,provider_version_id=null,min_price_micros=null,max_price_micros=null,last_error_code='repinned'
    where key=$1 and state<>'ready' and workflow_id is distinct from $2`, [FACE_KEY, workflowId]);
  log("verification.face_workflow_repinned", { key: FACE_KEY });
}

/** An intent is durable before provider I/O. A missing price never becomes a guessed price. */
export async function ensureFaceRegistryInTx(tx: Tx): Promise<string> {
  await repinFace(tx, configuredFaceWorkflowId());
  await tx.query(`insert into didit_workflows(key,feature_key,config_hash,desired_config,workflow_id,label,state)
    values($1,'LIVENESS',$2,$3::jsonb,$4,'Didit Events · Selfie renewal','uncertain') on conflict do nothing`,
  [FACE_KEY, configHash(FACE_CONFIG), JSON.stringify(FACE_CONFIG), configuredFaceWorkflowId()]);
  return FACE_KEY;
}
export function prices(workflow: Workflow): { min: number; max: number } {
  const min = Math.floor((workflow.min_price ?? NaN) * 1e6), max = Math.ceil((workflow.max_price ?? NaN) * 1e6);
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max <= 0 || min > max) throw new WorkflowUnavailable();
  return { min, max };
}
/** Follow the linear feature graph; unknown branching is incompatible with a minimal plan. */
export function workflowFeatures(workflow: Workflow): { feature: string; config: Record<string, unknown> }[] | null {
  const graph = workflow.workflow_graph;
  if (!graph) return null;
  const visited = new Set<string>(), features: { feature: string; config: Record<string, unknown> }[] = [];
  let key: string | null = graph.start_node;
  while (key) {
    if (visited.has(key)) return null; visited.add(key);
    const node = graph.nodes[key] as Record<string, unknown> | undefined;
    if (!node) return null;
    if (node.node_type === "status" && node.session_status === "Determine" && !node.next) return features;
    if (typeof node.feature !== "string" || Array.isArray(node.branches) && node.branches.length) return null;
    const config = node.config;
    features.push({ feature: node.feature, config: config && typeof config === "object" && !Array.isArray(config) ? config as Record<string, unknown> : {} });
    const next = node.next_node ?? node.next;
    if (next !== null && next !== undefined && typeof next !== "string") return null;
    key = typeof next === "string" ? next : null;
  }
  return null;
}
export function compatibleWorkflow(workflow: Workflow, desired: ReturnType<typeof workflowConfig>, pinned = false): boolean {
  if (workflow.status !== "published" || workflow.is_archived) return false;
  const actual = workflowFeatures(workflow);
  if (!actual || actual.length !== desired.features.length) return false;
  if (!actual.every((f,i) => f.feature === desired.features[i]!.feature && Object.entries(desired.features[i]!.config).every(([k,v]) => canonicalJson(f.config[k] ?? workflow[k]) === canonicalJson(v)))) return false;
  return pinned || Object.entries(desired.session).every(([k,v]) => workflow[k] === v);
}
export class WorkflowRegistry {
  constructor(readonly client: Pick<DiditClient, "listWorkflows" | "getWorkflow" | "createWorkflow">, readonly db: Db = getDb()) {}
  async ensure(plan: Extract<WorkflowPlan, { kind: "extras" }> | "face"): Promise<RegistryRow> {
    const faceWorkflowId = configuredFaceWorkflowId();
    const desired = plan === "face" ? FACE_CONFIG : workflowConfig(plan.features), hash = configHash(desired);
    // Didit's workflow label limit is 50 characters; retain the full hash in the registry key/config.
    const featureKey = desired.features.map(f => f.feature).join("+"), key = `${featureKey}:${hash}`, label = `Events v2 ${hash.slice(0,40)}`;
    const q = queryable(this.db);
    await q.query(`insert into didit_workflows(key,feature_key,config_hash,desired_config,label,state,workflow_id)
      values($1,$2,$3,$4::jsonb,$5,'provisioning',$6) on conflict do nothing`, [key,featureKey,hash,JSON.stringify(desired),label,plan === "face" ? faceWorkflowId : null]);
    if (plan === "face") await repinFace(q, faceWorkflowId);
    const [existing] = await rows<RegistryRow>(q, "select * from didit_workflows where key=$1", [key]);
    if (plan === "face" && existing?.state === "ready" && existing.workflowId !== faceWorkflowId) throw new WorkflowUnavailable("review_required");
    if (existing?.state === "ready" && existing.verifiedAt && existing.verifiedAt.getTime()>Date.now()-86400_000 && (plan !== "face" || existing.workflowId === faceWorkflowId)) return existing;
    const lease = randomUUID();
    if (!(await q.query("update didit_workflows set lease_token=$2,lease_until=clock_timestamp()+interval '60 seconds' where key=$1 and (lease_until is null or lease_until<clock_timestamp()) returning key", [key,lease])).length) throw new WorkflowUnavailable();
    try {
      const candidates: Workflow[] = [];
      for (let offset = 0; offset < 10_000;) {
        const page = await this.client.listWorkflows({ limit: 100, offset });
        for (const row of page.results) if (plan === "face" ? row.workflow_id === faceWorkflowId : row.workflow_label === label) candidates.push(await this.client.getWorkflow(row.uuid));
        if (!page.next) break;
        if (!page.results.length) throw new WorkflowUnavailable();
        offset += page.results.length;
        if (offset >= 10_000) throw new WorkflowUnavailable();
      }
      let chosen = candidates.filter(w => compatibleWorkflow(w, desired, plan === "face"));
      if (chosen.length > 1 || candidates.length && !chosen.length) throw new WorkflowUnavailable("review_required");
      if (!chosen.length) {
        if (plan === "face" || existing?.state === "uncertain") throw new WorkflowUnavailable();
        // Persist uncertain before POST: a lost create response must be recovered through listing.
        await q.query("update didit_workflows set state='uncertain' where key=$1 and lease_token=$2", [key,lease]);
        const made = await this.client.createWorkflow({ workflow_label: label, status: "published", features: desired.features as WorkflowInput["features"], ...SESSION_CONFIG });
        const detail = await this.client.getWorkflow(made.uuid);
        if (!compatibleWorkflow(detail, desired)) throw new WorkflowUnavailable(); chosen = [detail];
      }
      const selected = chosen[0]!, price = prices(selected);
      if (!selected.workflow_id || plan === "face" && selected.workflow_id !== faceWorkflowId) throw new WorkflowUnavailable();
      const [ready] = await rows<RegistryRow>(q, `update didit_workflows set state='ready',workflow_id=$3,provider_version_id=$4,
        min_price_micros=$5,max_price_micros=$6,verified_at=clock_timestamp(),lease_token=null,lease_until=null,last_error_code=null
        where key=$1 and lease_token=$2 returning *`, [key,lease,selected.workflow_id,selected.uuid,price.min,price.max]);
      if (!ready) throw new WorkflowUnavailable(); return ready;
    } catch (error) {
      await q.query("update didit_workflows set state='uncertain',last_error_code=$3,lease_token=null,lease_until=null where key=$1 and lease_token=$2", [key,lease,error instanceof WorkflowUnavailable ? error.code : "provider_unavailable"]);
      // Keep the underlying failure as the cause: a bare provider_unavailable hid a CI-only failure (2026-10-01).
      throw error instanceof WorkflowUnavailable ? error : new WorkflowUnavailable("provider_unavailable", { cause: error });
    }
  }
}
export type RegistryFeature = Feature;
