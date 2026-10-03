import { emailPreviewConfigFromEnv } from "@didit-events/core/notifications";
import { EventEmailsService } from "@didit-events/core/notifications/event-emails";
import { eventMutation,failure,uuid } from "../../../../../../../src/server/event-model-api";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{
const {actor,event,body}=await eventMutation(request,uuid.parse((await context.params).id),"event.emails");
const result=await new EventEmailsService(emailPreviewConfigFromEnv()).test(actor,event.id,body);
return Response.json({ok:true,data:result},{status:202,headers:{"Cache-Control":"private, no-store"}});}catch(e){return failure(e);}}
