import { randomUUID } from "node:crypto";
import { expect,it,vi } from "vitest";
import { AdmissionError } from "@didit-events/core/admission/shared";
import type * as Api from "./event-model-api";
import type * as Assets from "@didit-events/core/content/event-assets";

const state=vi.hoisted(()=>({principal:"staff",cover:vi.fn()}));
// Admin routes go through the capability guard: a guest who is on no event team is refused there (403).
vi.mock("./event-model-api",async original=>({...await original<typeof Api>(),mutation:async()=>({actor:{principal:state.principal},body:{}}),
  eventMutation:async()=>{const {IdentityError}=await import("@didit-events/core/identity");if(state.principal!=="staff")throw new IdentityError("EventForbidden",403);return {actor:{principal:"staff"},event:{id:randomUUID()},body:{}};}}));
vi.mock("@didit-events/core/content/event-assets",async original=>({...await original<typeof Assets>(),readEventCover:state.cover}));
type Handler=(request:Request,context:{params:Promise<{id:string}>})=>Promise<Response>;
const routes:[string,string,()=>Promise<Handler>][]=[
  ["registration renewal","staff",async()=>(await import("../../app/api/registrations/[id]/renew/route")).POST],
  ["registration cancel","staff",async()=>(await import("../../app/api/registrations/[id]/cancel/route")).POST],
  ["request draft","staff",async()=>(await import("../../app/api/events/[id]/request/route")).PUT],
  ["request checks","staff",async()=>(await import("../../app/api/events/[id]/request/checks/route")).POST],
  ["request submit","staff",async()=>(await import("../../app/api/events/[id]/request/submit/route")).POST],
  ["onboarding face","staff",async()=>(await import("../../app/api/me/onboarding/face/route")).POST],
  ["profile","staff",async()=>(await import("../../app/api/me/profile/route")).PATCH],
  ["face renewal","staff",async()=>(await import("../../app/api/me/verification/renew/route")).POST],
  ["event editor","guest",async()=>(await import("../../app/api/admin/events/[id]/editor/route")).PATCH],
  ["email preview","guest",async()=>(await import("../../app/api/admin/events/[id]/emails/preview/route")).POST],
  ["email test","guest",async()=>(await import("../../app/api/admin/events/[id]/emails/test/route")).POST],
];
it.each(routes)("%s rejects a mismatched principal with 403",async(_name,principal,load)=>{
  state.principal=principal;
  const response=await (await load())(new Request("https://events.test/api",{method:"POST"}),{params:Promise.resolve({id:randomUUID()})});
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ok:false,error:{code:"forbidden"}});
});
it.each([[new AdmissionError("Forbidden"),403],[new AdmissionError("EventNotFound"),404],[new Error("Database unavailable"),503]] as const)("cover maps %s failures to HTTP %s",async(error,status)=>{
  state.cover.mockRejectedValueOnce(error);
  const {GET}=await import("../../app/api/events/[id]/cover/route");
  const response=await GET(new Request("https://events.test/api/cover"),{params:Promise.resolve({id:randomUUID()})});
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ok:false});
});
it("cover maps malformed duplicate session cookies to 403",async()=>{
  const {GET}=await import("../../app/api/events/[id]/cover/route");
  const response=await GET(new Request("https://events.test/api/cover",{headers:{cookie:"__Host-sid=a; __Host-sid=b"}}),{params:Promise.resolve({id:randomUUID()})});
  expect(response.status).toBe(403);
});
