import assert from 'node:assert/strict';
import {smokeModel} from './smoke-model.mjs';
import { spawn, fork, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createDb } from '../packages/core/src/db/index.ts';
import { migrate } from '../packages/core/src/db/migrate.ts';
import { queryable } from '../packages/core/src/db/tx.ts';
import { signV2 } from '../packages/core/src/webhook/signature.ts';
import { FACE_WORKFLOW_ID } from '../packages/core/src/domain/event-model.ts';
import { bootstrapApiToken } from '../packages/core/src/api-tokens.ts';
import { seedEvents } from '../apps/events/scripts/seed-events.ts';

const root = resolve(import.meta.dirname, '..'), receipts = `/tmp/events-i1-smoke-${process.pid}`;
await mkdir(receipts, { recursive: true });
const children = [], results = [], pending = new Map();
let database, admin, container, fakes, rpcId = 0, cleaning;
const databaseName = `i1_smoke_${randomUUID().replaceAll('-', '')}`;
const deadline = AbortSignal.timeout(10 * 60_000);
async function until(check, description, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { deadline.throwIfAborted(); const value = await check(); if (value) return value; await delay(250); }
  throw new Error(`Timed out: ${description}`);
}
async function port() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function launch(name, args, cwd, env) {
  const log = await open(join(receipts, `${name}.log`), 'w', 0o600);
  const child = spawn(process.execPath, args, { cwd, env, detached: true, stdio: ['ignore', log.fd, log.fd] });
  child.smokeName = name; child.smokeUrls = [`http://127.0.0.1:${env.PORT}`];
  children.push(child); child.on('error', () => {}); await log.close(); return child;
}
async function stopChild(child) {
  // Each child owns a dedicated process group. No name-based pkill or shared server shutdown.
  const signal = name => { try { process.kill(-child.pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  const stopped = async () => {
    if (!exited()) return false;
    for (const url of child.smokeUrls ?? []) {
      try { const response = await fetch(url, { signal: AbortSignal.timeout(500) }); await response.body?.cancel(); return false; }
      catch (error) { if (error.name === 'TimeoutError') return false; }
    }
    if (child.smokeName === 'events') {
      const log = await readFile(join(receipts, 'events.log'), 'utf8');
      if (log.includes('events.worker_started') && !log.includes('events.workers_stopped')) return false;
    }
    return true;
  };
  signal('SIGTERM');
  // The Next CLI parent may exit before its server child. Wait for the group,
  // checking its owned listeners and drain receipt (kill(pid, 0) is sandbox-restricted).
  const until = Date.now() + 15000;
  while (!await stopped() && Date.now() < until) await delay(100);
  if (!await stopped()) signal('SIGKILL');
  const reaped = Date.now() + 4000;
  while (!await stopped() && Date.now() < reaped) await delay(100);
  assert.ok(await stopped(), `Owned process group ${child.pid} did not drain and close its listeners`);
}
async function cleanup() {
  if (cleaning) return cleaning;
  cleaning = (async () => {
    // Keep provider servers alive until every application worker has drained.
    const stopped = await Promise.allSettled(children.filter(child=>child!==fakes).map(stopChild));
    if(fakes) stopped.push(...await Promise.allSettled([stopChild(fakes)]));
    if (database) await database.close();
    if (admin) { await queryable(admin).query(`drop database if exists ${databaseName} with (force)`); await admin.close(); }
    if (container) execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
    const errors = stopped.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, errors.map(error => error.message).join('; '));
    const workerLog = await readFile(join(receipts, 'events.log'), 'utf8').catch(() => '');
    if (workerLog.includes('events.worker_started')) assert.ok(workerLog.includes('events.workers_stopped'), 'Workers did not finish draining before server exit');
  })();
  return cleaning;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void cleanup().finally(() => process.exit(1)); });
function rpc(op, data) {
  const id = ++rpcId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Fake RPC timeout: ${op}`)); }, 5000);
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject }); fakes.send({ id, op, data });
  });
}
function actionStream(text) {
  // Retain action models only. Revalidation may attach a whole React page under
  // root.f; an API client must not load its browser modules or devtools.
  const buffer = Buffer.from(text), rows = [];
  for (let offset = 0; offset < buffer.length;) {
    const colon = buffer.indexOf(58, offset);
    assert.ok(colon >= offset, 'Malformed Flight row');
    const id = buffer.subarray(offset, colon).toString();
    let payload;
    if (buffer[colon + 1] === 84) { // T<hex byte length>,<text>
      const comma = buffer.indexOf(44, colon + 2);
      const length = Number.parseInt(buffer.subarray(colon + 2, comma).toString(), 16);
      assert.ok(Number.isFinite(length), 'Malformed Flight text');
      offset = comma + 1 + length;
      payload = JSON.stringify(buffer.subarray(comma + 1, offset).toString());
    } else {
      const newline = buffer.indexOf(10, colon + 1), end = newline < 0 ? buffer.length : newline;
      payload = buffer.subarray(colon + 1, end).toString(); offset = end + 1;
    }
    if (id === '0') {
      const root = JSON.parse(payload); assert.ok(Object.hasOwn(root, 'a'), 'Missing action response');
      rows.push(`0:${JSON.stringify({ a: root.a })}\n`);
    } else {
      try { JSON.parse(payload); rows.push(`${id}:${payload}\n`); } catch { if (payload.startsWith('E{')) rows.push(`${id}:${payload}\n`); }
    }
  }
  return rows.join('');
}
class Session {
  jar = new Map();
  constructor(origin) { this.origin = origin; }
  get csrf() { return decodeURIComponent(this.jar.get('__Host-csrf') ?? ''); }
  async request(path, options = {}) {
    const headers = new Headers(options.headers);
    if (this.jar.size) headers.set('cookie', [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '));
    if (options.method && !['GET','HEAD'].includes(options.method)) { headers.set('origin', this.origin); headers.set('x-csrf', this.csrf); }
    headers.set('x-forwarded-for', '127.0.0.1');
    const res = await fetch(new URL(path, this.origin), { ...options, headers, redirect: 'manual', signal: AbortSignal.any([deadline, AbortSignal.timeout(120000)]) });
    for (const cookie of res.headers.getSetCookie()) {
      const value = cookie.split(';')[0], index = value.indexOf('=');
      if (index > 0) { const key = value.slice(0, index), content = value.slice(index + 1); if (content) this.jar.set(key, content); else this.jar.delete(key); }
    }
    return res;
  }
  async get(path) { const res = await this.request(path); assert.equal(res.status, 200, `GET ${path}: ${res.status}`); return res.text(); }
  async json(path, data, type = 'application/json') {
    const response = await this.request(path, { method: 'POST', headers: { 'content-type': type }, body: type === 'application/json' ? JSON.stringify(data) : data });
    const body = await response.json(); assert.equal(response.status, 200, `POST ${path}: ${response.status} ${JSON.stringify(body)}`); return body;
  }
  async api(path, method='GET', data) {
    const response=await this.request(path,{method,headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
    const body=await response.json();assert.ok([200,201,202].includes(response.status),`${method} ${path}: ${response.status} ${JSON.stringify(body)}`);assert.equal(body.ok,true);return body.data;
  }
  async action(path, name, args, beforePost) {
    // Compile through HTTP, then resolve the actual server action id generated by this app.
    await this.get(path);
    const manifest = JSON.parse(await readFile(join(root, 'apps/events/.next/dev/server/server-reference-manifest.json'), 'utf8'));
    const matches = Object.entries(manifest.node).filter(([, value]) => value.exportedName === name && Object.keys(value.workers).some(worker => {
      const segments = worker.split('/').slice(1, -1).filter(part => !part.startsWith('('));
      return new RegExp('^/' + segments.map(part => part.startsWith('[') ? '[^/]+' : part).join('/') + '$').test(path.split('?')[0]);
    }));
    assert.equal(matches.length, 1, `Action ${name} must be in the generated manifest`);
    const require = createRequire(join(root, 'apps/events/package.json'));
    const { encodeReply, createFromFetch } = require('next/dist/compiled/react-server-dom-webpack/client.node');
    for (const arg of args) if (arg instanceof FormData) arg.set('csrf', this.csrf);
    const body = await encodeReply(args);
    await beforePost?.();
    const response = await this.request(path, { method: 'POST', headers: { 'next-action': matches[0][0], accept: 'text/x-component' }, body });
    const text = await response.text();
    // Persist only synthetic smoke data; never credentials or cookies.
    await writeFile(join(receipts, `${name}.rsc`), text, { mode: 0o600 });
    assert.ok(response.status >= 200 && response.status < 400, `Action ${name}: HTTP ${response.status}`);
    assert.ok(!/^\w+:E\{/m.test(text), `Action ${name} returned a server error; see smoke receipts`);
    if (response.headers.has('x-action-redirect')) return { redirect: response.headers.get('x-action-redirect') };
    // Use the installed Flight codec: QR paths can be length-prefixed text chunks,
    // and action values can reference promises or other records in the stream.
    const model = await createFromFetch(Promise.resolve(new Response(actionStream(text))), {
      serverConsumerManifest: { moduleMap: {}, serverModuleMap: {}, moduleLoading: null },
    });
    return await model.a;
  }
}
function fields(values) { const form = new FormData(); for (const [key, value] of Object.entries(values)) form.set(key, value); return form; }
async function step(name, work) {
  try { const value = await work(); results.push({ check: name, result: 'PASS' }); console.log(`PASS  ${name}`); return value; }
  catch (error) { results.push({ check: name, result: 'FAIL', detail: error.message }); throw error; }
}
try {
  let testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    container = `events-i1-smoke-${process.pid}`;
    execFileSync('docker', ['run', '-d', '--rm', '--name', container, '-p', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD=local-smoke', 'postgres:17'], { stdio: 'pipe' });
    const address = execFileSync('docker', ['port', container, '5432'], { encoding: 'utf8' }).trim();
    testUrl = `postgres://postgres:local-smoke@${address}/postgres`;
  }
  await step('isolated Postgres, migrations, idempotent seed', async () => {
    admin = createDb({ url: testUrl });
    await until(async () => { try { await queryable(admin).query('select 1'); return true; } catch { return false; } }, 'Postgres readiness');
    await queryable(admin).query(`create database ${databaseName}`);
    const url = new URL(testUrl); url.pathname = `/${databaseName}`;
    database = createDb({ url: url.href }); await migrate(database);
    assert.equal((await seedEvents(database, { NODE_ENV: 'development' })).length, 2);
    assert.equal((await seedEvents(database, { NODE_ENV: 'development' })).length, 0);
    assert.equal((await queryable(database).query('select * from accounts')).length, 0);
    testUrl = url.href;
  });
  const providers = await step('fake Didit and Resend HTTP servers', async () => {
    fakes = fork(join(root, 'scripts/smoke-fakes.mjs'), [], { detached: true, stdio: ['ignore', 'ignore', 'inherit', 'ipc'], execArgv: ['--experimental-transform-types'] }); children.push(fakes);
    const ready = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Fake startup timeout')), 15000); fakes.on('message', message => { if (message.ready) { clearTimeout(timer); resolve(message); } else { const request = pending.get(message.id); pending.delete(message.id); if (message.error) request?.reject(new Error(message.error)); else request?.resolve(message.result); } }); fakes.once('error', reject); });
    return ready;
  });
  fakes.smokeUrls = [providers.diditUrl, providers.resendUrl];
  const eventsPort = await port();
  const eventsUrl = `http://127.0.0.1:${eventsPort}`;
  const workflowId = randomUUID(), secret = randomBytes(48).toString('base64url'), webhookSecret = randomBytes(32).toString('hex');
  const env = { ...process.env, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', NEXT_EXIT_TIMEOUT_MS: '15000', WATCHPACK_POLLING: 'true', CHOKIDAR_USEPOLLING: 'true', DATABASE_URL: testUrl, WORKERS: '1', VERIFICATION_WORKERS: '1', DEV_AUTH: '1', DIDIT_FACE_WORKFLOW_ID: FACE_WORKFLOW_ID, STAFF_EMAIL_DOMAIN: 'didit.me', SEED_OWNER_EMAIL: 'events.owner@didit.me', CONTACT_EMAIL: 'events@example.com', EMAIL_FROM: 'Didit Events <events@updates.didit.me>', EMAIL_FOOTER: 'Example Events · 1 Example Street, Lisbon', FRAMES: '0',
    DIDIT_API_KEY: 'local-fake-only', DIDIT_API_URL: providers.diditUrl, DIDIT_WORKFLOW_ID: workflowId, DIDIT_RENEWAL_WORKFLOW_ID: FACE_WORKFLOW_ID, DIDIT_AGE_WORKFLOW_ID: '', DIDIT_AGE_WORKFLOW_MAX_PRICE_USD: '',
    DIDIT_WEBHOOK_SECRET: webhookSecret, DIDIT_OIDC_CLIENT_SECRET: '', RESEND_API_KEY: 'local-fake-only', RESEND_API_URL: providers.resendUrl, RESEND_WEBHOOK_SECRET: '',
    SESSION_SECRET: secret, DIDIT_SPEND_CAP_USD: '10', DIDIT_APP_DAILY_CAP_USD: '10', DIDIT_EVENT_DAILY_CAP_USD: '10', APP_URL: eventsUrl, TRUSTED_PROXY_HOPS: '1' };
  // The door runs inside Events: one app, and a separate browser (cookie jar) for the door device.
  const staff = new Session(eventsUrl), guest = new Session(eventsUrl), door = new Session(eventsUrl);
  await step('Events boots with workers', async () => {
    const cwd = join(root, 'apps', 'events'), require = createRequire(join(cwd, 'package.json'));
    await launch('events', [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(eventsPort)], cwd, { ...env, NEXT_MANUAL_SIG_HANDLE: '1', PORT: String(eventsPort) });
    await until(async () => { try { const r = await fetch(`${eventsUrl}/api/healthz`, { signal: AbortSignal.timeout(2000) }); return r.ok; } catch { return false; } }, 'Next readiness', 120000);
  });
  await step('DEV_AUTH unified staff account session', async () => {
    const res = await staff.request('/api/auth/dev?as=staff&email=events.owner%40didit.me'); assert.equal(res.status, 307); await res.text();
    assert.ok(staff.jar.has('__Host-sid')); await staff.get('/admin');
    const [row] = await queryable(database).query("select s.principal,a.email from sessions s join accounts a on a.id=s.account_id where a.email='events.owner@didit.me'"); assert.equal(row.principal, 'guest'); assert.equal(row.email, 'events.owner@didit.me');
  });
  await step('MCP Bearer token: whoami, events_list and versioned event_update', async () => {
    const { token } = await bootstrapApiToken('events.owner@didit.me', 'isolated-smoke', database);
    for (const name of ['whoami', 'events_list']) {
      const response = await fetch(`${eventsUrl}/api/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: name, method: 'tools/call', params: { name, arguments: {} } }) });
      assert.equal(response.status, 200);
      const body = await response.json(); assert.ok(!body.error); assert.ok(!body.result.isError);
      assert.deepEqual(JSON.parse(body.result.content[0].text), body.result.structuredContent);
      if (name === 'whoami') assert.equal(body.result.structuredContent.email, 'events.owner@didit.me');
      else assert.ok(Array.isArray(body.result.structuredContent.items));
    }
    const [event]=await queryable(database).query("select id,edit_version,cover from events where status='published' and ends_at>clock_timestamp() order by starts_at desc limit 1");
    assert.ok(event);
    const response=await fetch(`${eventsUrl}/api/mcp`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'update',method:'tools/call',params:{name:'event_update',arguments:{eventId:event.id,expectedVersion:event.edit_version,patch:{speakers:[{name:'Smoke host',role:'Host'}],cover:{...event.cover,privacy:{guestList:'hidden'}}}}}})});
    const body=await response.json();assert.equal(response.status,200);assert.ok(!body.result.isError,JSON.stringify(body));assert.equal(body.result.structuredContent.speakers[0].name,'Smoke host');
  });
  await step('one account opens public and admin pages; refresh persists the cookie', async () => {
    await staff.get('/me/settings');
    const before = staff.jar.get('__Host-sid'), csrf = staff.csrf;
    await queryable(database).query("update sessions set created_at=clock_timestamp()-interval '2 days' where account_id in (select id from accounts where email='events.owner@didit.me')");
    const response = await staff.request('/admin'); assert.equal(response.status, 200); await response.text();
    assert.notEqual(staff.jar.get('__Host-sid'), before); assert.equal(staff.csrf, csrf);
    assert.ok(response.headers.getSetCookie().some(cookie => cookie.startsWith('__Host-sid=') && /Max-Age=34560000/i.test(cookie)));
    const signedOut = new Session(eventsUrl), redirect = await signedOut.request('/admin/team');
    assert.equal(redirect.status, 307); assert.equal(new URL(redirect.headers.get('location'), eventsUrl).pathname, '/login'); await redirect.text();
    const legacy = await signedOut.request('/admin/login?next=/admin/team');
    assert.equal(legacy.status, 307); assert.ok(legacy.headers.get('location').includes('/login?next=%2Fadmin%2Fteam')); await legacy.text();
  });
  await step('team Send invite emails the invitee (T-01) through the outbox; Resend invite respects the 1-minute cooldown', async () => {
    const invitee = 'smoke.teammate@didit.me';
    const sent = await staff.action('/admin/team', 'inviteStaffAction', [{ status: 'idle' }, fields({ email: invitee, role: 'staff' })]);
    assert.deepEqual(sent, { status: 'sent', email: invitee });
    await until(async () => (await rpc('snapshot')).emails.some(e => e.body.tags?.some(t => t.value === 'T_01')), 'team invite mail');
    const mails = (await rpc('snapshot')).emails.filter(e => e.body.tags?.some(t => t.value === 'T_01'));
    assert.equal(mails.length, 1); const { body } = mails[0];
    assert.deepEqual(body.to, [invitee]); assert.equal(body.from, 'Didit Events <events@updates.didit.me>'); assert.equal(body.reply_to, 'events@example.com');
    assert.ok(body.subject.endsWith('invited you to Didit Events'), body.subject);
    assert.ok(body.html.includes(`href="${eventsUrl}/admin"`) && body.html.includes('Open Didit Events admin'), 'branded HTML with the admin button');
    assert.ok(body.text.includes(`Open Didit Events admin: ${eventsUrl}/admin`), 'plain-text part');
    const again = await staff.action('/admin/team', 'resendInviteAction', [invitee, staff.csrf]); assert.deepEqual(again, { error: 'cooldown' });
    assert.equal((await queryable(database).query("select id from outbox where kind='email:T-01' and payload->>'to'=$1", [invitee])).length, 1);
  });
  const consent={disclosureVersion:'events-profile-v2',shareProfileWithHosts:true,eventConsentAccepted:true,acceptedChecks:['face']};
  const values={name:'I1 Smoke Event',description:'Synthetic local integration event.',descriptionMd:'## Meet builders\n[Details](https://example.test)\n<script>alert(1)</script>',startsAt:new Date(Date.now()+86400000).toISOString(),endsAt:new Date(Date.now()+90000000).toISOString(),timezone:'Europe/Madrid',venue:'Didit HQ',address:'Carrer de Pallars 99, Barcelona',placeId:null,lat:null,lng:null,mapsUrl:null,capacity:10,checks:{version:1,required:[],max_age:{}},door:{kiosk:false},form:{version:1,mode:'request',closes_at:null,waitlist:true,fields:{phone_number:'off'},questions:[],consent_text:null},emails:{version:1,templates:{}},cover:{kind:'theme',theme:'aqua'}};
  const event=await step('staff creates, saves and publishes a versioned draft through HTTP',async()=>{
    const created=await staff.api('/api/admin/events','POST',values);
    const saved=await staff.api(`/api/admin/events/${created.eventId}/editor`,'PATCH',{...created.values,expectedVersion:created.editVersion,description:'Saved synthetic local event.'});
    const stale=await staff.request(`/api/admin/events/${created.eventId}/editor`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({...created.values,expectedVersion:created.editVersion})});assert.equal(stale.status,409);
    await staff.api(`/api/admin/events/${created.eventId}/lifecycle`,'POST',{action:'publish',expectedVersion:saved.editVersion});
    return (await queryable(database).query('select * from events where id=$1',[created.eventId]))[0];
  });
  await step('editor create and save actions persist posted cover files and canonical v2 fields',async()=>{
    const day=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
    const editorValues={name:'Multipart cover smoke',date:day,start:'18:00',end:'20:00',timezone:'UTC',venue:'HQ',address:'One Street, Barcelona',street:'One Street',city:'Barcelona',postalCode:'08018',country:'Spain',placeId:'',lat:'',lng:'',mapsUrl:'',capacity:'20',description:'Multipart fixture',requestForm:true,questions:[],threshold:80,welcomeEmail:true,
      v2:{descriptionMd:'## Multipart description',checks:values.checks,door:values.door,form:values.form,closesAtLocal:'',emails:values.emails,cover:{kind:'theme',theme:'aqua',privacy:{guestList:'count'}},speakers:[{name:'Smoke Host',role:'Host'}]}};
    const posted=()=>{
      const f=new FormData();for(const [key,value] of Object.entries(editorValues))f.set(key,typeof value==='object'?JSON.stringify(value):String(value));return f;
    };
    const bytes=await readFile(join(root,'packages/core/src/identity/fixtures/photo.jpg'));
    const create=posted();create.set('cover',new Blob([bytes],{type:'image/jpeg'}),'create.jpg');
    const result=await staff.action('/admin/events/new','createEventAction',[{status:'idle',values:editorValues},create]);assert.ok(result.redirect,JSON.stringify(result));
    const [created]=await queryable(database).query('select * from events where name=$1',[editorValues.name]);assert.equal(created.cover.kind,'asset');assert.equal(created.cover.privacy.guestList,'count');assert.deepEqual(created.speakers,editorValues.v2.speakers);
    const page=await staff.get(`/admin/events/${created.id}/edit`);assert.ok(page.includes('name="v2"'));assert.ok(page.includes(created.cover.version));
    editorValues.v2.cover=created.cover;editorValues.name='Updated multipart cover smoke';
    const save=posted();save.set('id',created.id);save.set('expectedVersion',String(created.edit_version));save.set('cover',new Blob([bytes],{type:'image/jpeg'}),'save.jpg');
    const saved=await staff.action(`/admin/events/${created.id}/edit`,'updateEventAction',[{status:'idle',values:editorValues},save]);assert.equal(saved.status,'saved',JSON.stringify(saved));
    const [updated]=await queryable(database).query('select * from events where id=$1',[created.id]);assert.equal(updated.name,editorValues.name);assert.notEqual(updated.cover.version,created.cover.version);assert.equal(updated.cover.privacy.guestList,'count');assert.equal(updated.edit_version,saved.editVersion);
    assert.equal((await queryable(database).query('select version from event_assets where event_id=$1',[created.id])).length,2);
  });
  await step('flow v3: Request to join opens one modal on the event page (old /register links land there too)',async()=>{
    const response=await guest.request(`/e/${event.slug}/register`),html=await response.text();
    // Next may have streamed the loading shell before redirect(), so check its explicit redirect marker too.
    const meta=html.match(/<meta[^>]+id="__next-page-redirect"[^>]*>/)?.[0];
    const destination=response.headers.get('location') ?? meta?.match(/content="[0-9]+;url=([^"]+)"/)?.[1]?.replaceAll('&amp;','&');
    assert.ok(destination,'HTTP or streamed redirect to the join modal');assert.ok([200,307,308].includes(response.status));
    const target=new URL(destination,eventsUrl);assert.equal(target.pathname,`/e/${event.slug}`);assert.equal(target.searchParams.get('join'),'1');
    const modal=await guest.get(`/e/${event.slug}?join=1`);
    assert.ok(modal.includes('data-join-modal'),'join modal server-rendered over the event page');
    assert.ok(modal.includes('Email me a code')&&modal.includes('idp=google'),'Google and email code inside the modal');
    assert.ok(modal.includes('data-disclosure-version="events-profile-v2"'),'disclosure shown instead of a consent checkbox');
    assert.ok(!modal.includes('I agree to prepare my Didit face check'),'no consent checkbox');
    const page=await guest.get(`/e/${event.slug}`);assert.ok(!page.includes('data-join-modal'),'closed without ?join=1');assert.ok(page.includes(`/e/${event.slug}?join=1`),'Request to join targets the modal');
  });
  const email = 'smoke-guest@example.test';
  const account = await step('guest OTP through fake Didit', async () => {
    const sent = await guest.action('/login', 'signInAction', [{ step: 'choose' }, fields({ intent: 'send', email })]); assert.equal(sent.step, 'code');
    const checked = await guest.action('/login', 'signInAction', [sent, fields({ intent: 'verify', email, code: '481903', onboardingConsent:JSON.stringify(consent), next: `/e/${event.slug}?join=1` })]);
    assert.ok(checked.redirect?.startsWith(`/e/${event.slug}?join=1`),`sign-in returns to the join modal, not an onboarding page: ${checked.redirect}`);
    const [row] = await queryable(database).query('select * from accounts where email=$1', [email]); assert.ok(row);
    const fake = await rpc('snapshot'); assert.equal(fake.counts.send, 1); assert.equal(fake.counts.check, 1); return row;
  });
  await step('signed-in nonstaff gets a real forbidden response without a login loop', async () => {
    const redirect = await guest.request('/admin'); assert.equal(redirect.status, 307);
    assert.equal(new URL(redirect.headers.get('location'), eventsUrl).pathname, '/admin/forbidden'); await redirect.text();
    const forbidden = await guest.request('/admin/forbidden'); assert.equal(forbidden.status, 403);
    const html = await forbidden.text(); await writeFile(join(receipts, 'forbidden.html'), html, {mode:0o600});
    assert.ok(html.includes('Signed in as'), 'forbidden page identifies the signed-in account'); assert.ok(html.includes(email), 'forbidden page shows the guest email');
    assert.ok(html.includes('Go to Didit Events'), 'forbidden page offers the current public-site CTA');
    // A Next forbidden boundary can arrive as embedded Flight data rather than
    // an HTML anchor. Decode the transport before checking its link props.
    const flight = [...html.matchAll(/self\.__next_f\.push\((\[.*?\])\)<\/script>/gs)]
      .map(([, json]) => JSON.parse(json)).filter(row => row[0] === 1).map(row => row[1]).join('');
    assert.ok(/href="\/events"/.test(html) || flight.includes('"href":"/events"'), 'public-site CTA has an Events destination');
  });
  const verification=await step('OTP immediately creates one pinned email-addressed face session before profile completion',async()=>{
    const row=await until(async()=>(await queryable(database).query('select * from verifications where account_id=$1',[account.id]))[0],'onboarding session');
    assert.equal(row.workflow_id,FACE_WORKFLOW_ID);assert.equal(row.vendor_data,email);assert.equal((await rpc('snapshot')).creates,1);
    const onboarding=await guest.api('/api/me/onboarding');assert.equal(onboarding.step,'profile_required');
    const modal=await guest.get(`/e/${event.slug}?join=1`);assert.ok(modal.includes('e.g. Contoso, Adatum, Didit')&&modal.includes('linkedin.com/in/yourname'),'profile step inside the modal with example placeholders');
    const fallback=await guest.request(`/onboarding?returnTo=${encodeURIComponent(`/e/${event.slug}?join=1`)}`);assert.equal(fallback.status,307);assert.equal(new URL(fallback.headers.get('location'),eventsUrl).search,'?join=1');await fallback.text();
    const direct=await guest.get('/onboarding');assert.ok(direct.includes('onboarding-title')&&!direct.includes('STEP 2 OF 3'),'deep-link fallback renders the modal content, never the old stepper');
    // Flow v3: the bio is optional.
    await guest.api('/api/me/profile','PATCH',{expectedProfileVersion:onboarding.profileVersion,fullName:'Smoke Guest',headline:'Engineer',company:'Local Test',jobRole:'',bio:'',links:[{kind:'website',label:'Website',href:'https://example.test/'}]});return row;
  });
  async function approveAndWebhook(sessionId, accountId, address) {
    const mapped=(await queryable(database).query('select workflow_id,vendor_data from verifications where didit_session_id=$1',[sessionId]))[0];
    await rpc('approve', { sessionId, accountId, workflowId:mapped.workflow_id, email: address });
    const fixture = JSON.parse(await readFile(join(root, 'packages/core/src/didit/fixtures/webhook.json'), 'utf8'));
    const payload = { ...fixture.payload, event_id: randomUUID(), session_id: sessionId, workflow_id: mapped.workflow_id, vendor_data:mapped.vendor_data, timestamp: Math.floor(Date.now() / 1000) };
    const raw = JSON.stringify(payload);
    const res = await fetch(`${eventsUrl}/api/webhooks/didit`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature-v2': signV2(raw, webhookSecret), 'x-timestamp': String(payload.timestamp) }, body: raw });
    assert.equal(res.status, 200); await res.text();
    await until(async () => (await queryable(database).query("select id from evidence where account_id=$1 and kind='face' and activation='active' and provider_status='approved'", [accountId])).length === 1, 'active face evidence');
  }
  await step('flow v3: the verification stream is own-account SSE (401 signed out, connected when signed in)',async()=>{
    const anonymous=new Session(eventsUrl),refused=await anonymous.request('/api/me/verification/stream');assert.equal(refused.status,401);await refused.text();
    const ctrl=new AbortController(),res=await guest.request('/api/me/verification/stream',{signal:ctrl.signal});
    assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/text\/event-stream/);
    const reader=res.body.getReader(),decoder=new TextDecoder();let text='';
    while(!text.includes('event: connected')){const {value,done}=await reader.read();if(done)break;text+=decoder.decode(value);}
    ctrl.abort();assert.ok(text.includes('event: connected'));
  });
  await step('signed webhook re-fetches authoritative decision and completes baseline',async()=>{
    await approveAndWebhook(verification.didit_session_id,account.id,email);
    await until(async()=>(await guest.api('/api/me/onboarding')).step==='complete','onboarding completion');
  });
  async function submit(session,eventId,extraConsent=consent) {
    const context=await session.api(`/api/events/${eventId}/request`);
    return session.api(`/api/events/${eventId}/request/submit`,'POST',{expectedPolicyVersion:context.event.policyVersion,expectedFormVersion:context.event.formVersion,profileVersion:context.onboarding.profileVersion,application:context.prefill,consent:extraConsent,joinWaitlist:false,idempotencyKey:randomUUID()});
  }
  const registration=await step('completed guest submits; host approves; ready email requires no new verification',async()=>{
    const page=await guest.get(`/e/${event.slug}?join=1`);assert.ok(page.includes('request-title')&&page.includes('Request to join'),'one-tap request inside the join modal');
    const saved=await submit(guest,event.id);assert.equal(saved.registration.admission,'pending');
    const approved=await staff.action(`/admin/events/${event.id}/applicants`,'decideAction',[event.id,'approve',[saved.registration.id],{},staff.csrf]);assert.equal(approved.ok,true);
    await until(async()=>(await rpc('snapshot')).emails.some(e=>e.body.tags?.some(t=>t.value==='M_06')),'ready mail');
    const statusPage=await guest.get(`/me/events/${event.slug}`);assert.match(statusPage,/You(?:&#x27;|')re in/);
    assert.equal((await rpc('snapshot')).creates,1);
    assert.equal((await queryable(database).query("select id from outbox where kind='verify_invite'")).length,0);
    return saved.registration;
  });
  await step('guest withdraws a pending request over HTTP without starting another verification',async()=>{
    const e=await staff.api('/api/admin/events','POST',{...values,name:'Withdrawal smoke'});
    await staff.api(`/api/admin/events/${e.eventId}/lifecycle`,'POST',{action:'publish',expectedVersion:e.editVersion});
    const before=(await rpc('snapshot')).creates,saved=await submit(guest,e.eventId);
    const cancelled=await guest.api(`/api/registrations/${saved.registration.id}/cancel`,'POST',{expectedAdmission:'pending'});
    assert.equal(cancelled.admission,'cancelled_by_guest');
    const row=(await queryable(database).query('select slug from events where id=$1',[e.eventId]))[0];
    const page=await guest.get(`/me/events/${row.slug}`);assert.ok(page.includes('You withdrew your request'),'withdrawal confirmation heading');
    assert.equal((await rpc('snapshot')).creates,before);
  });
  await step('drawer, safe Markdown and audited email preview/test use the real renderer',async()=>{
    const drawer=await staff.api(`/api/admin/events/${event.id}/applicants/${registration.id}`);assert.equal(drawer.profile.fullName,'Smoke Guest');assert.equal(drawer.readiness,'ready');
    const editor=await staff.api(`/api/admin/events/${event.id}/editor`);assert.ok(!editor.descriptionHtml.includes('<script>'));
    const preview=await staff.api(`/api/admin/events/${event.id}/emails/preview`,'POST',{template:'M-06',preview:{kind:'guest',registrationId:registration.id},expectedEventVersion:editor.editVersion});assert.ok(preview.from);assert.ok(preview.html.includes('Smoke'));
    const input={template:'M-06',preview:{kind:'sample'},to:'alternate@example.test',expectedEventVersion:editor.editVersion,idempotencyKey:randomUUID()};
    const test=await staff.api(`/api/admin/events/${event.id}/emails/test`,'POST',input);assert.equal(test.status,'queued');
    // The repeat is idempotent (same test row); on a loaded host the outbox may already have sent it.
    const again=await staff.api(`/api/admin/events/${event.id}/emails/test`,'POST',input);assert.deepEqual({...again,status:undefined},{...test,status:undefined});assert.ok(['queued','sent'].includes(again.status),again.status);
    await until(async()=>(await staff.api(`/api/admin/events/${event.id}/emails/test/${test.testId}`)).status==='sent','test mail provider accepted');
    const sent=(await rpc('snapshot')).emails.find(e=>e.body.subject.startsWith('[Test]'));assert.ok(sent);assert.ok(sent.body.to.includes('alternate@example.test'));
  });
  await step('uploaded cover bytes persist and the editor exposes the immutable version URL',async()=>{
    const editor=await staff.api(`/api/admin/events/${event.id}/editor`),form=new FormData();
    form.set('expectedEventVersion',String(editor.editVersion));form.set('alt','Smoke event cover');form.set('cover',new Blob([await readFile(join(root,'packages/core/src/identity/fixtures/photo.jpg'))],{type:'image/jpeg'}),'cover.jpg');
    const response=await staff.request(`/api/admin/events/${event.id}/cover`,{method:'POST',body:form}),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
    const uploaded=body.data,asset=await guest.request(uploaded.url);assert.equal(asset.status,200);assert.ok(asset.headers.get('cache-control').includes('immutable'));assert.ok((await asset.arrayBuffer()).byteLength>0);
    const saved=await staff.api(`/api/admin/events/${event.id}/editor`);assert.equal(saved.coverUrl,uploaded.url);
    const publicPage=await guest.get(`/e/${event.slug}`);assert.ok(publicPage.includes(uploaded.version));
    const cards=await guest.get('/events');assert.ok(cards.includes(uploaded.version));
    const og=await guest.request(`/e/${event.slug}/opengraph-image`);assert.equal(og.status,200);assert.match(og.headers.get('content-type'),/image\/png/);assert.ok((await og.arrayBuffer()).byteLength>0);
  });
  await step('event moves live and explicitly enables the supervised door',async()=>{
    const editor=await staff.api(`/api/admin/events/${event.id}/editor`);
    await staff.api(`/api/admin/events/${event.id}/editor`,'PATCH',{...editor.values,expectedVersion:editor.editVersion,startsAt:new Date(Date.now()-3600000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),door:{kiosk:true,mode:'supervised',match_threshold:80}});
  });
  const operatorEmail = 'smoke-operator@example.test';
  await step('staff adds a door operator from the event Team tab; the invitation email goes out', async () => {
    const added = await staff.action(`/admin/events/${event.id}/team`, 'addMemberAction', [event.id, { status: 'idle' }, fields({ email: operatorEmail, role: 'operator' })]);
    assert.equal(added.status, 'saved', JSON.stringify(added));
    await until(async () => (await rpc('snapshot')).emails.some(e => e.body.tags?.some(t => t.value === 'M_27') && e.body.to.includes(operatorEmail)), 'M-27 team invitation');
  });
  await step('the operator signs in, sees only this event and is refused global and manager pages', async () => {
    const res = await door.request(`/api/auth/dev?email=${encodeURIComponent(operatorEmail)}`); assert.equal(res.status, 307); await res.text();
    const list = await door.get('/admin');
    if (!list.includes(event.name) || list.includes('New event')) await writeFile(join(receipts, 'operator-admin.html'), list);
    assert.ok(list.includes(event.name), `operator /admin lists ${event.name}`); assert.ok(!list.includes('New event'), 'operator /admin offers no New event');
    for (const path of ['/admin/team', '/admin/calendar', `/admin/events/${event.id}/settings`, `/admin/events/${event.id}/team`]) {
      const denied = await door.request(path); assert.equal(denied.status, 403, `${path}: ${denied.status}`); await denied.text();
    }
    const guests = await door.request(`/admin/events/${event.id}/guests`); assert.equal(guests.status, 200); await guests.text();
    const launcher = await door.get(`/admin/events/${event.id}/door`);
    if (!launcher.includes('Start door mode')) await writeFile(join(receipts, 'operator-door.html'), launcher);
    assert.ok(launcher.includes('Start door mode'), 'operator door page offers Start door mode');
  });
  await step('the operator starts door mode: the admin session is replaced by a door-scoped session', async () => {
    const started = await door.json(`/api/door/${event.id}/start`, { station: 'Smoke door' });
    assert.equal(started.ok, true); assert.ok(door.jar.has('__Host-door')); assert.equal(door.jar.has('__Host-sid'), false);
    const elsewhere = await door.request(`/admin/events/${event.id}/guests`); assert.equal(elsewhere.status, 307); assert.ok(elsewhere.headers.get('location').includes('/login')); await elsewhere.text();
    const page = await door.get(`/admin/events/${event.id}/door/kiosk`); assert.ok(!page.includes('Start door mode'));
    const context = await (await door.request(`/api/door/${event.id}/context`, { headers: { 'x-csrf': door.csrf } })).json();
    assert.equal(context.state, 'live'); assert.equal(context.station.name, 'Smoke door');
  });
  const jpeg = Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 255, 217]);
  // Door scenarios run BEFORE the first welcome so the existing welcome/welcome-back assertions stay exact.
  // Every scan waits out the 1-per-1.2s device bucket (service.ts consume scan:device). Provider calls are counted
  // so the final fake.search assertion accounts for them.
  const doorCalls = { searches: 0, liveness: 0 };
  const guestSession = verification.didit_session_id;
  const doorScan = async (test = false) => { await delay(1300); return door.json(`/api/door/${event.id}/scan${test ? '?test=1' : ''}`, jpeg, 'image/jpeg'); };
  // v5: every scan reply carries the compact AR-tag fields next to the legacy result.
  const tag = (o) => ({ firstName: null, displayName: null, verified: false, verifiedAt: null, photo: 'none', trackId: null, ...o });
  const lastScan = async () => (await queryable(database).query('select result,registration_id from scans where event_id=$1 order by created_at desc,id desc limit 1', [event.id]))[0];
  const noDoorSideEffects = async () => {
    assert.equal((await queryable(database).query('select id from checkins where event_id=$1', [event.id])).length, 0, 'no check-in row');
    assert.equal((await queryable(database).query('select id from outbox where dedupe_key=$1', [`welcome:${registration.id}`])).length, 0, 'no welcome outbox row');
    assert.equal((await rpc('snapshot')).emails.filter(e => e.body.tags?.some(t => t.value === 'M_13')).length, 0, 'no welcome email');
  };
  const email2 = 'smoke-other@example.test';
  const other=await step('second onboarded guest submits to another event without another OTP/session',async()=>{
    const [e2e]=await queryable(database).query("select * from events where slug='e2e-test-event'");
    const guest2=new Session(eventsUrl),sent=await guest2.action('/login','signInAction',[{step:'choose'},fields({intent:'send',email:email2})]);
    await guest2.action('/login','signInAction',[sent,fields({intent:'verify',email:email2,code:'481903',onboardingConsent:JSON.stringify(consent),next:`/e/${e2e.slug}/register`})]);
    const [account2]=await queryable(database).query('select * from accounts where email=$1',[email2]);
    const onboarding=await guest2.api('/api/me/onboarding');
    await guest2.api('/api/me/profile','PATCH',{expectedProfileVersion:onboarding.profileVersion,fullName:'Other Guest',headline:'Engineer',company:'Local Test',jobRole:'',bio:'Integration fixture.',links:[{kind:'website',label:'Website',href:'https://example.test/'}]});
    const v2=await until(async()=>(await queryable(database).query('select * from verifications where account_id=$1',[account2.id]))[0],'second face');
    await approveAndWebhook(v2.didit_session_id,account2.id,email2);
    const before=await rpc('snapshot'),saved=await submit(guest2,e2e.id);
    const after=await rpc('snapshot');assert.equal(after.creates,before.creates);assert.deepEqual(after.counts,before.counts);
    const approved=await staff.action(`/admin/events/${e2e.id}/applicants`,'decideAction',[e2e.id,'approve',[saved.registration.id],{},staff.csrf]);assert.equal(approved.ok,true);
    return {account:account2,sessionId:v2.didit_session_id};
  });
  await step('Test mode scan of the approved guest shows the welcome but checks nobody in', async () => {
    await rpc('setMatches', { matches: [{ sessionId: guestSession, similarity: 99.5 }] });
    const scan = await doorScan(true); doorCalls.searches++;
    assert.equal(scan.result, 'welcomed'); assert.equal(scan.test, true); assert.equal(scan.checkedInAt, null);
    assert.equal(scan.outcome, 'test'); assert.equal(scan.verified, true); assert.ok(scan.displayName); assert.equal(scan.photo, 'none');
    const [row] = await queryable(database).query('select result,test from scans where event_id=$1 order by created_at desc,id desc limit 1', [event.id]); assert.deepEqual(row, { result: 'welcomed', test: true });
    await noDoorSideEffects();
  });
  await step('unknown face (no provider match) returns unknown with null best score', async () => {
    await rpc('setMatches', { matches: [] });
    const scan = await doorScan(); doorCalls.searches++;
    assert.deepEqual(scan, tag({ result: 'unknown', threshold: 80, bestScore: null, test: false, outcome: 'unknown' }));
    const row = await lastScan(); assert.equal(row.result, 'unknown'); assert.equal(row.registration_id, null);
    await noDoorSideEffects();
  });
  await step('two faces in one frame: two crops scanned at once, two results, each echoing its track', async () => {
    await delay(1300);
    const [first, second] = await Promise.all([1, 2].map(track => door.json(`/api/door/${event.id}/scan?track=${track}&face=${track * 60}`, jpeg, 'image/jpeg')));
    doorCalls.searches += 2;
    assert.deepEqual([first.trackId, second.trackId], [1, 2]);
    for (const scan of [first, second]) assert.deepEqual(scan, tag({ result: 'unknown', threshold: 80, bestScore: null, test: false, outcome: 'unknown', trackId: scan.trackId }));
    const rows = await queryable(database).query('select result from scans where event_id=$1 order by created_at desc,id desc limit 2', [event.id]);
    assert.deepEqual(rows.map(r => r.result), ['unknown', 'unknown']);
    await noDoorSideEffects();
  });
  await step('registered guest below match threshold (60 < 80) returns unknown', async () => {
    assert.equal(Number(event.match_threshold), 80);
    await rpc('setMatches', { matches: [{ sessionId: guestSession, similarity: 60 }] });
    const scan = await doorScan(); doorCalls.searches++;
    assert.deepEqual(scan, tag({ result: 'unknown', threshold: 80, bestScore: null, test: false, outcome: 'unknown' }));
    const row = await lastScan(); assert.equal(row.result, 'unknown'); assert.equal(row.registration_id, null);
    await noDoorSideEffects();
  });
  await step('verified Didit person not registered for this event returns not_on_list', async () => {
    await rpc('setMatches', { matches: [{ sessionId: other.sessionId, similarity: 99.5 }] });
    const scan = await doorScan(); doorCalls.searches++;
    const [acct] = await queryable(database).query('select first_name from accounts where id=$1', [other.account.id]);
    assert.equal(scan.result, 'not_on_list'); assert.equal(scan.outcome, 'not_on_list'); assert.equal(scan.test, false);
    assert.equal(scan.firstName, acct.first_name ?? 'Guest'); assert.equal(scan.verified, true); assert.ok(scan.verifiedAt);
    const row = await lastScan(); assert.equal(row.result, 'not_on_list'); assert.equal(row.registration_id, null);
    await noDoorSideEffects();
  });
  await step('no face in frame (provider 400) returns no_face', async () => {
    await rpc('setMatches', { matches: [{ sessionId: guestSession, similarity: 99.5 }] });
    await rpc('setSearchStatus', { status: 400 });
    try { const scan = await doorScan(); doorCalls.searches++; assert.deepEqual(scan, tag({ result: 'no_face', test: false, outcome: 'unknown' })); }
    finally { await rpc('setSearchStatus', { status: 200 }); }
    assert.equal((await lastScan()).result, 'no_face');
    await noDoorSideEffects();
  });
  await step('strict door: failed liveness blocks a valid registered match', async () => {
    const strict = await staff.action(`/admin/events/${event.id}/settings`, 'saveLimitsAction', [event.id, { status: 'idle' }, fields({ expectedVersion: String((await queryable(database).query('select edit_version from events where id=$1',[event.id]))[0].edit_version), budget: '3000', mode: 'strict', strictness: '80' })]); assert.equal(strict.status, 'saved');
    const [row] = await queryable(database).query("select door->>'mode' door_mode,(door->>'match_threshold')::int match_threshold from events where id=$1", [event.id]); assert.equal(row.door_mode, 'strict'); assert.equal(Number(row.match_threshold), 80);
    await rpc('setMatches', { matches: [{ sessionId: guestSession, similarity: 99.5 }] });
    await rpc('setLiveness', { status: 'Declined' });
    try { const scan = await doorScan(); doorCalls.searches++; doorCalls.liveness++; assert.deepEqual(scan, tag({ result: 'liveness_failed', test: false, outcome: 'liveness_failed' })); }
    finally {
      await rpc('setLiveness', { status: 'Approved' });
      const back = await staff.action(`/admin/events/${event.id}/settings`, 'saveLimitsAction', [event.id, { status: 'idle' }, fields({ expectedVersion: String((await queryable(database).query('select edit_version from events where id=$1',[event.id]))[0].edit_version), budget: '3000', mode: 'supervised', strictness: '80' })]); assert.equal(back.status, 'saved');
    }
    assert.equal((await queryable(database).query("select door->>'mode' door_mode from events where id=$1", [event.id]))[0].door_mode, 'supervised');
    const scanRow = await lastScan(); assert.equal(scanRow.result, 'liveness_failed'); assert.equal(scanRow.registration_id, null);
    await noDoorSideEffects();
    const fake = await rpc('snapshot'); assert.equal(fake.liveness, doorCalls.liveness);
  });
  await step('door controls restored to the registered guest match', async () => {
    assert.equal(await rpc('setMatches', { matches: [{ sessionId: guestSession, similarity: 99.5 }] }), 1);
    await delay(1300);
  });
  await step('scan welcomes guest and dispatches exactly one welcome email', async () => {
    const scan = await door.json(`/api/door/${event.id}/scan`, jpeg, 'image/jpeg'); assert.equal(scan.result, 'welcomed'); assert.equal(scan.test, false); assert.equal(scan.outcome, 'welcome');
    await until(async () => (await rpc('snapshot')).emails.filter(e => e.body.tags?.some(t => t.value === 'M_13')).length === 1, 'M-13 delivery');
    const [outbox] = await queryable(database).query("select status,provider_id from outbox where dedupe_key=$1", [`welcome:${registration.id}`]);
    await until(async () => (await queryable(database).query("select status from outbox where dedupe_key=$1", [`welcome:${registration.id}`]))[0]?.status === 'sent', 'welcome checkpoint'); assert.ok(outbox);
  });
  await step('admin live snapshot contains the check-in', async () => {
    const response = await staff.request(`/api/admin/events/${event.id}/live`); assert.equal(response.status, 200);
    const snapshot = await response.json(); assert.equal(snapshot.counts.checkedIn, 1); assert.equal(snapshot.checkins[0].registrationId, registration.id);
  });
  await step('second scan welcomes back without a second email or check-in', async () => {
    await delay(1300);
    const scan = await door.json(`/api/door/${event.id}/scan`, jpeg, 'image/jpeg'); assert.equal(scan.result, 'welcome_back');
    await delay(2000);
    assert.equal((await queryable(database).query('select id from checkins where registration_id=$1', [registration.id])).length, 1);
    assert.equal((await queryable(database).query("select id from outbox where dedupe_key=$1", [`welcome:${registration.id}`])).length, 1);
    const fake = await rpc('snapshot'); assert.equal(fake.emails.filter(e => e.body.tags?.some(t => t.value === 'M_13')).length, 1); assert.equal(fake.search, 2 + doorCalls.searches); assert.equal(fake.liveness, doorCalls.liveness);
    // Door face searches are stored in the Didit console (2026-10-01); nothing else is.
    assert.equal(fake.saved, fake.search);
    const workerLog = await readFile(join(receipts, 'events.log'), 'utf8');
    for (const worker of ['inbox', 'outbox', 'jobs']) assert.equal(workerLog.split('\n').filter(line => line.includes('events.worker_started') && line.includes(`"worker":"${worker}"`)).length, 1);
  });
  await smokeModel(database,step);
  await step('admin sign out revokes the unified family and clears the public session', async () => {
    const result = await staff.action('/admin', 'signOutAction', [fields({})], async () => {
      // Make rotation due after rendering the form, so this POST proves sign-out cookies win.
      await queryable(database).query("update sessions set created_at=clock_timestamp()-interval '2 days' where revoked_at is null and account_id in (select id from accounts where email='events.owner@didit.me')");
    }); assert.ok(result.redirect);
    assert.equal(staff.jar.has('__Host-sid'), false);
    const response = await staff.request('/admin'); assert.equal(response.status, 307); await response.text();
    assert.equal((await queryable(database).query("select id from sessions where revoked_at is null and account_id in (select id from accounts where email='events.owner@didit.me')")).length, 0);
  });
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  try { await cleanup(); results.push({ check: 'owned server PIDs stopped; isolated database removed', result: 'PASS' }); }
  catch (error) { results.push({ check: 'cleanup', result: 'FAIL', detail: error.message }); process.exitCode = 1; }
  console.table(results); console.log(`Smoke receipts: ${receipts}`);
  await writeFile(join(receipts, 'results.json'), JSON.stringify(results, null, 2));
}
