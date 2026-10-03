"use server";

import { requireStaffAccess } from "../../../src/auth/access";
import { guardAction, isBodyTooLarge } from "../../../src/auth/actions";
import { revalidatePath } from "next/cache";
import { CalendarImageError, getCalendarProfile, removeCalendarImage, saveCalendarText, setCalendarImage, type CalendarImageKind } from "@didit-events/core/calendar";
import { adminLinks } from "../../../src/admin/links";
import { CALENDAR_IMAGE_MAX_BYTES, CALENDAR_IMAGE_TYPES, readCalendarForm, toCalendarInput, validateCalendarForm, type CalendarImageState, type CalendarSaveState } from "../../../src/admin/calendar/validate";
import { BUILT_IN_COPY } from "../../../src/public/calendar-profile";

const NEXT = "/admin/calendar";

function revalidateCalendar() {
  revalidatePath("/"); revalidatePath("/events"); revalidatePath(adminLinks.calendar());
}

/** Name, tagline, bio and links (owners and admins; CSRF-guarded). */
export async function saveCalendarAction(_prev: CalendarSaveState, form: FormData): Promise<CalendarSaveState> {
  const staff = await requireStaffAccess("calendar.edit", NEXT);
  try { await guardAction(form); }
  catch (error) {
    if (!isBodyTooLarge(error)) throw error;
    return { status: "invalid", values: readCalendarForm(form), errors: { description: "Keep the calendar fields under 64 KB." } };
  }
  const values = readCalendarForm(form);
  const errors = validateCalendarForm(values);
  if (Object.keys(errors).length) return { status: "invalid", values, errors };
  const row = await saveCalendarText(staff.email, toCalendarInput(values));
  revalidateCalendar();
  return { status: "saved", values, savedAt: row.updatedAt.toISOString() };
}

const IMAGE_ERRORS: Record<CalendarImageError["code"], string> = {
  NotAnImage: "That file is not a JPG, PNG or WebP image.",
  TooLarge: "Use an image under 5 MB.",
  BadDimensions: "That image is too small or too large. Use the recommended size.",
  Unreadable: "We couldn't read that image. Try another JPG or PNG",
};

/** Upload / replace the cover or the logo. The browser resizes first; the server re-checks the actual bytes. */
export async function uploadCalendarImageAction(kind: CalendarImageKind, _prev: CalendarImageState, form: FormData): Promise<CalendarImageState> {
  const staff = await requireStaffAccess("calendar.edit", NEXT);
  if (kind !== "cover" && kind !== "logo") return { error: "Unknown image." };
  try { await guardAction(form, { maxBytes: CALENDAR_IMAGE_MAX_BYTES + 64 * 1024 }); }
  catch (error) { if (isBodyTooLarge(error)) return { error: IMAGE_ERRORS.TooLarge }; throw error; }
  const file = form.get("image");
  if (!(file instanceof Blob) || file.size === 0) return { error: "Choose a JPG, PNG or WebP image." };
  if (file.size > CALENDAR_IMAGE_MAX_BYTES) return { error: IMAGE_ERRORS.TooLarge };
  if (!CALENDAR_IMAGE_TYPES.includes(file.type)) return { error: IMAGE_ERRORS.NotAnImage };
  try {
    const current = await getCalendarProfile();
    await setCalendarImage(staff.email, kind, new Uint8Array(await file.arrayBuffer()), current ?? BUILT_IN_COPY);
  } catch (error) {
    if (error instanceof CalendarImageError) return { error: IMAGE_ERRORS[error.code] };
    throw error;
  }
  revalidateCalendar();
  return { saved: true };
}

/** Remove (after the confirm dialog): the public page falls back to the built-in banner / Didit mark. */
export async function removeCalendarImageAction(kind: CalendarImageKind, _prev: CalendarImageState, form: FormData): Promise<CalendarImageState> {
  const staff = await requireStaffAccess("calendar.edit", NEXT);
  if (kind !== "cover" && kind !== "logo") return { error: "Unknown image." };
  await guardAction(form);
  await removeCalendarImage(staff.email, kind);
  revalidateCalendar();
  return { removed: true };
}
