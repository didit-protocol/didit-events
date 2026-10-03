import { describe, expect, it } from "vitest";
import { auth, databaseSuite } from "../../testing/b4";
import { queryable } from "@didit-events/core/db/tx";
import { requestFixture } from "../../../../../packages/core/src/testing/model";
import { admissionService, eventService } from "@didit-events/core";
import { decideAction, inviteAction, saveRequirementsAction, saveNoteAction, undoRejectAction } from "../../../app/admin/(events)/events/[id]/(tabs)/applicants/actions";
import { getEventHeader } from "../../../app/admin/(events)/events/[id]/data";
import { listApplicants } from "../../../app/admin/(events)/events/[id]/(tabs)/applicants/data";
import { parseApplicantQuery } from "./query";
const state = databaseSuite(), query = parseApplicantQuery({});
describe("B4 applicant actions on a real database", () => {
 it("works for every event and the header shares pending/full counts", async () => {
  expect((await listApplicants(state.eventId, query))!.counts.pending).toBe(1);
  expect((await listApplicants(state.otherId, query))!.counts.pending).toBe(0);
  expect((await getEventHeader(state.eventId))!.requestCount).toBe(1);
  expect(await decideAction(state.eventId, "approve", [state.registrationId])).toMatchObject({ ok: true, done: [state.registrationId] });
  expect((await getEventHeader(state.eventId))!.requestCount).toBe(0);
  expect((await getEventHeader(state.eventId))!.guestCount).toBe(1);
  expect(await queryable(state.db).query("select admission from registrations where id=$1", [state.registrationId])).toEqual([{ admission: "approved" }]);
 });
 it("validates IDs, reasons and event ownership before decisions", async () => {
  expect(await decideAction(state.eventId, "reject", [state.registrationId])).toMatchObject({ error: "invalid", message: "Pick a reason." });
  expect(await decideAction(state.eventId, "approve", ["../bad"])).toEqual({ error: "invalid" });
  expect(await decideAction(state.eventId, "approve", Array(201).fill(state.registrationId))).toEqual({ error: "invalid" });
  expect(await decideAction(state.otherId, "approve", [state.registrationId])).toMatchObject({ ok: true, failed: [state.registrationId] });
  expect((await listApplicants(state.eventId, query))!.counts.pending).toBe(1);
 });
 it("deduplicates IDs, persists private notes and restores rejected waitlist placement", async () => {
  await decideAction(state.eventId, "waitlist", [state.registrationId, state.registrationId]);
  await saveNoteAction(state.eventId, state.registrationId, "Private note");
  expect(await queryable(state.db).query("select staff_note from registrations where id=$1", [state.registrationId])).toEqual([{ staff_note: "Private note" }]);
  await decideAction(state.eventId, "reject", [state.registrationId], { reject: { reason: "Duplicate", note: "", email: true } });
  expect(await undoRejectAction(state.eventId, state.registrationId)).toEqual({ ok: true });
  expect((await listApplicants(state.eventId, { ...query, tab: "waitlist" }))!.rows[0]!.position).toBe(1);
 });
 it("skipApproval=false keeps request pending, persists invite message and reports alreadyRequested", async () => {
  expect(await inviteAction(state.eventId, ["ana@example.test", "new@example.test", "bad"], "Join us", false)).toMatchObject({ ok: true, summary: { invited: 1, alreadyRequested: 1, skippedInvalid: 1 } });
  expect(await queryable(state.db).query("select admission from registrations")).toEqual([{ admission: "pending" }]);
  expect(await queryable(state.db).query("select message from invites")).toEqual([{ message: "Join us" }]);
 });
 it("expired session cannot decide or invite", async () => {
  auth.staff = null;
  await expect(decideAction(state.eventId, "approve", [state.registrationId])).rejects.toThrow(/(?:NEXT_REDIRECT|REDIRECT:)/);
  await expect(inviteAction(state.eventId, ["new@example.test"], "", true)).rejects.toThrow(/(?:NEXT_REDIRECT|REDIRECT:)/);
  expect(await queryable(state.db).query("select admission from registrations")).toEqual([{ admission: "pending" }]);
 });
 it("requirements writes are versioned and never change accepted admission", async () => {
  await admissionService.transition(auth.staff!, state.registrationId, "approved");
  // Unversioned (legacy) writes are refused; a versioned one saves and approved guests keep their place.
  expect(await saveRequirementsAction(state.eventId, { name: true, email: true, age18: true, reuseMonths: 3 })).toMatchObject({ error: "invalid" });
  const { editVersion } = (await eventService.get(state.eventId))!;
  expect(await saveRequirementsAction(state.eventId, { name: true, email: true, age18: true, reuseMonths: 3, editVersion })).toEqual({ ok: true });
  expect(await saveRequirementsAction(state.otherId, { reuseMonths: 6, document: true })).toMatchObject({ error: "invalid" });
  expect(await queryable(state.db).query("select admission from registrations")).toEqual([{ admission: "approved" }]);
 });
 it("silent approval admits a proven applicant without creating a verification link", async () => {
  await decideAction(state.eventId, "approve", [state.registrationId], { notify: false });
  expect((await listApplicants(state.eventId, { ...query, tab: "approved" }))!.rows[0]!.approval?.status).toBe("going");
  expect(await queryable(state.db).query("select id from outbox where kind in ('verify_invite','email:M-06')")).toHaveLength(0);
  await decideAction(state.eventId, "resend", [state.registrationId]);
  expect((await listApplicants(state.eventId, { ...query, tab: "approved" }))!.rows[0]!.approval?.status).toBe("going");
  expect(await queryable(state.db).query("select id from outbox where kind='verify_invite'")).toHaveLength(0);
 });
 it("undoing a blocked rejection also removes the block on future reapplication", async () => {
  await decideAction(state.eventId, "reject", [state.registrationId], { reject: { reason: "Duplicate", email: true, block: true } });
  expect(await queryable(state.db).query("select blocked from registrations")).toEqual([{ blocked: true }]);
  await undoRejectAction(state.eventId, state.registrationId);
  expect(await queryable(state.db).query("select admission,blocked from registrations")).toEqual([{ admission: "pending", blocked: false }]);
  await admissionService.transition(auth.guest!, state.registrationId, "cancelled_by_guest", "Withdrawn");
  await admissionService.apply(auth.guest!, state.eventId,await requestFixture(state.db,auth.guest!,state.eventId));
  expect(await queryable(state.db).query("select admission,reapplication_count from registrations")).toEqual([{ admission: "pending", reapplication_count: 1 }]);
 });
});
