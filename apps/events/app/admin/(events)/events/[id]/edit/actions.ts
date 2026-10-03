"use server";

import { requireEventAccess } from "../../../../../../src/auth/access";
import { guardAction,isBodyTooLarge } from "../../../../../../src/auth/actions";

import { eventService } from "@didit-events/core";
import { COVER_FILES,COVER_FILES_MAX_BYTES,coverAlt,stagedCoverError,uploadStagedCovers } from "../../../../../../src/server/event-cover-files";
import { revalidatePath } from "next/cache";
import type { EventFormState } from "../../../../../../src/admin/form/types";
import { EVENT_FIELDS_MAX_BYTES, readCover,readEventForm,toEventInput,validateEventForm } from "../../../../../../src/admin/form/validate";
import { adminLinks } from "../../../../../../src/admin/links";
import { updateEvent } from "./data";

/** A-03 "Save changes": validate (A-03b), update, then "✓ Saved · just now" (A-03d). */
export async function updateEventAction(_prev: EventFormState, form: FormData): Promise<EventFormState> {
  const id = String(form.get("id") ?? "");
  const actor = await requireEventAccess(id, "event.edit");
  try { await guardAction(form, { maxBytes: COVER_FILES_MAX_BYTES + EVENT_FIELDS_MAX_BYTES }); }
  catch (error) {
    if (!isBodyTooLarge(error)) throw error;
    const values = readEventForm(form), errors = validateEventForm(values, readCover(form));
    const coverError = await stagedCoverError(form, false); if (coverError) errors.cover = coverError;
    return { status: "invalid", values, errors: Object.keys(errors).length ? errors : { description: "Keep event fields under 512 KB." } };
  }
  const values = readEventForm(form);
  const errors = validateEventForm(values, readCover(form));
  const sizeError = await stagedCoverError(form, false); if (sizeError) errors.cover = sizeError;
  const fields = new FormData();
  for (const [key, value] of form) if (!COVER_FILES.some((c) => c.key === key)) fields.append(key, value);
  // Non-file fields carry the v2 editor JSON (20k Markdown + ~20 email bodies of 10k): 512 KiB, not the 64 KiB default.
  try { await guardAction(fields, { maxBytes: EVENT_FIELDS_MAX_BYTES }); }
  catch (error) {
    if (!isBodyTooLarge(error)) throw error;
    errors.description = "Keep event fields under 512 KB.";
  }
  if (!errors.cover) { const coverError = await stagedCoverError(form); if (coverError) errors.cover = coverError; }
  if (!values.v2) errors.descriptionMd = "Reload the editor and try again.";
  if (Object.keys(errors).length) return { status: "invalid", values, errors };
  let result;
  try { result = await updateEvent(id, toEventInput(values),Number(form.get("expectedVersion"))); }
  catch (error) { return {status:"error",values,message:error instanceof Error && error.message === "context_changed" ? "This event changed. Reload before saving." : "The event could not be saved. Check the fields and try again."}; }
  if (!result.ok) {
    if (result.reason === "capacity_below_approved") return { status: "invalid", values, errors: { capacity: "Below the guests already approved" } };
    return { status: "error", values, message: "This event no longer exists." };
  }
  // Staged files (the storage route was unavailable when they were picked): stored after the save.
  await uploadStagedCovers(actor, id, result.editVersion, coverAlt(form, values.name), form);
  revalidatePath(adminLinks.event(id), "layout");
  const saved = await eventService.get(id);
  return { status: "saved", values: {...values,v2:{...values.v2!,cover:saved!.cover}}, savedAt: result.savedAt, editVersion:saved!.editVersion };
}
