import { EventEditor } from "@didit-events/core/admission/event-editor";
import { routeEventAccess } from "../../../../../../src/auth/access";
import { eventMutation,failure,success,uuid } from "../../../../../../src/server/event-model-api";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{const {actor,event}=await routeEventAccess(request,uuid.parse((await context.params).id),"event.edit");return success(await new EventEditor().view(actor,event.id));}catch(e){return failure(e);}}
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){try{const {actor,event,body}=await eventMutation(request,uuid.parse((await context.params).id),"event.edit");return success(await new EventEditor().save(actor,event.id,body));}catch(e){return failure(e);}}
