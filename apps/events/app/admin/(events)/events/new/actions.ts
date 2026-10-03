"use server";

import { requireStaffAccess } from "../../../../../src/auth/access";
import { guardAction,isBodyTooLarge } from "../../../../../src/auth/actions";

import { COVER_FILES,COVER_FILES_MAX_BYTES,coverAlt,stagedCoverError,uploadStagedCovers } from "../../../../../src/server/event-cover-files";
import { redirect } from "next/navigation";
import type { EventFormState } from "../../../../../src/admin/form/types";
import { EVENT_FIELDS_MAX_BYTES, readCover,readEventForm,toEventInput,validateEventForm } from "../../../../../src/admin/form/validate";
import { adminLinks } from "../../../../../src/admin/links";
import { createEvent } from "./data";

/** A-03 "Create event": validate (A-03b), create, then open the new event. */
export async function createEventAction(_prev: EventFormState, form: FormData): Promise<EventFormState> {
  const actor = await requireStaffAccess("events.create", "/admin/events/new");
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
  let created;
  try { created = await createEvent(toEventInput(values)); }
  catch { return {status:"error",values,message:"The event could not be saved. Check the fields and try again."}; }
  const {id} = created;
  // Staged square cover and banner: stored right after creation, so neither image is lost.
  await uploadStagedCovers(actor, id, 1, coverAlt(form, values.name), form);
  redirect(adminLinks.event(id));
}
