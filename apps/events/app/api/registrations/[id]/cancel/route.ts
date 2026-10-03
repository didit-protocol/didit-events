import { ModelError } from "@didit-events/core/domain/model-error";
import { z } from "zod";
import { failure,mutation,requests,success,uuid } from "../../../../../src/server/event-model-api";

export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{const {actor,body}=await mutation(request);if(actor.principal!=="guest")throw new ModelError("forbidden");const input=z.object({reason:z.string().max(500).optional(),expectedAdmission:z.enum(["pending","waitlisted","approved","cancelled_by_guest","cancelled_by_host","rejected","revoked"])}).strict().parse(body);return success(await requests().withdrawOrCancel(actor,uuid.parse((await context.params).id),input));}catch(e){return failure(e);}}
