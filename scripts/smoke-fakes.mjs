import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fakeDiditServer } from '../packages/core/src/didit/fake-server.ts';
const didit = await fakeDiditServer();
const emails = [], delivered = new Map();
const portraits = ['johnson', 'tesla', 'astronaut', 'hopper', 'multiple', 'no-face'];
const fixtureBytes = async name => {
  if (!portraits.includes(name)) throw new Error('Unknown portrait');
  return readFile(new URL(`./e2e/fixtures/${name}.jpg`, import.meta.url));
};
const resend = createServer(async (req, res) => {
  const face = /^\/faces\/([a-z-]+)\.jpg$/.exec(req.url ?? '');
  if (req.method === 'GET' && face && portraits.includes(face[1])) {
    res.writeHead(200, {'content-type':'image/jpeg'}).end(await fixtureBytes(face[1])); return;
  }
  if (req.method !== 'POST' || req.url !== '/emails') { res.writeHead(404).end(); return; }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString()), key = req.headers['idempotency-key'];
  const record = { key, body }; emails.push(record);
  if (!key || !body.html || !body.text || !body.to?.length) { res.writeHead(422).end(); return; }
  if (!delivered.has(key)) delivered.set(key, randomUUID());
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: delivered.get(key) }));
});
await new Promise(resolve => resend.listen(0, '127.0.0.1', resolve));
process.send({ ready: true, diditUrl: didit.url, resendUrl: `http://127.0.0.1:${resend.address().port}` });
process.on('message', async ({ id, op, data }) => {
  try {
    let result;
    if (op === 'snapshot') result = { counts: didit.counts, creates: didit.count('POST', '/v3/session/'), decisions: didit.calls.filter(c => c.method === 'GET' && c.path.includes('/decision/')).length, decisionReads: didit.calls.filter(c=>c.method==='GET' && c.path.includes('/decision/')).map(c=>c.path), search: didit.state.calls.search, liveness: didit.state.calls.liveness, saved: didit.state.saved, images:didit.state.images, emails, sessions: [...didit.decisions.values()], createsInput:didit.calls.filter(c=>c.method==='POST' && c.path==='/v3/session/').map(c=>c.body) };
    else if (op === 'decision') {
      const pending=didit.decisions.get(data.sessionId);if(!pending)throw new Error('Missing session');
      const status=data.status,at=new Date().toISOString();
      if(!['Approved','Declined'].includes(status))throw new Error('Invalid status');
      const reference=data.face ? `http://127.0.0.1:${resend.address().port}/faces/${data.face}.jpg` : null;
      if(data.face)await fixtureBytes(data.face);
      result={...pending,status,events:[{event_type:'SESSION_STATUS_CHANGED',feature_step:null,created_at:at,details:{current_status:status}}],
        liveness_checks:data.phone?[]:[{status,method:'PASSIVE',score:status==='Approved'?99:10,reference_image:reference,portrait:reference,matches:[],warnings:[]}],
        ...(data.phone?{phone_verifications:[{status,full_number:data.phone,verified_at:at}]}:{portrait:reference})};
      didit.decisions.set(data.sessionId,result);
    } else if (op === 'imageCase') {
      const bytes=await fixtureBytes(data.face),sha256=createHash('sha256').update(bytes).digest('hex');
      didit.state.imageCases.set(sha256,{matches:(data.matches??[]).map(m=>({session_id:m.sessionId,similarity_percentage:m.similarity,source:'session',status:'Approved',is_blocklisted:false,api_service:null})),searchStatus:data.searchStatus??200,liveness:data.liveness??'Approved',livenessStatus:data.livenessStatus??200,warnings:data.warnings??[]});
      result={sha256,bytes:bytes.length};
    }
    else if (op === 'approve') {
      const pending = didit.decisions.get(data.sessionId); if (!pending) throw new Error('Missing fake session');
      const at = new Date().toISOString();
      result = didit.approved(data.accountId, data.workflowId, { ...pending, status: 'Approved',
        email_verifications: [{ status: 'Approved', email: data.email, verified_at: at }],
        events: [{ event_type: 'SESSION_STATUS_CHANGED', feature_step: null, created_at: at, details: { current_status: 'Approved' } }] });
      didit.state.matches = [{ session_id: data.sessionId, similarity_percentage: 99.5, source: "session", status: "Approved", is_blocklisted: false, api_service: null }];
    } else if (op === 'setMatches') {
      // Door scenarios: [{ sessionId, similarity }] -> provider face-search matches (empty = unknown face).
      if (!Array.isArray(data?.matches)) throw new Error('Invalid matches');
      didit.state.matches = data.matches.map(m => ({ session_id: m.sessionId, similarity_percentage: m.similarity, source: 'session', status: 'Approved', is_blocklisted: false, api_service: null }));
      result = didit.state.matches.length;
    } else if (op === 'setLiveness') {
      if (typeof data?.status !== 'string') throw new Error('Invalid liveness');
      didit.state.liveness = data.status; result = didit.state.liveness;
    } else if (op === 'setSearchStatus') {
      if (![200, 400, 503].includes(data?.status)) throw new Error('Invalid search status');
      didit.state.searchStatus = data.status; result = didit.state.searchStatus;
    } else throw new Error('Unknown fake operation');
    process.send({ id, result });
  } catch { process.send({ id, error: 'Fake control failed' }); }
});
async function close() { await didit.close(); await new Promise(resolve => { resend.close(resolve); resend.closeAllConnections(); }); process.exit(0); }
process.once('SIGTERM', close); process.once('SIGINT', close); process.once('disconnect', close);
