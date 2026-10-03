import { eventService } from "@didit-events/core";
import type { WelcomePreview } from "../../../../../../../src/admin/form/types";
import type { EventSettings,SpendLimits } from "../../../../../../../src/admin/settings/types";
import { requireEventAccess } from "../../../../../../../src/auth/access";
import { questionCount,type DetailsValues } from "../../../../../../../src/admin/settings/details";
import { ModelError } from "@didit-events/core/domain/model-error";
import { scansToday } from "../../../../../../../src/admin/settings/limits";
import { adminModel,fmt,localInstant } from "../../../../../../../src/server/b4-views";
export async function getSettings(id: string): Promise<EventSettings | null> {
  await requireEventAccess(id, "event.edit");
  const model = await adminModel(id); if (!model) return null;
  const e = model.event, o = (e.welcomeOptions ?? {}) as { welcome?: WelcomePreview; dailyScanBudget?: number; questions?: unknown[] };
  const wall = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: e.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map(p => [p.type, p.value]));
  const start = wall(e.startsAt), end = wall(e.endsAt);
  return { eventId: e.id, editVersion: e.editVersion, details: { name: e.name, date: `${start.year}-${start.month}-${start.day}`, start: `${start.hour}:${start.minute}`, end: `${end.hour}:${end.minute}`, timeZone: e.timezone }, name: e.name, date: fmt(e, e.startsAt, { dateStyle: "medium" }), time: fmt(e, e.startsAt, { timeStyle: "short" }), requestForm: { open: !e.form.closes_at || new Date(e.form.closes_at) > new Date(), questions: questionCount(e.form.questions.length), capacity: e.capacity }, welcome: { subject: e.emails.templates["M-13"]?.subject ?? "Welcome to " + e.name, block: e.emails.templates["M-13"]?.body_md ?? "" }, limits: { dailyScanBudget: o.dailyScanBudget ?? 3000, scansToday: scansToday(e.timezone, model.scans), mode: e.door.kiosk && e.door.mode === "strict" ? "strict" : "supervised", strictness: (e.door.kiosk ? e.door.match_threshold : 80) as SpendLimits["strictness"] }, guestCount: model.approvedCount, status: e.status, ended: e.status === "ended" || e.status === "cancelled" };
}
export async function setRequestForm(id: string, open: boolean,expectedVersion?:number) {
  const actor = await requireEventAccess(id, "event.edit"); const e = await eventService.get(id); if (!e) return false; await eventService.update(actor, e.id, { expectedVersion, form: { ...e.form, closes_at: open ? null : new Date(Math.min(Date.now(), e.startsAt.getTime())).toISOString() } }); return true; }
export async function saveWelcome(id: string, welcome: WelcomePreview,expectedVersion?:number) {
  const actor = await requireEventAccess(id, "event.edit"); const e = await eventService.get(id); if (!e) return false; await eventService.update(actor, e.id, { expectedVersion, emails: { ...e.emails, templates: { ...e.emails.templates, "M-13": { enabled: e.emails.templates["M-13"]?.enabled ?? true, subject: welcome.subject, body_md: welcome.block } } } }); return true; }
export async function saveLimits(id: string, limits: SpendLimits,expectedVersion?:number) {
  const actor = await requireEventAccess(id, "event.limits"); const e = await eventService.get(id); if (!e) return false; await eventService.update(actor, e.id, { expectedVersion, door: e.door.kiosk ? { kiosk: true, mode: limits.mode, match_threshold: limits.strictness } : { kiosk: false }, welcomeOptions: { ...(e.welcomeOptions as object ?? {}), dailyScanBudget: limits.dailyScanBudget } }); return true; }
export async function endEvent(id: string,expectedVersion?:number) {
  const actor = await requireEventAccess(id, "event.danger"); const e = await eventService.get(id); if (!e) return false; if(expectedVersion!==e.editVersion)throw new Error("context_changed"); await eventService.end(actor, e.id,expectedVersion); return true; }
export async function deleteEvent(id: string) {
  const actor = await requireEventAccess(id, "event.delete"); const e = await eventService.get(id); if (!e) return false; await eventService.delete(actor, e.id); return true; }
/** Settings → Event details: name, date and times in the event's zone, saved against the edit version it was read at. */
export async function saveDetails(id: string, values: DetailsValues, expectedVersion: number): Promise<{ ok: true; editVersion: number } | { error: "not_found" | "conflict" | "closed" | "invalid" }> {
  const actor = await requireEventAccess(id, "event.edit"); const e = await eventService.get(id); if (!e) return { error: "not_found" };
  let startsAt: Date, endsAt: Date;
  try { startsAt = localInstant(`${values.date}T${values.start}`, e.timezone); endsAt = localInstant(`${values.date}T${values.end}`, e.timezone); } catch { return { error: "invalid" }; }
  try { const next = await eventService.update(actor, e.id, { expectedVersion, name: values.name.trim(), startsAt, endsAt }); return { ok: true, editVersion: next.editVersion }; }
  catch (error) { if (error instanceof ModelError) return { error: error.code === "context_changed" ? "conflict" : error.code === "closed" ? "closed" : "invalid" }; throw error; }
}
