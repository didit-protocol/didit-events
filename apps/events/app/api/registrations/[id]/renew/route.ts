import { ModelError } from "@didit-events/core/domain/model-error";
import { renewalInputSchema } from "@didit-events/core/domain/event-model";
import { modelServices } from "@didit-events/core/verification/model-runtime";
import { failure,mutation,success,uuid } from "../../../../../src/server/event-model-api";

export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{const {actor,body}=await mutation(request);if(actor.principal!=="guest")throw new ModelError("forbidden");return success(await modelServices().verification.startRegistrationRenewal(actor,uuid.parse((await context.params).id),renewalInputSchema.parse(body)));}catch(e){return failure(e);}}
