import { emailPreviewConfigFromEnv } from "@didit-events/core/notifications";
import { EventEmailsService } from "@didit-events/core/notifications/event-emails";
import { eventMutation,failure,success,uuid } from "../../../../../../../src/server/event-model-api";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{
const {actor,event,body}=await eventMutation(request,uuid.parse((await context.params).id),"event.emails");
const result=await new EventEmailsService(emailPreviewConfigFromEnv()).preview(actor,event.id,body);
return success(result);}catch(e){return failure(e);}}
