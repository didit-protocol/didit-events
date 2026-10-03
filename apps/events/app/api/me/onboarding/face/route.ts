import { ModelError } from "@didit-events/core/domain/model-error";
import { consentSchema } from "@didit-events/core/domain/event-model";
import { modelServices } from "@didit-events/core/verification/model-runtime";
import { z } from "zod";
import { failure,mutation,success } from "../../../../../src/server/event-model-api";

export async function POST(request:Request){try{const {actor,body}=await mutation(request);if(actor.principal!=="guest")throw new ModelError("forbidden");const input=z.object({purpose:z.enum(["onboarding","face_renewal","re_enrolment"]),consent:consentSchema,returnTo:z.string().max(500).optional()}).strict().parse(body);return success(await modelServices().onboarding.ensureFaceSession(actor,input));}catch(e){return failure(e);}}
