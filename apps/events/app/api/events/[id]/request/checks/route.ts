import { ModelError } from "@didit-events/core/domain/model-error";
import { consentSchema } from "@didit-events/core/domain/event-model";
import { modelServices } from "@didit-events/core/verification/model-runtime";
import { z } from "zod";
import { failure,mutation,success,uuid } from "../../../../../../src/server/event-model-api";

export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{const {actor,body}=await mutation(request);if(actor.principal!=="guest")throw new ModelError("forbidden");const input=z.object({draftId:uuid,expectedPolicyVersion:z.number().int().positive(),consent:consentSchema,idFallbackConsented:z.boolean().optional()}).strict().parse(body);return success(await modelServices().verification.startRequestChecks(actor,uuid.parse((await context.params).id),input.draftId,input));}catch(e){return failure(e);}}
