import { EventEditor } from "@didit-events/core/admission/event-editor";
import { failure,globalMutation,success } from "../../../../src/server/event-model-api";
export async function POST(request: Request) {
  try {
    const { actor, body } = await globalMutation(request, "events.create");
    return success(await new EventEditor().create(actor, body));
  } catch (error) { return failure(error); }
}
