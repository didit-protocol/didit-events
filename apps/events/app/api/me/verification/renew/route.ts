import { ModelError } from "@didit-events/core/domain/model-error";
import { consentSchema } from "@didit-events/core/domain/event-model";
import { modelServices } from "@didit-events/core/verification/model-runtime";
import { z } from "zod";
import { failure,mutation,success } from "../../../../../src/server/event-model-api";
export async function POST(request:Request){try{const {actor,body}=await mutation(request);if(actor.principal!=="guest")throw new ModelError("forbidden");const input=z.object({consent:consentSchema}).strict().parse(body);return success(await modelServices().onboarding.ensureFaceSession(actor,{purpose:"face_renewal",consent:input.consent}));}catch(e){return failure(e);}}
