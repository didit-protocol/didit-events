import { applicantPhoto } from "@didit-events/core/admission/applicants";
import { routeEventAccess } from "../../../../../../../../src/auth/access";
import { failure,uuid } from "../../../../../../../../src/server/event-model-api";
export async function GET(request:Request,context:{params:Promise<{id:string;registrationId:string}>}){try{const p=await context.params;const {actor,event}=await routeEventAccess(request,uuid.parse(p.id),"guests.photo");return await applicantPhoto(actor,event.id,uuid.parse(p.registrationId));}catch(e){return failure(e);}}
