import { afterEach,expect,it,vi } from "vitest";
import type * as Api from "./event-model-api";
import type * as Suggest from "@didit-events/core/profile/social-suggest";

const state=vi.hoisted(()=>({guest:true as boolean,suggest:vi.fn()}));
vi.mock("./event-model-api",async original=>({...await original<typeof Api>(),guestRead:async()=>{
  const {IdentityError}=await import("@didit-events/core/identity");
  if(!state.guest)throw new IdentityError("Unauthenticated",401);
  return {principal:"guest",accountId:"acc-1"};
}}));
vi.mock("@didit-events/core/profile/social-suggest",async original=>({...await original<typeof Suggest>(),suggestSocialProfiles:state.suggest,dbSocialSuggestStore:()=>({})}));
const call=async(query="?name=Alberto%20Rosas&company=Didit")=>(await import("../../app/api/me/profile/suggestions/route")).GET(new Request(`https://events.test/api/me/profile/suggestions${query}`));
afterEach(()=>{vi.unstubAllEnvs();state.guest=true;state.suggest.mockReset();});

it("requires a guest session",async()=>{
  vi.stubEnv("FIRECRAWL_API_KEY","fc-key");
  state.guest=false;
  const res=await call();
  expect(res.status).toBe(401);
  expect(state.suggest).not.toHaveBeenCalled();
});
it("is off (204, no lookup) without FIRECRAWL_API_KEY",async()=>{
  vi.stubEnv("FIRECRAWL_API_KEY","");
  const res=await call();
  expect(res.status).toBe(204);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(state.suggest).not.toHaveBeenCalled();
});
it("answers the suggestions for the account, private and uncached",async()=>{
  vi.stubEnv("FIRECRAWL_API_KEY","fc-key");
  const data={linkedin:[{url:"https://www.linkedin.com/in/albertorosas",label:"linkedin.com/in/albertorosas"}],x:[]};
  state.suggest.mockResolvedValue(data);
  const res=await call();
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(await res.json()).toEqual({ok:true,data});
  expect(state.suggest).toHaveBeenCalledWith({fullName:"Alberto Rosas",company:"Didit"},expect.objectContaining({accountId:"acc-1",apiKey:"fc-key"}));
});
it("caps what it forwards to the profile limits",async()=>{
  vi.stubEnv("FIRECRAWL_API_KEY","fc-key");
  state.suggest.mockResolvedValue({linkedin:[],x:[]});
  await call(`?name=${"a".repeat(500)}&company=${"b".repeat(500)}`);
  const [input]=state.suggest.mock.calls[0]!;
  expect(input.fullName).toHaveLength(240);
  expect(input.company).toHaveLength(120);
});
