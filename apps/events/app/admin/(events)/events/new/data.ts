import { DEFAULT_V2 } from "../../../../../src/admin/form/editor";
import { editorEmailTemplates, providerCapabilities } from "@didit-events/core/admission/event-editor";
import { read } from "@didit-events/core/admission/shared";
import { requireStaffAccess } from "../../../../../src/auth/access";
import { randomUUID } from "node:crypto";
import { eventService } from "@didit-events/core";
import { DEFAULT_WELCOME, EMPTY_EVENT } from "../../../../../src/admin/form/defaults";
import { eventInput } from "../../../../../src/server/b4-views";
import type { EventInput } from "../../../../../src/admin/form/types";
export async function getNewEventDefaults() {
  await requireStaffAccess("events.create", "/admin/events/new"); return { values: {...EMPTY_EVENT,v2:structuredClone(DEFAULT_V2)}, capabilities:await providerCapabilities(read()), emailTemplates:editorEmailTemplates(DEFAULT_V2.emails), welcome: DEFAULT_WELCOME("") }; }
export async function createEvent(input: EventInput) {
  const actor = await requireStaffAccess("events.create", "/admin/events/new");
  const slug = input.name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 140);
  return eventService.create(actor, { ...eventInput(input), slug: slug + "-" + randomUUID().slice(0, 8) });
}
