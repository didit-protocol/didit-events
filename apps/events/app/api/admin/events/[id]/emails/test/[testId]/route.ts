import { emailConfigFromEnv } from "@didit-events/core/notifications";
import { EventEmailsService } from "@didit-events/core/notifications/event-emails";
import { routeEventAccess } from "../../../../../../../../src/auth/access";
import { failure,success,uuid } from "../../../../../../../../src/server/event-model-api";
export async function GET(request:Request,context:{params:Promise<{id:string;testId:string}>}){try{const p=await context.params;const {actor,event}=await routeEventAccess(request,uuid.parse(p.id),"event.emails");return success(await new EventEmailsService(emailConfigFromEnv()).status(actor,event.id,uuid.parse(p.testId)));}catch(e){return failure(e);}}
