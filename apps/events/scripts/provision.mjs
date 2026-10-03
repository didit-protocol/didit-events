// Idempotent provisioning through the Didit management API. Needs DIDIT_API_KEY; never run by the tests.
import { pathToFileURL } from 'node:url';
const BASE = 'https://verification.didit.me/v3';
async function providerCall(method, path, body) {
  const key = process.env.DIDIT_API_KEY;
  if (!key) throw new Error('DIDIT_API_KEY missing');
  const response = await fetch(BASE + path, {
    method, headers: { 'x-api-key': key, 'content-type': 'application/json' },
    body: body && JSON.stringify(body), signal: AbortSignal.timeout(10_000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`Didit provisioning failed: ${method} ${response.status}`);
  return response.json();
}
export function workflowBodies(questionnaireId) {
  const liveness = { face_liveness_method: 'PASSIVE', face_liveness_possible_duplicated_face_action: 'NO_ACTION' };
  const full = [
    { feature: 'QUESTIONNAIRE', config: { questionnaire_uuid: questionnaireId } },
    { feature: 'EMAIL_VERIFICATION', config: { only_corporate_emails_allowed: false, duplicated_email_action: 'NO_ACTION', disposable_email_action: 'REVIEW' } },
    { feature: 'LIVENESS', config: liveness },
  ];
  const common = { status: 'published', is_desktop_allowed: true, max_retry_attempts: 3, session_expiration_time: 1209600 };
  return [
    { ...common, workflow_label: 'Didit Events · Face check-in', features: full },
    { ...common, workflow_label: 'Didit Events · Selfie renewal', features: [{ feature: 'LIVENESS', config: liveness }] },
    { ...common, workflow_label: 'Didit Events · Face check-in + age', features: [...full, { feature: 'AGE_ESTIMATION', config: { ...liveness, minimum_age_threshold: 18, enable_id_verification_fallback: false } }] },
  ];
}
function sameWorkflow(current, desired) {
  if (Object.entries(desired).some(([key, value]) => key !== 'features' && current[key] !== value)) return false;
  const graph = current.workflow_graph;
  if (!graph?.nodes || !graph.start_node) return false;
  const features = [], seen = new Set();
  let hasTerminal = false;
  let nodeId = graph.start_node;
  while (nodeId) {
    if (seen.has(nodeId)) return false;
    seen.add(nodeId);
    const node = graph.nodes[nodeId];
    if (!node) return false;
    if (node.node_type === 'feature') features.push(node);
    else if (node.node_type === 'status' && node.session_status === 'Determine' && !node.next) hasTerminal = true;
    else return false;
    nodeId = node.next;
  }
  return hasTerminal && features.length === desired.features.length && desired.features.every((feature, i) => {
    const actual = features[i];
    return actual.feature === feature.feature && Object.entries(feature.config ?? {}).every(([key, value]) => actual.config?.[key] === value);
  });
}
async function allPages(call, path) {
  const rows = [];
  for (let offset = 0; offset < 100_000;) {
    const page = await call('GET', `${path}?limit=100&offset=${offset}`);
    if (!Array.isArray(page.results)) throw new Error('Invalid Didit page');
    rows.push(...page.results);
    if (!page.next) return rows;
    if (!page.results.length) throw new Error('Empty Didit page with next cursor');
    offset += page.results.length;
  }
  throw new Error('Didit pagination limit exceeded');
}
/** Pre-v2 provisioning retained only for contract fixtures; never the CLI entry point. */
export async function provision(call = providerCall) {
  const questionnaires = await allPages(call, '/questionnaires/');
  let questionnaire = questionnaires.find(item => item.title === 'Didit Events · Guest');
  if (!questionnaire) {
    const q = (id, en, es) => ({ id, element_type: 'short_text', label: { en, es }, is_required: true });
    questionnaire = await call('POST', '/questionnaires/', {
      title: 'Didit Events · Guest', description: 'Guest name for Didit Events face check-in.', languages: ['en', 'es'], default_language: 'en',
      form_elements: [q('first_name', 'First name', 'Nombre'), q('last_name', 'Last name', 'Apellidos')],
    });
  }
  const questionnaireId = questionnaire.questionnaire_id ?? questionnaire.uuid;
  if (!questionnaireId) throw new Error('Missing questionnaire ID');
  const existing = await allPages(call, '/workflows/'), result = [];
  for (const body of workflowBodies(questionnaireId)) {
    // Prefer the newest published version; duplicate versions share a stable workflow identity.
    const found = existing.filter(item => item.workflow_label === body.workflow_label && !item.is_archived)
      .sort((a, b) => Number(b.status === 'published') - Number(a.status === 'published') || Number(b.version ?? 0) - Number(a.version ?? 0))[0];
    let workflow;
    if (found) {
      const current = await call('GET', `/workflows/${found.uuid}/`);
      workflow = sameWorkflow(current, body) ? current : await call('PATCH', `/workflows/${found.uuid}/`, body);
    } else workflow = await call('POST', '/workflows/', body);
    if (!Number.isFinite(workflow.max_price) || workflow.max_price <= 0) throw new Error('Missing workflow max_price; do not enable billable creation');
    result.push({ label: body.workflow_label, workflow_id: workflow.workflow_id ?? workflow.uuid, workflow_url: workflow.workflow_url, min_price: workflow.min_price, max_price: workflow.max_price });
  }
  return { questionnaire_id: questionnaireId, workflows: result };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {createDb}=await import('../../../packages/core/src/db/index.ts');
  const {DiditClient}=await import('../../../packages/core/src/didit/client.ts');
  const {provisionEventModel}=await import('../../../packages/core/src/verification/provision.ts');
  if(!process.env.DATABASE_URL || !process.env.DIDIT_API_KEY)throw new Error('DATABASE_URL and DIDIT_API_KEY are required');
  const db=createDb({url:process.env.DATABASE_URL});
  try {
    console.log(JSON.stringify(await provisionEventModel(db,new DiditClient({apiKey:process.env.DIDIT_API_KEY}),process.argv.slice(2).map(Number)),null,2));
  } finally {await db.close();}
}
