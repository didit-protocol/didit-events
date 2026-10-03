import { applicantDrawer } from "@didit-events/core/admission/applicants";
import { can } from "@didit-events/core/access/capabilities";
import { routeEventAccess } from "../../../../../../../src/auth/access";
import { failure,success,uuid } from "../../../../../../../src/server/event-model-api";
export async function GET(request:Request,context:{params:Promise<{id:string;registrationId:string}>}){try{const p=await context.params;const {actor,event}=await routeEventAccess(request,uuid.parse(p.id),"guests.view");const drawer=await applicantDrawer(actor,event.id,uuid.parse(p.registrationId));
  // Door operators see the profile without the selfie.
  return success(can(actor.scope?.role ?? actor.role,"guests.photo")?drawer:{...drawer,profile:{...drawer.profile,photoUrl:null}});}catch(e){return failure(e);}}
