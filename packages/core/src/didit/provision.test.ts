import { expect, it } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Feature = { feature: string; config: Record<string, unknown> };
type Workflow = Record<string, unknown> & { uuid: string; workflow_graph: { start_node: string; nodes: Record<string, { node_type: string; feature?: string; config?: Record<string, unknown>; next?: string; session_status?: string }> } };
async function fixture() {
  // Only this injected transport executes. Never calls the paid provider or management API.
  const path = pathToFileURL(resolve(import.meta.dirname, "../../../../apps/events/scripts/provision.mjs")).href;
  const provisioning = await import(/* @vite-ignore */ path) as { provision(call: (method: string, path: string, body?: Record<string, unknown>) => Promise<unknown>): Promise<unknown> };
  const workflows: Workflow[] = []; let questionnaire: Record<string, unknown> | undefined;
  const writes: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
  const row = (body: Record<string, unknown>, uuid: string): Workflow => {
    const features = body.features as Feature[];
    const graph = { start_node: "0", nodes: { ...Object.fromEntries(features.map((f, i) => [String(i), { ...structuredClone(f), node_type: "feature", next: i + 1 < features.length ? String(i + 1) : "determine_status" }])), determine_status: { node_type: "status", session_status: "Determine" } } };
    return { ...structuredClone(body), uuid, features: features.map(f => f.feature).join(","), workflow_graph: graph, max_price: 0.33 };
  };
  const call = async (method: string, path: string, body?: Record<string, unknown>) => {
    if (method !== "GET") writes.push({ method, path, body: structuredClone(body) });
    if (path.startsWith("/questionnaires/?")) return { count: questionnaire ? 1 : 0, results: questionnaire ? [{ ...questionnaire, uuid: "questionnaire" }] : [], next: null };
    if (path === "/questionnaires/" && method === "POST") return questionnaire = { ...body, questionnaire_id: "questionnaire" };
    if (path.startsWith("/workflows/?")) return { count: workflows.length, results: workflows, next: null };
    if (path === "/workflows/" && method === "POST") { const created = row(body!, String(workflows.length)); workflows.push(created); return created; }
    const current = workflows.find(w => path === `/workflows/${w.uuid}/`);
    if (current && method === "GET") return current;
    if (current && method === "PATCH") { Object.assign(current, row(body!, current.uuid)); return current; }
    throw new Error(`Unexpected mock mutation ${method} ${path}`);
  };
  return { run: () => provisioning.provision(call), workflows, writes };
}
it("creates three workflows once, includes exact age settings and skips identical provisioned workflows", async () => {
  const f = await fixture();
  await f.run(); expect(f.workflows).toHaveLength(3); expect(f.writes).toHaveLength(4);
  const age = f.writes[3]!.body!.features as Feature[];
  expect(age.find(feature => feature.feature === "AGE_ESTIMATION")!.config).toMatchObject({ minimum_age_threshold: 18, enable_id_verification_fallback: false });
  // A newer draft must not displace an already provisioned published workflow.
  f.workflows.push({ ...structuredClone(f.workflows[0]!), uuid: "draft", status: "draft", version: 100 });
  await f.run(); expect(f.writes).toHaveLength(4);
  expect(f.workflows[1]!.features).toBe("LIVENESS");
});
it.each(["features", "config", "workflow-setting"])("PATCH repairs provisioned %s drift and a subsequent identical run skips PATCH", async drift => {
  const f = await fixture(); await f.run(); f.writes.length = 0;
  const age = f.workflows[2]!;
  if (drift === "features") age.workflow_graph.nodes["2"]!.next = "determine_status";
  else if (drift === "config") Object.assign(age.workflow_graph.nodes["3"]!.config!, { minimum_age_threshold: 21, enable_id_verification_fallback: true });
  else age.session_expiration_time = 1;
  await f.run();
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]).toMatchObject({ method: "PATCH", path: `/workflows/${age.uuid}/` });
  expect((f.writes[0]!.body!.features as Feature[]).find(f => f.feature === "AGE_ESTIMATION")!.config).toMatchObject({ minimum_age_threshold: 18, enable_id_verification_fallback: false });
  await f.run(); expect(f.writes).toHaveLength(1);
});
