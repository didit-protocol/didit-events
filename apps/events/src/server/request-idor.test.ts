import "../testing/b4";
import { randomUUID } from "node:crypto";
import { authService } from "@didit-events/core";
import { Requests } from "@didit-events/core/admission/requests";
import { queryable } from "@didit-events/core/db/tx";
import { DiditClient } from "@didit-events/core/didit/client";
import { randomToken,signToken } from "@didit-events/core/identity/shared";
import { createModelServices } from "@didit-events/core/verification/model-runtime";
import type * as Runtime from "@didit-events/core/verification/model-runtime";
import { beforeEach,afterEach,expect,it,vi } from "vitest";
import { guestFixture,requestFixture } from "../../../../packages/core/src/testing/model";
import { POST as renew } from "../../app/api/registrations/[id]/renew/route";
import { POST as cancel } from "../../app/api/registrations/[id]/cancel/route";
import { POST as checks } from "../../app/api/events/[id]/request/checks/route";
import { POST as submit } from "../../app/api/events/[id]/request/submit/route";
import { GET as readRequest } from "../../app/api/events/[id]/request/route";
import { auth,databaseSuite } from "../testing/b4";
import { csrfToken } from "../auth/browser";

const runtime=vi.hoisted(()=>({model:undefined as ReturnType<typeof createModelServices>|undefined}));
vi.mock("@didit-events/core/verification/model-runtime",async original=>({...await original<typeof Runtime>(),modelServices:()=>runtime.model!}));
const state=databaseSuite(),origin="https://events.example.test",secret="idor-test-secret-over-thirty-two-characters";
const cookie=signToken(randomToken(),secret,"session"),csrf=csrfToken(cookie,secret);
const transport=vi.fn<typeof fetch>().mockRejectedValue(new Error("Unexpected provider request"));
beforeEach(()=>{
  vi.stubEnv("APP_URL",origin);vi.stubEnv("SESSION_SECRET",secret);transport.mockClear();
  runtime.model=createModelServices({db:state.db,client:new DiditClient({apiKey:"fake",fetch:transport}),appUrl:origin});
  vi.spyOn(authService,"requireGuest").mockImplementation(async()=>auth.guest!);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
const request=(body:unknown)=>new Request(`${origin}/api`,{method:"POST",headers:{origin,"content-type":"application/json",cookie:`__Host-sid=${cookie}; __Host-csrf=${csrf}`,"x-csrf":csrf},body:JSON.stringify(body)});
it.each(["renew","cancel","checks","submit draft","submit replay"] as const)("%s denies another account's identifiers without changing its data",async action=>{
  const q=queryable(state.db),owner=auth.guest!,requests=new Requests(state.db),input=await requestFixture(state.db,owner,state.eventId);
  const draft=await requests.saveRequestDraft(owner,state.otherId,{expectedVersion:1,policyVersion:1,formVersion:1,application:input.application,consent:{...input.consent,disclosureVersion:"events-profile-v2"}});
  const [submission]=await q.query<{id:string}>("select id from registration_submissions where registration_id=$1",[state.registrationId]);
  const before={registrations:await q.query("select * from registrations order by id"),drafts:await q.query("select * from registration_drafts order by id"),outbox:await q.query("select id from outbox order by id")};
  auth.guest=await guestFixture(state.db,"other-account@example.test");
  let response:Response;
  if(action==="renew")response=await renew(request({strategy:"minimal"}),{params:Promise.resolve({id:state.registrationId})});
  else if(action==="cancel")response=await cancel(request({expectedAdmission:"pending"}),{params:Promise.resolve({id:state.registrationId})});
  else if(action==="checks")response=await checks(request({draftId:draft.draft!.id,expectedPolicyVersion:1,consent:input.consent}),{params:Promise.resolve({id:state.otherId})});
  else {
    const eventId=action==="submit draft"?state.otherId:state.eventId;
    const body=await requestFixture(state.db,auth.guest,eventId);
    response=await submit(request({...body,...(action==="submit draft"?{draftId:draft.draft!.id}:{idempotencyKey:submission!.id})}),{params:Promise.resolve({id:eventId})});
  }
  expect(response.status).toBe(404);expect(await response.json()).toMatchObject({ok:false,error:{code:"not_found"}});
  expect(await q.query("select * from registrations order by id")).toEqual(before.registrations);
  expect(await q.query("select * from registration_drafts order by id")).toEqual(before.drafts);
  expect(await q.query("select id from outbox order by id")).toEqual(before.outbox);
  expect(transport).not.toHaveBeenCalled();
});
it("GET request forwards a well-formed checksOp pin and ignores a malformed one",async()=>{
  const read=vi.spyOn(Requests.prototype,"getRequestContext"),pin=randomUUID();
  const get=(query:string)=>readRequest(new Request(`${origin}/api/events/${state.eventId}/request${query}`,{headers:{origin,cookie:`__Host-sid=${cookie}; __Host-csrf=${csrf}`}}),{params:Promise.resolve({id:state.eventId})});
  expect((await get(`?checksOp=${pin}`)).status).toBe(200);
  expect((await get("?checksOp=not-a-uuid")).status).toBe(200);
  expect((await get("")).status).toBe(200);
  expect(read.mock.calls.map(c=>c[2])).toEqual([{checksOp:pin},{},{}]);
});
