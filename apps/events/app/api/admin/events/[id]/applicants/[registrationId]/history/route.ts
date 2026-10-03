import { applicantHistory } from "@didit-events/core/admission/applicants";
import { routeEventAccess } from "../../../../../../../../src/auth/access";
import { failure,success,uuid } from "../../../../../../../../src/server/event-model-api";
export async function GET(request:Request,context:{params:Promise<{id:string;registrationId:string}>}){try{const p=await context.params;const {actor,event}=await routeEventAccess(request,uuid.parse(p.id),"guests.view");const result=await applicantHistory(actor,event.id,uuid.parse(p.registrationId),undefined,new URL(request.url).searchParams.get("cursor"));return success(result);}catch(e){return failure(e);}}
