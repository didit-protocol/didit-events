import { requireEventAccess } from "../../../../../../../src/auth/access";
import { adminModel } from "../../../../../../../src/server/b4-views";
import { overview } from "../../../../../../../src/server/b4-overview";
export async function getOverview(eventId: string) {
  await requireEventAccess(eventId, "event.view"); const model = await adminModel(eventId); return model ? overview(model) : null; }
