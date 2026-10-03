import type { EventEditorView } from "@didit-events/core/contracts/event-model";
import type { DomainEvent } from "@didit-events/core";
import { eventService } from "@didit-events/core";
import { EventEditor } from "@didit-events/core/admission/event-editor";
import type { EventFormValues,EventInput,WelcomePreview } from "../../../../../../src/admin/form/types";
import { splitAddress } from "../../../../../../src/admin/form/validate";
import { agendaRowsOf } from "../../../../../../src/admin/form/editor";
import { requireEventAccess } from "../../../../../../src/auth/access";
import { adminModel,eventInput,fmt } from "../../../../../../src/server/b4-views";

/** A picked place keeps Google's address; an older one-line address opens split into the manual fields. */
function addressValues(e: DomainEvent) {
  const address = e.address ?? "";
  const place = e.placeId ? { placeId: e.placeId, lat: e.lat === null ? "" : String(e.lat), lng: e.lng === null ? "" : String(e.lng), mapsUrl: e.mapsUrl ?? "" } : { placeId: "", lat: "", lng: "", mapsUrl: "" };
  return { address, ...splitAddress(address), ...place };
}
export async function getEventForEdit(id: string): Promise<{ name: string; values: EventFormValues; welcome: WelcomePreview; editor: EventEditorView } | null> {
  const actor = await requireEventAccess(id, "event.edit");
  const model = await adminModel(id); if (!model) return null;
  const e = model.event;
  const editor = await new EventEditor().view(actor, e.id);
  const local = (at: string) => { const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {timeZone:e.timezone, year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(at)).map(p=>[p.type,p.value])); return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`; };
  return { editor, name: e.name, values: { name: e.name, date: fmt(e, e.startsAt, { year: "numeric", month: "2-digit", day: "2-digit" }).split("/").reverse().join("-"), start: fmt(e, e.startsAt, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), end: fmt(e, e.endsAt, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), timezone: e.timezone, venue: e.venue ?? "", ...addressValues(e), capacity: String(e.capacity), description: e.description, v2: {descriptionMd:e.descriptionMd,checks:e.checks,door:e.door,form:e.form,emails:e.emails,cover:e.cover,speakers:editor.values.speakers,agenda:agendaRowsOf(e.agenda,e.timezone,e.startsAt),closesAtLocal:e.form.closes_at ? local(e.form.closes_at) : ""}, requestForm: !e.form.closes_at || new Date(e.form.closes_at!) > new Date(), questions: e.form.questions.filter(q => q.kind === "short" || q.kind === "long"), welcomeEmail: e.emails.templates["M-13"]?.enabled !== false, threshold: (e.door.kiosk ? e.door.match_threshold : 80) as EventFormValues["threshold"] }, welcome: { subject: e.emails.templates["M-13"]?.subject ?? "Welcome to " + e.name, block: e.emails.templates["M-13"]?.body_md ?? "" } };
}
export type UpdateResult = { ok: true; savedAt: string; editVersion: number } | { ok: false; reason: "not_found" | "capacity_below_approved" };
export async function updateEvent(id: string, input: EventInput,expectedVersion?:number): Promise<UpdateResult> {
  const actor = await requireEventAccess(id, "event.edit");
  const before = await eventService.get(id); if (!before) return { ok: false, reason: "not_found" };
  const mapped=eventInput(input);
  try { const event = await eventService.update(actor, before.id, { ...mapped, expectedVersion }); return { ok: true, savedAt: event.updatedAt.toISOString(), editVersion:event.editVersion }; }
  catch (error) { if (error instanceof Error && error.message === "CapacityBelowApproved") return { ok: false, reason: "capacity_below_approved" }; throw error; }
}

export async function getEventEditor(id:string){return new EventEditor().view(await requireEventAccess(id,"event.edit"),id);}
export async function saveEventEditor(id:string,input:unknown){return new EventEditor().save(await requireEventAccess(id,"event.edit"),id,input);}
