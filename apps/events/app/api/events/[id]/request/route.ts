import { ModelError } from "@didit-events/core/domain/model-error";
import { draftWriteSchema } from "@didit-events/core/domain/event-model";
import { failure,guestRead,mutation,requests,success,uuid } from "../../../../../src/server/event-model-api";

// ?checksOp=<uuid> pins the extras operation the tab is waiting on (a malformed value is ignored, like a foreign one).
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{const pin=uuid.safeParse(new URL(request.url).searchParams.get("checksOp"));return success(await requests().getRequestContext(await guestRead(request),uuid.parse((await context.params).id),pin.success?{checksOp:pin.data}:{}));}catch(e){return failure(e);}}
export async function PUT(request:Request,context:{params:Promise<{id:string}>}){try{const {actor,body}=await mutation(request);if(actor.principal!=="guest")throw new ModelError("forbidden");return success(await requests().saveRequestDraft(actor,uuid.parse((await context.params).id),draftWriteSchema.parse(body)));}catch(e){return failure(e);}}
