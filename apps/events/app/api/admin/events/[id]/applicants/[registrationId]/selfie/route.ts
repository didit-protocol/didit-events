import { applicantSelfie } from "@didit-events/core/admission/applicants";
import { routeEventAccess } from "../../../../../../../../src/auth/access";
import { failure,uuid } from "../../../../../../../../src/server/event-model-api";

/** The selfie Didit approved, fetched from the decision on demand (private, no-store). Needs guests.photo. */
export async function GET(request:Request,context:{params:Promise<{id:string;registrationId:string}>}){try{const p=await context.params;const {actor,event}=await routeEventAccess(request,uuid.parse(p.id),"guests.photo");return await applicantSelfie(actor,event.id,uuid.parse(p.registrationId));}catch(e){return failure(e);}}
