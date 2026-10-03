import { limitRequestSubmission } from "@didit-events/core/admission/request-limits";
import { sourceIpFromHeaders } from "../../../../../../src/auth/source-ip";
import { ModelError } from "@didit-events/core/domain/model-error";
import { submitRequestSchema } from "@didit-events/core/domain/event-model";
import { failure,mutation,requests,success,uuid } from "../../../../../../src/server/event-model-api";

export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{const {actor,body}=await mutation(request);if(actor.principal!=="guest")throw new ModelError("forbidden");await limitRequestSubmission(actor.accountId,sourceIpFromHeaders(request.headers));return success(await requests().submitRequest(actor,uuid.parse((await context.params).id),submitRequestSchema.parse(body)));}catch(e){return failure(e);}}
