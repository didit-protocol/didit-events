"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { doorService } from "@didit-events/core/door/service";
import { COOKIE_NAMES, cookieAttributes, PolicyError } from "@didit-events/core/http/policy";
import { guardAction } from "../../../../../../src/auth/actions";
import { requireEventAccess } from "../../../../../../src/auth/access";
import { findEvent } from "../../../../../../src/auth/access";
import { doorPageSession } from "../../../../../../src/door/http";

export type DoorAdminResult = { ok: true } | { error: string };

/** Ends one device's door mode from here (a lost laptop, a door that should close). Capability door.manage. */
export async function endDoorSessionAction(eventId: string, doorSessionId: string, form: FormData): Promise<DoorAdminResult> {
  const actor = await requireEventAccess(eventId, "door.manage");
  await guardAction(form);
  const event = (await findEvent(eventId))!;
  if (!/^[0-9a-f-]{36}$/i.test(doorSessionId)) return { error: "That door is no longer running." };
  try { await doorService.endSessionById(actor, event.id, doorSessionId); }
  catch (error) { if (error instanceof PolicyError) return { error: error.status === 404 ? "That door is no longer running." : "Your role on this event can’t end doors." }; throw error; }
  revalidatePath(`/admin/events/${event.slug}/door`);
  return { ok: true };
}

/**
 * "End door mode on this device" on the Door tab: the signed-in member (door.operate) ends the door session this
 * browser carries and drops its door cookie. A cookie whose session is already over, or of another event, is dropped.
 */
export async function endDoorHereAction(eventId: string, form: FormData): Promise<DoorAdminResult> {
  const actor = await requireEventAccess(eventId, "door.operate");
  await guardAction(form);
  const event = (await findEvent(eventId))!;
  const here = await doorPageSession(event.id);
  if (here.door) {
    try { await doorService.endSession(actor, here.door); }
    catch (error) { if (!(error instanceof PolicyError)) throw error; }
  }
  (await cookies()).set(COOKIE_NAMES.door, "", cookieAttributes(COOKIE_NAMES.door, 0));
  revalidatePath(`/admin/events/${event.slug}/door`);
  return { ok: true };
}

/** Sets (6–8 digits) or clears the PIN that ends door mode without a sign-in. Capability door.pin (staff). */
export async function setDoorPinAction(eventId: string, form: FormData): Promise<DoorAdminResult> {
  const actor = await requireEventAccess(eventId, "door.pin");
  await guardAction(form);
  const event = (await findEvent(eventId))!;
  const clear = form.get("clear") === "1", pin = String(form.get("pin") ?? "").trim();
  if (!clear && !/^\d{6,8}$/.test(pin)) return { error: "Use 6 to 8 digits." };
  try { await doorService.setPin(actor, event.id, clear ? null : pin); }
  catch (error) { if (error instanceof PolicyError) return { error: error.status === 403 ? "Only Didit staff can set the door PIN." : "Use 6 to 8 digits." }; throw error; }
  revalidatePath(`/admin/events/${event.slug}/door`);
  return { ok: true };
}
