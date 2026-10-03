import { authService } from "@didit-events/core";
import { Requests } from "@didit-events/core/admission/requests";
import { AdmissionError } from "@didit-events/core/admission/shared";
import { getDb } from "@didit-events/core/db";
import { ModelError } from "@didit-events/core/domain/model-error";
import { COOKIE_NAMES,PolicyError,requestCookies } from "@didit-events/core/http/policy";
import { IdentityError } from "@didit-events/core/identity";
import { Onboarding } from "@didit-events/core/identity/onboarding";
import { z } from "zod";
import { guardBrowser } from "../auth/browser";
import { routeEventAccess, routeGlobalAccess } from "../auth/access";
import type { EventCapability, GlobalCapability } from "@didit-events/core/access/capabilities";
export const uuid = z.uuid();
export function readOnboarding() { return new Onboarding({db:getDb(),launch:async()=>({state:"blocked",code:"provider_unavailable"})}); }
export function requests() { return new Requests(getDb()); }
export async function guestRead(request:Request) { return authService.requireGuest(requestCookies(request).get(COOKIE_NAMES.session) ?? ""); }
export async function mutation(request:Request,staff=false) {
  const proof=await guardBrowser(request,{maxBytes:65536,contentType:"application/json"});
  const actor=staff?await authService.requireStaff(proof.sessionCookie):await authService.requireGuest(proof.sessionCookie);
  let body:unknown;try{body=JSON.parse(Buffer.from(proof.body).toString("utf8"));}catch{throw new ModelError("invalid");}
  return {actor,body};
}
/** Admin JSON mutation on one event: Origin + CSRF + the capability (staff or that event's team). */
export async function eventMutation(request:Request,idOrSlug:string,capability:EventCapability) {
  const {actor,event,body:bytes}=await routeEventAccess(request,idOrSlug,capability,{maxBytes:65536,contentType:"application/json"});
  let body:unknown;try{body=JSON.parse(Buffer.from(bytes!).toString("utf8"));}catch{throw new ModelError("invalid");}
  return {actor,event,body};
}
/** Admin JSON mutation not about one event (staff capabilities). */
export async function globalMutation(request:Request,capability:GlobalCapability) {
  const {actor,body:bytes}=await routeGlobalAccess(request,capability,{maxBytes:65536,contentType:"application/json"});
  if(!actor)throw new IdentityError("StaffForbidden",403);
  let body:unknown;try{body=JSON.parse(Buffer.from(bytes!).toString("utf8"));}catch{throw new ModelError("invalid");}
  return {actor,body};
}
export function success(data:unknown) { return Response.json({ok:true,data},{headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}}); }
export function failure(error:unknown) {
  if(error instanceof AdmissionError) {
    const codes:Record<string,ConstructorParameters<typeof ModelError>[0]>={Forbidden:"forbidden",RegistrationNotFound:"not_found",EventNotFound:"not_found",AccountUnavailable:"not_found",Capacity:"capacity",EventClosed:"closed",InvalidTransition:"context_changed",VersionConflict:"context_changed"};
    error=new ModelError(codes[error.code] ?? "invalid");
  }
  const status=error instanceof ModelError || error instanceof IdentityError || error instanceof PolicyError?error.status:error instanceof z.ZodError?422:503;
  if(status===503 && !(error instanceof ModelError))console.error(JSON.stringify({event:"api.unexpected_error",fields:{name:error instanceof Error?error.name:typeof error,message:error instanceof Error?error.message.slice(0,300):String(error).slice(0,300)}}));
  const code=error instanceof ModelError?error.code:status===401?"unauthenticated":status===403?"forbidden":status===422?"invalid":"provider_unavailable";
  const detail=error instanceof ModelError?{code,message:error.message,fields:error.fields,context:error.context,retryAfterMs:error.retryAfterMs}:{code,message:code};
  return Response.json({ok:false,error:detail},{status,headers:{"Cache-Control":"private, no-store",...(error instanceof ModelError && error.retryAfterMs?{"Retry-After":String(Math.ceil(error.retryAfterMs/1000))}:{})}});
}
