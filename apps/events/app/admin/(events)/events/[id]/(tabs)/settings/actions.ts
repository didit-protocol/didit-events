"use server";

import { requireEventAccess } from "../../../../../../../src/auth/access";
import { guardAction } from "../../../../../../../src/auth/actions";

import { revalidatePath } from "next/cache";
import { eventService } from "@didit-events/core";
import { ModelError } from "@didit-events/core/domain/model-error";
import { redirect } from "next/navigation";
import { adminLinks } from "../../../../../../../src/admin/links";
import { parseLimits } from "../../../../../../../src/admin/settings/limits";
import type { SettingsSaveState } from "../../../../../../../src/admin/settings/types";
import { normalizeTime } from "@didit-events/ui/time";
import { validateDetails, type DetailsErrors, type DetailsValues } from "../../../../../../../src/admin/settings/details";
import { deleteEvent, endEvent, getSettings, saveDetails, saveLimits, saveWelcome, setRequestForm } from "./data";

// C14 is checked before resolving the authoritative staff session for every mutation.

type Simple = { ok: true } | { error: "session_expired" | "not_found" | "invalid" | "conflict" };
const SUBJECT_MAX = 150;
const BLOCK_MAX = 1000;

const refresh = (id: string) => {
  revalidatePath(adminLinks.tab(id, "settings"));
  revalidatePath(adminLinks.event(id));
};

export async function lifecycleAction(eventId: string, operation: "publish" | "cancel", reason = "", csrf?: string,expectedVersion?:number): Promise<Simple> {
  // Publishing is part of running the event (hosts too); cancelling is the danger zone (staff).
  const actor = await requireEventAccess(eventId, operation === "cancel" ? "event.danger" : "event.publish");
  const form = new FormData(); form.set("csrf", csrf ?? ""); form.set("payload", JSON.stringify([eventId, operation, reason]));
  await guardAction(form);
  if (!["publish", "cancel"].includes(operation) || operation === "cancel" && (!reason.trim() || reason.length > 500)) return { error: "invalid" };
  const event = await eventService.get(String(eventId)); if (!event) return { error: "not_found" };
  // A stale (or missing) version is its own answer: the client tells the admin to refresh instead of a generic failure.
  if (expectedVersion !== event.editVersion) return { error: "conflict" };
  try {
    if (operation === "publish") await eventService.publish(actor, event.id,expectedVersion);
    else await eventService.cancel(actor, event.id, reason.trim(),expectedVersion);
  } catch (error) { return { error: error instanceof ModelError && error.code === "context_changed" ? "conflict" : "invalid" }; }
  revalidatePath(adminLinks.home()); refresh(event.id); return { ok: true };
}

export type DetailsResult = { ok: true; editVersion: number } | { error: "session_expired" | "not_found" | "conflict" | "closed" | "invalid"; errors?: DetailsErrors };

/** A-11 "Event details": the inline name, date and start/end times (the full editor keeps the rest). */
export async function saveDetailsAction(eventId: string, values: DetailsValues, expectedVersion: number, csrf?: string): Promise<DetailsResult> {
  await requireEventAccess(eventId, "event.edit");
  const form = new FormData(); form.set("csrf", csrf ?? ""); form.set("payload", JSON.stringify([eventId, values, expectedVersion]));
  await guardAction(form);
  const v: DetailsValues = { name: String(values?.name ?? ""), date: String(values?.date ?? ""), start: String(values?.start ?? ""), end: String(values?.end ?? "") };
  const errors = validateDetails(v);
  if (Object.keys(errors).length || !Number.isInteger(expectedVersion)) return { error: "invalid", errors };
  const result = await saveDetails(String(eventId), { ...v, start: normalizeTime(v.start)!, end: normalizeTime(v.end)! }, expectedVersion);
  if ("ok" in result) refresh(eventId);
  return result;
}

/** A-11 "Request form" switch: open or close the public request link. */
export async function setRequestFormAction(eventId: string, open: boolean, csrf?: string,expectedVersion?:number): Promise<Simple> {
  await requireEventAccess(eventId, "event.edit");
  const form = new FormData(); form.set("csrf", csrf ?? ""); form.set("payload", JSON.stringify([eventId, open]));
  await guardAction(form);
  if (typeof open !== "boolean") return { error: "invalid" };
  if (!(await setRequestForm(String(eventId), open,expectedVersion))) return { error: "not_found" };
  refresh(eventId);
  return { ok: true };
}

/** A-11 "Welcome email": subject + the Wi-Fi and agenda block (M-13). */
export async function saveWelcomeAction(eventId: string, _prev: SettingsSaveState, form: FormData): Promise<SettingsSaveState> {
  await requireEventAccess(eventId, "event.edit");
  await guardAction(form);
  const subject = String(form.get("subject") ?? "").trim();
  const block = String(form.get("block") ?? "").trim();
  const errors: Record<string, string> = {};
  if (!subject) errors.subject = "Add a subject";
  else if (subject.length > SUBJECT_MAX) errors.subject = `Up to ${SUBJECT_MAX} characters`;
  if (block.length > BLOCK_MAX) errors.block = `Up to ${BLOCK_MAX} characters`;
  if (Object.keys(errors).length) return { status: "invalid", errors };
  if (!(await saveWelcome(String(eventId), { subject, block },Number(form.get("expectedVersion"))))) return { status: "error", message: "This event no longer exists." };
  refresh(eventId);
  return { status: "saved" };
}

/** A-18 "Spend and limits": daily scan budget, door mode, matching strictness. */
export async function saveLimitsAction(eventId: string, _prev: SettingsSaveState, form: FormData): Promise<SettingsSaveState> {
  await requireEventAccess(eventId, "event.limits");
  await guardAction(form);
  const current = await getSettings(String(eventId));
  if (!current) return { status: "error", message: "This event no longer exists." };
  const parsed = parseLimits({ budget: form.get("budget"), mode: form.get("mode"), strictness: form.get("strictness") }, current.limits.scansToday);
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors };
  await saveLimits(current.eventId, parsed.limits,Number(form.get("expectedVersion")));
  refresh(eventId);
  return { status: "saved" };
}

/** A-11 "End event": stops all kiosks and locks the check-in log. */
export async function endEventAction(eventId: string, csrf?: string,expectedVersion?:number): Promise<Simple> {
  await requireEventAccess(eventId, "event.danger");
  const form = new FormData(); form.set("csrf", csrf ?? ""); form.set("payload", JSON.stringify([eventId]));
  await guardAction(form);
  if (!(await endEvent(String(eventId),expectedVersion))) return { error: "not_found" };
  refresh(eventId);
  return { ok: true };
}

/** A-11b "Delete event": only with the exact event name typed; then back to the events list. */
export async function deleteEventAction(eventId: string, typedName: string, csrf?: string): Promise<Simple> {
  await requireEventAccess(eventId, "event.delete");
  const form = new FormData(); form.set("csrf", csrf ?? ""); form.set("payload", JSON.stringify([eventId, typedName]));
  await guardAction(form);
  const current = await getSettings(String(eventId));
  if (!current) return { error: "not_found" };
  if (String(typedName ?? "").trim() !== current.name) return { error: "invalid" };
  await deleteEvent(current.eventId);
  revalidatePath(adminLinks.home());
  redirect(adminLinks.home());
}
