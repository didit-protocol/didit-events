import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { queryable,withTx } from "../db/tx.ts";
import { DiditClient } from "../didit/client.ts";
import { fakeDiditServer } from "../didit/fake-server.ts";
import type { ConsentInput } from "../domain/event-model.ts";
import { createIdentityServices } from "../identity/index.ts";
import { ChangeBus,type ChangeSignal } from "../notify.ts";
import { testDatabase } from "../testing/database.ts";
import { skipPostgres } from "../testing/postgres.ts";
import { pollActiveDecision,type FastPollOptions } from "./fast-poll.ts";
import { createModelServices } from "./model-runtime.ts";
import { applyModelDecision } from "./model-verification.ts";

const consent:ConsentInput={disclosureVersion:"events-profile-v2",shareProfileWithHosts:true,eventConsentAccepted:false,acceptedChecks:["face"]};
const wide={dedupe:{limit:100,windowSec:60},budget:{limit:100,windowSec:60},global:{limit:100,windowSec:60}};

describe.each(["pglite",...(skipPostgres?[]:["postgres"])] as const)("fast-poll decision fallback (%s)",driver=>{
  let database:Awaited<ReturnType<typeof testDatabase>>,fake:Awaited<ReturnType<typeof fakeDiditServer>>,client:DiditClient,identity:ReturnType<typeof createIdentityServices>;
  let n=0;
  beforeAll(async()=>{database=await testDatabase(driver as "pglite"|"postgres");fake=await fakeDiditServer();client=new DiditClient({apiKey:"fake",fetch:fake.fetch});identity=createIdentityServices({db:database.db,didit:client,secret:"s".repeat(40)});},60000);
  afterAll(async()=>{await fake?.close();await database?.close();});
  const q=()=>queryable(database.db);
  const apply:FastPollOptions["applyDecision"]=(tx,accountId,sessionId)=>applyModelDecision(tx,accountId,sessionId,client);
  const options=(limits=wide):FastPollOptions=>({db:database.db,client,applyDecision:apply,limits});
  /** A guest whose sign-in (with the implicit face consent) created a liveness session, and a completed profile. */
  async function guest() {
    const email=`fast${++n}@example.test`,sent=await identity.auth.sendOtp(email,"ip"),login=await identity.auth.checkOtp(sent.challengeId,"481903",{otpCookie:sent.cookie,consent});
    const model=createModelServices({db:database.db,client,appUrl:"https://events.test"});
    await model.onboarding.saveOnboardingProfile(login.principal,{expectedProfileVersion:1,fullName:"Fast Poll",headline:"Builder",company:"Independent",jobRole:"",bio:"",links:[{kind:"website",label:"Website",href:"https://example.test/"}]});
    const [op]=await q().query<{didit_session_id:string;state:string}>("select didit_session_id,state from verification_ops where account_id=$1",[login.principal.accountId]);
    expect(op?.state).toBe("active");
    return {principal:login.principal,accountId:login.principal.accountId,sessionId:op!.didit_session_id,model};
  }
  function approve(sessionId:string,status:"Approved"|"Declined"="Approved") {
    const pending=fake.decisions.get(sessionId)!,at=new Date().toISOString();
    fake.decisions.set(sessionId,{...pending,status,liveness_checks:status==="Approved"?[{status:"Approved",matches:[],warnings:[]}]:[],events:[{event_type:"SESSION_STATUS_CHANGED",feature_step:null,created_at:at,details:{current_status:status}}]});
  }
  const reads=(sessionId:string)=>fake.count("GET",`/v3/session/${sessionId}/decision/`);

  it("reads nothing without an active operation, and leaves an unchanged status alone",async()=>{
    expect(await pollActiveDecision(options(),"00000000-0000-4000-8000-000000000000")).toEqual({state:"idle"});
    const g=await guest(),before=reads(g.sessionId);
    const result=await pollActiveDecision(options(),g.accountId);
    expect(result.state).toBe("unchanged");expect(reads(g.sessionId)).toBe(before+1);
    expect((await g.model.onboarding.getOnboarding(g.principal)).step).toBe("face_in_progress");
  });

  it("applies an approval through the webhook's decision path and notifies the account channel",async()=>{
    const g=await guest(),bus=new ChangeBus(),seen:ChangeSignal[]=[];
    const unsubscribe=bus.subscribe(s=>seen.push(s)),unlisten=await bus.listen(`account_${g.accountId}`,database.db);
    try {
      approve(g.sessionId);
      expect(await pollActiveDecision(options(),g.accountId)).toEqual({state:"applied",status:"Approved"});
      const view=await g.model.onboarding.getOnboarding(g.principal);expect(view.step).toBe("complete");expect(view.face?.state).toBe("verified");
      const [op]=await q().query<{state:string}>("select state from verification_ops where account_id=$1",[g.accountId]);expect(op?.state).toBe("completed");
      await expect.poll(()=>seen.map(s=>s.type)).toContain("verification.updated");
      // Settled: the next tick has nothing to read.
      const before=reads(g.sessionId);expect(await pollActiveDecision(options(),g.accountId)).toEqual({state:"idle"});expect(reads(g.sessionId)).toBe(before);
    } finally { unsubscribe(); await unlisten(); }
  });

  it("is idempotent with the webhook: once the webhook applied the decision, polling reads nothing and changes nothing",async()=>{
    const g=await guest();approve(g.sessionId,"Declined");
    await withTx(tx=>applyModelDecision(tx,g.accountId,g.sessionId,client),database.db);
    const evidence=await q().query("select id from evidence where account_id=$1",[g.accountId]),before=reads(g.sessionId);
    expect(await pollActiveDecision(options(),g.accountId)).toEqual({state:"idle"});
    expect(reads(g.sessionId)).toBe(before);expect(await q().query("select id from evidence where account_id=$1",[g.accountId])).toEqual(evidence);
    expect((await g.model.onboarding.getOnboarding(g.principal)).step).toBe("face_failed");
  });

  it("dedupes concurrent watchers and stops at the per-account budget",async()=>{
    const g=await guest(),before=reads(g.sessionId);
    const deduped={...wide,dedupe:{limit:1,windowSec:60}};
    const results=await Promise.all([1,2,3].map(()=>pollActiveDecision(options(deduped),g.accountId)));
    expect(results.filter(r=>r.state==="limited")).toHaveLength(2);expect(reads(g.sessionId)).toBe(before+1);
    const g2=await guest(),budget={...wide,budget:{limit:2,windowSec:60}};
    expect((await pollActiveDecision(options(budget),g2.accountId)).state).toBe("unchanged");
    expect((await pollActiveDecision(options(budget),g2.accountId)).state).toBe("unchanged");
    expect(await pollActiveDecision(options(budget),g2.accountId)).toEqual({state:"limited",scope:"budget"});
  });
});
