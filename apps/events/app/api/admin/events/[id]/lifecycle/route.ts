import { EventEditor } from "@didit-events/core/admission/event-editor";
import { z } from "zod";
import { routeEventAccess } from "../../../../../../src/auth/access";
import { failure,success,uuid } from "../../../../../../src/server/event-model-api";
const input = z.object({action:z.enum(["publish","unpublish","end","cancel"]),expectedVersion:z.number().int().positive(),reason:z.string().trim().min(1).max(500).optional()}).strict();
export async function POST(request:Request, context:{params:Promise<{id:string}>}) {
  try {
    const id=uuid.parse((await context.params).id);
    const peek=input.safeParse(await request.clone().json().catch(()=>null));
    // Publish/unpublish run the event (hosts too); end and cancel are the danger zone (staff).
    const danger=peek.success && (peek.data.action==="end" || peek.data.action==="cancel");
    const {actor,event,body}=await routeEventAccess(request,id,danger?"event.danger":"event.publish",{maxBytes:65536,contentType:"application/json"});
    const values=input.parse(JSON.parse(Buffer.from(body!).toString("utf8")));
    if((values.action==="end"||values.action==="cancel")!==danger)throw new z.ZodError([]);
    return success(await new EventEditor().lifecycle(actor,event.id,values.action,values.expectedVersion,values.reason));
  } catch(error) {return failure(error);}
}
