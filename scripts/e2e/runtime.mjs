import assert from 'node:assert/strict';
import {spawn, fork, execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {randomUUID, randomBytes} from 'node:crypto';
import {mkdir, open, readFile, writeFile, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createDb} from '../../packages/core/src/db/index.ts';
import {migrate} from '../../packages/core/src/db/migrate.ts';
import {queryable} from '../../packages/core/src/db/tx.ts';
import {FACE_WORKFLOW_ID} from '../../packages/core/src/domain/event-model.ts';
import {Session} from './http.mjs';

export async function runtime(provider) {
const root = resolve(import.meta.dirname, '../..');
const receipts = `/tmp/events-journey-${provider}-${process.pid}-${Date.now()}`;
await mkdir(receipts, {recursive:true, mode:0o700});
const children=[], results=[], pending=new Map();
let database, admin, databaseCreated=false, container, fakes, rpcId=0, cleaning;
const databaseName=`journey_${randomUUID().replaceAll('-', '')}`;
const distDir=`.next/journey-${process.pid}-${Date.now()}`;
const deadline=AbortSignal.timeout(15*60_000);
async function until(check, description, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { deadline.throwIfAborted(); const value = await check(); if (value) return value; await delay(250); }
  throw new Error(`Timed out: ${description}`);
}
async function port() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); if ([3310,3311].includes(p)) return port(); return p; }
async function launch(name, args, cwd, env) {
  const log = await open(join(receipts, `${name}.log`), 'w', 0o600);
  const child = spawn(process.execPath, args, { cwd, env, detached: true, stdio: ['ignore', log.fd, log.fd] });
  child.smokeName = name; child.smokeUrls = [`http://127.0.0.1:${env.PORT}`];
  children.push(child); child.on('error', () => {}); await log.close(); return child;
}
async function stopChild(child) {
  if (!Number.isInteger(child.pid) || child.pid <= 0) return;
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
    if (admin) { try { if(databaseCreated)await queryable(admin).query(`drop database if exists ${databaseName} with (force)`); } finally {await admin.close();} }
    if (container) execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
    const errors = stopped.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, errors.map(error => error.message).join('; '));
    const workerLog = await readFile(join(receipts, 'events.log'), 'utf8').catch(() => '');
    if (workerLog.includes('events.worker_started')) assert.ok(workerLog.includes('events.workers_stopped'), 'Workers did not finish draining before server exit');
  })();
  return cleaning;
}
const onSignal=()=>{void cleanup().finally(()=>process.exit(1));};
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal,onSignal);
function rpc(op, data) {
  const id = ++rpcId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Fake RPC timeout: ${op}`)); }, 5000);
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject }); fakes.send({ id, op, data });
  });
}

const rt = {root, receipts, results, deadline, distDir, actionId:0, rpc, until,
  get db(){return database;}, get q(){return queryable(database);},
  session(origin=rt.eventsUrl){return new Session(origin,rt);},
  async step(check, work) {
    const start=Date.now();
    try {const receipt=await work();results.push({check,result:'PASS',ms:Date.now()-start,receipt:receipt??null});console.log(`PASS  ${check}`);return receipt;}
    catch(error){results.push({check,result:'FAIL',ms:Date.now()-start,detail:error.message});console.error(`FAIL  ${check}: ${error.message}`);throw error;}
    finally {await writeFile(join(receipts,'results.json'),JSON.stringify(results,null,2));}
  },
  async database() {
    let url=process.env.TEST_DATABASE_URL;
    if(!url){
      const name=`events-journey-${randomUUID()}`;
      execFileSync('docker',['run','-d','--rm','--name',name,'-p','127.0.0.1::5432','-e','POSTGRES_PASSWORD=local-journey','postgres:17'],{stdio:'pipe'});
      container=name;
      const address=execFileSync('docker',['port',container,'5432'],{encoding:'utf8'}).trim();
      url=`postgres://postgres:local-journey@${address}/postgres`;
    }
    const target=new URL(url);
    assert.notEqual(target.pathname,'/didit_events','Never connect to the operator database');
    admin=createDb({url});
    await until(async()=>{try{await queryable(admin).query('select 1');return true;}catch{return false;}},'Postgres ready');
    await queryable(admin).query(`create database ${databaseName}`);databaseCreated=true;
    target.pathname=`/${databaseName}`;rt.databaseUrl=target.href;
    database=createDb({url:target.href});await migrate(database);
    return {database:databaseName};
  },
  async boot() {
    fakes=fork(join(root,'scripts/smoke-fakes.mjs'),[],{detached:true,stdio:['ignore','ignore','inherit','ipc'],execArgv:['--experimental-transform-types']});children.push(fakes);
    const providers=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Fake startup timeout')),15000);
      fakes.on('message',message=>{if(message.ready){clearTimeout(timer);resolve(message);}else{const request=pending.get(message.id);pending.delete(message.id);if(message.error)request?.reject(new Error(message.error));else request?.resolve(message.result);}});
      fakes.once('error',reject);
    });
    fakes.smokeUrls=[providers.diditUrl,providers.resendUrl];rt.providers=providers;
    const eventsPort=await port();
    rt.eventsUrl=`http://127.0.0.1:${eventsPort}`;
    const secret=randomBytes(48).toString('base64url');rt.webhookSecret=randomBytes(32).toString('hex');
    const env={...process.env,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',NEXT_DIST_DIR:distDir,NEXT_EXIT_TIMEOUT_MS:'15000',WATCHPACK_POLLING:'true',CHOKIDAR_USEPOLLING:'true',DATABASE_URL:rt.databaseUrl,WORKERS:'1',VERIFICATION_WORKERS:'1',DEV_AUTH:'1',DIDIT_FACE_WORKFLOW_ID:FACE_WORKFLOW_ID,STAFF_EMAIL_DOMAIN:'didit.me',SEED_OWNER_EMAIL:'events.owner@didit.me',CONTACT_EMAIL:'events@example.com',EMAIL_FROM:'Didit Events <events@updates.didit.me>',EMAIL_FOOTER:'Example Events · 1 Example Street, Lisbon',FRAMES:'0',
      DIDIT_API_KEY:'local-fake-only',DIDIT_API_URL:providers.diditUrl,DIDIT_WORKFLOW_ID:FACE_WORKFLOW_ID,DIDIT_RENEWAL_WORKFLOW_ID:FACE_WORKFLOW_ID,DIDIT_AGE_WORKFLOW_ID:'',DIDIT_AGE_WORKFLOW_MAX_PRICE_USD:'',
      DIDIT_WEBHOOK_SECRET:rt.webhookSecret,DIDIT_OIDC_CLIENT_SECRET:'',RESEND_API_KEY:'local-fake-only',RESEND_API_URL:providers.resendUrl,RESEND_WEBHOOK_SECRET:'',
      SESSION_SECRET:secret,DIDIT_SPEND_CAP_USD:'50',DIDIT_APP_DAILY_CAP_USD:'50',DIDIT_EVENT_DAILY_CAP_USD:'50',APP_URL:rt.eventsUrl,TRUSTED_PROXY_HOPS:'1'};
    {
      const cwd=join(root,'apps','events'),require=createRequire(join(cwd,'package.json'));
      await launch('events',[require.resolve('next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port',String(eventsPort)],cwd,{...env,NEXT_MANUAL_SIG_HANDLE:'1',PORT:String(eventsPort)});
    }
    await until(async()=>{try{const r=await fetch(`${rt.eventsUrl}/api/healthz`,{signal:AbortSignal.timeout(2000)});await r.body?.cancel();return r.ok;}catch{return false;}},'Next ready',120000);
    // Compile the door API before its scan deadlines apply. GET has no handler on these mutation-only routes.
    for(const route of ['start','scan']){
      const response=await fetch(`${rt.eventsUrl}/api/door/warm-up/${route}`,{signal:AbortSignal.timeout(120000)});
      assert.equal(response.status,405,`Warm /api/door/${route}`);await response.body?.cancel();
    }
    return {events:rt.eventsUrl,provider:'fake (decision injection)',distDir};
  },
  async finish() {
    try{await rt.step('cleanup: owned processes drained and isolated database removed',cleanup);}
    finally{for(const signal of ['SIGINT','SIGTERM'])process.removeListener(signal,onSignal);await rm(join(root,'apps','events',distDir),{recursive:true,force:true});console.log(`Journey receipts: ${receipts}`);}
  }
};
return rt;
}
