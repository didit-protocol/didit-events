import { describe,expect,it } from "vitest";
import { FACE_WORKFLOW_ID } from "./event-model.ts";
import { configHash,planWorkflow } from "./workflow-plan.ts";

describe("minimal workflow planning", () => {
  const context = { baselineReady: true, ageMinimum: 18, idFallbackConsented: false };
  it("never adds account checks to an extras workflow", () => {
    expect(planWorkflow([], context)).toEqual({ kind: "none" });
    expect(planWorkflow([{ check: "face", reason: "absent" }], context)).toEqual({ kind: "baseline", workflowId: FACE_WORKFLOW_ID, checks: ["face"] });
    for (const [checks, features] of [
      [["phone"], ["PHONE_VERIFICATION"]],
      [["id_document", "name_from_id", "age"], ["OCR", "LIVENESS", "FACE_MATCH"]],
      [["phone", "age"], ["PHONE_VERIFICATION", "AGE_ESTIMATION"]],
      [["phone", "id_document", "name_from_id", "age"], ["PHONE_VERIFICATION", "OCR", "LIVENESS", "FACE_MATCH"]],
    ] as const) {
      const plan = planWorkflow(checks.map(check => ({ check, reason: "absent" })), context);
      expect(plan.kind).toBe("extras");
      if (plan.kind === "extras") expect(plan.features.map(f => f.feature)).toEqual(features);
    }
  });
  it("requires explicit ID alternative consent and hashes effective configuration", () => {
    const missing = [{ check: "age", reason: "below_minimum" }] as const;
    expect(planWorkflow(missing, context)).toEqual({ kind: "blocked", reason: "age_failed" });
    const id = planWorkflow(missing, { ...context, idFallbackConsented: true });
    if (id.kind !== "extras") throw new Error("Expected ID alternative");
    expect(id.features.map(f => f.feature)).toEqual(["OCR", "LIVENESS", "FACE_MATCH"]);
    const a = planWorkflow([{ check: "age", reason: "absent" }], context);
    const b = planWorkflow([{ check: "age", reason: "absent" }], { ...context, ageMinimum: 21 });
    if (a.kind !== "extras" || b.kind !== "extras") throw new Error("Expected age plans");
    expect(a.configHash).not.toBe(b.configHash);
    expect(a.features[0]?.config.enable_id_verification_fallback).toBe(false);
    expect(configHash({ a: 1, b: 2 })).toBe(configHash({ b: 2, a: 1 }));
    expect(configHash(["OCR", "FACE_MATCH"])).not.toBe(configHash(["FACE_MATCH", "OCR"]));
  });
});
