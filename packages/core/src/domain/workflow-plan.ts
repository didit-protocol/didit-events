import { createHash } from "node:crypto";
import type { MissingCheck } from "../contracts/event-model.ts";
import { FACE_WORKFLOW_ID,type ExtraCheck } from "./event-model.ts";
export type Feature = "PHONE_VERIFICATION" | "OCR" | "LIVENESS" | "FACE_MATCH" | "AGE_ESTIMATION";
export type WorkflowPlan = { kind: "none" } | { kind: "baseline"; workflowId: typeof FACE_WORKFLOW_ID; checks: ["face"] } |
  { kind: "blocked"; reason: "baseline" | "review" | "age_failed" | "consent" } |
  { kind: "extras"; checks: ExtraCheck[]; features: { feature: Feature; config: Record<string, unknown> }[];
    featureKey: string; configHash: string; needsFaceBinding: boolean };
export const SESSION_CONFIG = { is_desktop_allowed: true, session_expiration_time: 86400, max_retry_attempts: 1, retry_window_days: 1 };
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).filter(([,v]) => v !== undefined).map(([k,v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function workflowConfig(features: { feature: Feature; config: Record<string, unknown> }[]) {
  return { bindingPolicyVersion: 2, features, session: SESSION_CONFIG };
}
export const configHash = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");
export function planWorkflow(missing: readonly MissingCheck[], context: { baselineReady: boolean; ageMinimum?: number; idFallbackConsented: boolean }): WorkflowPlan {
  if (missing.some(m => ["in_review", "continuity_required", "revoked", "provider_unavailable"].includes(m.reason))) return { kind: "blocked", reason: "review" };
  if (missing.some(m => m.check === "face")) return { kind: "baseline", workflowId: FACE_WORKFLOW_ID, checks: ["face"] };
  if (!context.baselineReady) return { kind: "blocked", reason: "baseline" };
  if (!missing.length) return { kind: "none" };
  if (missing.some(m => m.reason === "name_mismatch")) return { kind: "blocked", reason: "review" };
  const ageFailed = missing.some(m => m.check === "age" && m.reason === "below_minimum");
  if (ageFailed && !context.idFallbackConsented) return { kind: "blocked", reason: "age_failed" };
  const checks = (["phone", "id_document", "name_from_id", "age"] as const).filter(c => missing.some(m => m.check === c));
  const features: { feature: Feature; config: Record<string, unknown> }[] = [];
  if (checks.includes("phone")) features.push({ feature: "PHONE_VERIFICATION", config: { code_size: 6, phone_max_retries: 2, phone_max_check_attempts: 3, phone_enrichment_enabled: false, phone_social_enabled: false } });
  const doc = checks.includes("id_document") || checks.includes("name_from_id") || context.idFallbackConsented && checks.includes("age");
  if (doc) features.push({ feature: "OCR", config: {} }, { feature: "LIVENESS", config: { face_liveness_method: "PASSIVE" } }, { feature: "FACE_MATCH", config: {} });
  else if (checks.includes("age")) {
    if (!context.ageMinimum) return { kind: "blocked", reason: "consent" };
    features.push({ feature: "AGE_ESTIMATION", config: { enable_id_verification_fallback: false, minimum_age_threshold: context.ageMinimum, face_liveness_method: "PASSIVE" } });
  }
  return { kind: "extras", checks, features, featureKey: features.map(f => f.feature).join("+"), configHash: configHash(workflowConfig(features)), needsFaceBinding: doc || checks.includes("age") };
}
