"use server";

import { requireEventAccess } from "../../../../../../../src/auth/access";
import { guardAction, isBodyTooLarge } from "../../../../../../../src/auth/actions";

import { revalidatePath } from "next/cache";
import { log } from "@didit-events/core/log";
import { adminLinks } from "../../../../../../../src/admin/links";
import { cleanGuest, isEmail, type GuestProblem } from "../../../../../../../src/admin/guests/paste";
import type { GuestActionResult, GuestDetail, NewGuest } from "../../../../../../../src/admin/guests/types";
import { ADD_GUEST_COPY, acceptVerifiedEmail, addGuests, changeStatus, manualCheckIn, requestReverification, undoCheckIn, type StatusChange, type CapacityChange } from "./data";

// Every mutation rechecks staff access and applies C14 before domain writes.
// Every action re-reads the staff session (plan §4) and bounds its input.

const MAX_BATCH = 50;
const NOTE_MAX = 280;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const refresh = (eventId: string) => {
  revalidatePath(adminLinks.tab(eventId, "guests"));
  revalidatePath(adminLinks.event(eventId));
};

const cleanIds = (ids: unknown): string[] => (Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && ID_RE.test(x)).slice(0, 500) : []);

export type AddOneState = { status: "idle" } | { status: "invalid"; errors: Partial<Record<"first" | "last" | "email", string>>; values: NewGuest & { note: string; send: boolean } } | { status: "added" | "waitlisted"; name: string } | { status: "error"; message: string };

/** A-07 "One guest". */
export async function addGuestAction(eventId: string, _prev: AddOneState, form: FormData): Promise<AddOneState> {
  await requireEventAccess(eventId, "guests.invite");
  await guardAction(form);
  const values = {
    first: String(form.get("first") ?? "").trim(),
    last: String(form.get("last") ?? "").trim(),
    email: String(form.get("email") ?? "").trim(),
    note: String(form.get("note") ?? "").trim().slice(0, NOTE_MAX),
    send: form.get("send") === "on",
  };
  const errors: Partial<Record<"first" | "last" | "email", string>> = {};
  if (!values.first) errors.first = "Add a first name";
  if (!values.email) errors.email = "Add an email";
  else if (!isEmail(values.email)) errors.email = "Enter a valid email, like name@company.com";
  // Field messages for the form; `cleanGuest` (the paste preview's validator) decides what is stored.
  const checked = cleanGuest(values);
  if (!checked.ok) return { status: "invalid", errors: Object.keys(errors).length ? errors : { [checked.reason === "missing-name" ? "first" : "email"]: "Check this field" }, values };
  let outcome;
  try { outcome = await addGuests(String(eventId), [checked.guest], values.send); }
  catch (error) { log("admin.add_guest_failed", { eventId: String(eventId), error }); return { status: "error", message: "Couldn’t add this guest right now. Try again in a moment." }; }
  const { added, waitlisted, duplicates } = outcome;
  if ("problem" in outcome && outcome.problem) {
    if (outcome.problem === "invalid_email") return { status: "invalid", errors: { email: ADD_GUEST_COPY.invalid_email }, values };
    return { status: "error", message: ADD_GUEST_COPY[outcome.problem] };
  }
  if (waitlisted) { refresh(eventId); return { status: "waitlisted", name: `${values.first} ${values.last}`.trim() }; }
  if (!added) return { status: "invalid", errors: { email: duplicates.length ? `${values.email} is already on the list` : "Couldn’t add this guest" }, values };
  refresh(eventId);
  return { status: "added", name: `${values.first} ${values.last}`.trim() };
}

export type BatchOutcome = { added: number; waitlisted: number; duplicates: string[]; invalid: { row: number; reason: GuestProblem }[] };

/**
 * A-07 "Paste a list": one batch (the client sends ≤50 rows at a time so the progress bar is real). Each row is
 * re-validated with the preview's `cleanGuest`; `invalid[].row` is the row's index in `guests`.
 */
export async function addGuestBatchAction(eventId: string, guests: unknown[], sendLink: boolean, csrf?: string): Promise<GuestActionResult<BatchOutcome>> {
  await requireEventAccess(eventId, "guests.invite");
  const form = new FormData(); form.set("csrf", csrf ?? ""); form.set("payload", JSON.stringify([eventId, guests, sendLink]));
  try { await guardAction(form, { maxBytes: 2 * 1024 * 1024 }); }
  catch (error) { if (isBodyTooLarge(error)) return { error: "invalid", message: "Keep guest lists under 2 MB." }; throw error; }
  if (!Array.isArray(guests) || guests.length > MAX_BATCH) return { error: "invalid" };
  const clean: NewGuest[] = [];
  const invalid: BatchOutcome["invalid"] = [];
  guests.forEach((g, row) => {
    const checked = cleanGuest(g);
    if (checked.ok) clean.push(checked.guest);
    else invalid.push({ row, reason: checked.reason });
  });
  let result: Awaited<ReturnType<typeof addGuests>>;
  try { result = clean.length ? await addGuests(String(eventId), clean, sendLink === true) : { added: 0, waitlisted: 0, duplicates: [] }; }
  catch (error) { log("admin.add_guest_failed", { eventId: String(eventId), error }); return { error: "conflict", message: "Couldn’t add these guests right now. Try again in a moment." }; }
  if (result.added || result.waitlisted) refresh(eventId);
  if ("problem" in result && result.problem) return { error: "conflict", message: ADD_GUEST_COPY[result.problem] };
  return { ok: true, added: result.added, waitlisted: result.waitlisted, duplicates: result.duplicates, invalid };
}

/** A-05 bulk bar + row menu + drawer: approve, send links, revoke. Disallowed rows come back in `skipped` with a reason. */
export async function bulkGuestsAction(eventId: string, action: "approve" | "send" | "revoke", ids: unknown, csrf?: string, options: { overCapacity?: boolean } = {}): Promise<GuestActionResult<StatusChange> | CapacityChange> {
  await requireEventAccess(eventId, "requests.decide");
  const form = new FormData(); form.set("csrf", csrf ?? ""); form.set("payload", JSON.stringify([eventId, action, ids, options]));
  await guardAction(form);
  const list = cleanIds(ids);
  if (!list.length || !["approve", "send", "revoke"].includes(action)) return { error: "invalid" };
  const result = await changeStatus(String(eventId), list, action, { overCapacity: options.overCapacity === true });
  if (result.changed.length) refresh(eventId);
  if ("error" in result) return result;
  return { ok: true, ...result };
}

/** A-14 manual check-in (no face) with an optional note; eligibility comes from the stored registration. */
export async function manualCheckInAction(eventId: string, guestId: string, note: string, csrf?: string): Promise<GuestActionResult<{ detail: GuestDetail }>> {
  const actor = await requireEventAccess(eventId, "checkin.manual");
  const form = new FormData(); form.set("csrf", csrf ?? ""); form.set("payload", JSON.stringify([eventId, guestId, note]));
  await guardAction(form);
  const staff = actor;
  if (!ID_RE.test(String(guestId))) return { error: "invalid" };
  const result = await manualCheckIn(String(eventId), guestId, staff.email, String(note ?? "").trim().slice(0, NOTE_MAX));
  if (!result.ok) return result.error === "not_found" ? { error: "not_found" } : { error: "conflict", message: result.message ?? "Only approved guests can be checked in." };
  refresh(eventId);
  return { ok: true, detail: result.detail };
}

/** A-15 undo check-in (also the 10 s toast Undo after A-14). */
export async function undoCheckInAction(eventId: string, guestId: string, csrf?: string): Promise<GuestActionResult<{ detail: GuestDetail }>> {
  const actor = await requireEventAccess(eventId, "checkin.manual");
  const form = new FormData(); form.set("csrf", csrf ?? ""); form.set("payload", JSON.stringify([eventId, guestId]));
  await guardAction(form);
  const staff = actor;
  if (!ID_RE.test(String(guestId))) return { error: "invalid" };
  const detail = await undoCheckIn(String(eventId), guestId, staff.email);
  if (!detail) return { error: "conflict", message: "This guest isn’t checked in." };
  refresh(eventId);
  return { ok: true, detail };
}

/** A-16: accept the verified email, or ask the guest to verify again with the invited one. */
export async function resolveEmailMismatchAction(eventId: string, guestId: string, choice: "accept" | "reverify", csrf?: string, reviewed?: { session: string; email: string }): Promise<GuestActionResult> {
  await requireEventAccess(eventId, "guests.verification");
  const form = new FormData(); form.set("csrf", csrf ?? ""); form.set("payload", JSON.stringify([eventId, guestId, choice, reviewed]));
  await guardAction(form);
  if (!ID_RE.test(String(guestId))) return { error: "invalid" };
  const ok = choice === "accept" ? await acceptVerifiedEmail(String(eventId), guestId, reviewed) : choice === "reverify" ? await requestReverification(String(eventId), guestId) : false;
  if (!ok) return { error: "conflict" };
  refresh(eventId);
  return { ok: true };
}
