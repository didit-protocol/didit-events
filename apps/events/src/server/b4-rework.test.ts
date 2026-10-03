import "../testing/b4";

import { admissionService,eventService,inviteService } from "@didit-events/core";
import { queryable } from "@didit-events/core/db/tx";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { decideAction } from "../../app/admin/(events)/events/[id]/(tabs)/applicants/actions";
import { getApplicantDetail } from "../../app/admin/(events)/events/[id]/(tabs)/applicants/data";
import { addGuestAction,addGuestBatchAction,bulkGuestsAction } from "../../app/admin/(events)/events/[id]/(tabs)/guests/actions";
import { getMyEvent } from "../../app/me/events/[slug]/data";
import { runBulkApprove } from "../admin/applicants/bulkApprove";
import { parseApplicantQuery } from "../admin/applicants/query";
import { auth,databaseSuite } from "../testing/b4";
import { overview } from "./b4-overview";
import { adminModel,applicantsEvent,cardStatus,eventReadModel,guestStatus,publicEvent } from "./b4-views";

import { guestFixture,requestFixture } from "../../../../packages/core/src/testing/model.ts";
const state = databaseSuite(), q = () => queryable(state.db);
beforeEach(() => { vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected external call")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); });
async function applicant(email: string) {
  const guest=await guestFixture(state.db,email);
  return admissionService.apply(guest,state.eventId,await requestFixture(state.db,guest,state.eventId));
}
it("public views expose only kiosk availability and preserve the full admin door settings",async()=>{
  const door={kiosk:true,mode:"strict",match_threshold:93};
  await q().query("update events set door=$2::jsonb where id=$1",[state.eventId,JSON.stringify(door)]);
  const model=(await adminModel(state.eventId))!;
  expect(model.event.door).toEqual(door);
  expect(publicEvent(model.event)).toHaveProperty("door",{kiosk:true});
  expect(model.event.door).toEqual(door);
});
it("verified requester stays in review, drawer shows requirements met, and approval lands on You're in", async () => {
  expect(await q().query("select admission from registrations")).toEqual([{ admission: "pending" }]);
  expect((await getApplicantDetail(state.eventId, state.registrationId, parseApplicantQuery({})))?.detail.flag).toEqual({ text: "Meets all requirements", tone: "ok" });
  expect(await decideAction(state.eventId, "approve", [state.registrationId])).toMatchObject({ ok: true, done: [state.registrationId] });
  // v2 ready admission displays the face ticket without the legacy reuse branch.
  expect(await getMyEvent("arbitrary")).toMatchObject({ kind: "ok", status: { kind: "going", reused: false, registration:{admission:"approved",readiness:"ready"} } });
  expect(await q().query("select kind from outbox order by kind")).toEqual([{ kind: "email:M-02" }, { kind: "email:M-06" }, { kind: "email:M-25" }]);
  expect(await q().query("select id from verification_ops")).toHaveLength(0);
});
it("bulk approval stops at capacity with committed progress and remaining IDs for owner retry", async () => {
  await eventService.update(auth.staff!, state.eventId, { capacity: 1, expectedVersion:(await eventService.get(state.eventId))!.editVersion });
  const b = await applicant("b@example.test"), c = await applicant("c@example.test");
  const result = await decideAction(state.eventId, "approve", [state.registrationId, b.id, b.id, c.id]);
  expect(result).toEqual({ error: "capacity", done: [state.registrationId], remaining: [b.id, c.id], failed: [], approved: 1, capacity: 1 });
  expect(await q().query("select admission,count(*)::int n from registrations group by admission order by admission")).toEqual([{ admission: "pending", n: 2 }, { admission: "approved", n: 1 }]);
  expect(await q().query("select kind from outbox where kind not in ('email:M-02','email:M-25')")).toEqual([{ kind: "email:M-06" }]);
  const run = await runBulkApprove([b.id, c.id], id => decideAction(state.eventId, "approve", [id]));
  expect(run).toMatchObject({ reason: "capacity", remaining: [b.id, c.id], approved: [] });
  expect(await decideAction(state.eventId, "approve", [b.id, c.id], { overCapacity: true })).toMatchObject({ ok: true, done: [b.id, c.id] });
  expect(await q().query("select target from audit where action='admission.over_capacity' order by target")).toEqual([b.id, c.id].sort().map(target => ({ target })));
});
it("Guests-tab approval surfaces capacity without moving a revoked registration", async () => {
  await eventService.update(auth.staff!, state.eventId, { capacity: 1, expectedVersion:(await eventService.get(state.eventId))!.editVersion });
  await admissionService.transition(auth.staff!, state.registrationId, "approved");
  await admissionService.transition(auth.staff!, state.registrationId, "revoked", "Removed");
  const b = await applicant("seat@example.test");
  await admissionService.transition(auth.staff!, b.id, "approved");
  const before = await q().query("select id from outbox order by id");
  expect(await bulkGuestsAction(state.eventId, "approve", [state.registrationId])).toMatchObject({ error: "capacity", changed: [], remaining: [state.registrationId], canOverride: true });
  expect(await q().query("select admission from registrations where id=$1", [state.registrationId])).toEqual([{ admission: "revoked" }]);
  expect(await q().query("select id from outbox order by id")).toEqual(before);
  expect(await bulkGuestsAction(state.eventId, "approve", [state.registrationId], undefined, { overCapacity: true })).toMatchObject({ ok: true, changed: [state.registrationId] });
  expect(await q().query("select admission,over_capacity from registrations where id=$1", [state.registrationId])).toEqual([{ admission: "approved", over_capacity: true }]);
});
it("guest imports create invitations without granting unproven seats", async () => {
  await eventService.update(auth.staff!, state.eventId, { capacity: 1, expectedVersion:(await eventService.get(state.eventId))!.editVersion });
  await admissionService.transition(auth.staff!, state.registrationId, "approved");
  expect(await addGuestBatchAction(state.eventId, [{ first: "B", last: "Guest", email: "b@example.test" }], true)).toEqual({ ok: true, added: 1, waitlisted: 0, duplicates: [], invalid: [] });
  const form = new FormData(); form.set("first", "C"); form.set("email", "c@example.test");
  expect(await addGuestAction(state.eventId, { status: "idle" }, form)).toEqual({ status: "added", name: "C" });
  expect(await q().query("select count(*)::int n from registrations where admission='waitlisted'")).toEqual([{ n: 0 }]);
  expect(await q().query("select count(*)::int n from outbox where kind='email:M-09'")).toEqual([{ n: 0 }]);
  expect(await q().query("select payload->'data'->>'waitlisted' waitlisted from outbox where kind='email:M-19'")).toEqual([{ waitlisted: null }, { waitlisted: null }]);
});
it("ended event views distinguish attendance, no-show, undone check-in and non-admission", async () => {
  await admissionService.transition(auth.staff!, state.registrationId, "approved");
  await q().query("update events set starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-interval '1 hour' where id=$1", [state.eventId]);
  const read = async () => { const m = (await eventReadModel(state.eventId))!; return { guest: guestStatus(m.views[0]!, m.event), card: cardStatus(m.views[0]!, m.event) }; };
  expect(await read()).toMatchObject({ guest: { kind: "ended", attendance: "no_show", attended: 0 }, card: { kind: "ended", attendance: "no_show" } });
  await q().query("insert into checkins(event_id,registration_id,method) values($1,$2,'manual')", [state.eventId, state.registrationId]);
  expect(await read()).toMatchObject({ guest: { attendance: "attended", attended: 1 }, card: { attendance: "attended" } });
  expect(await getMyEvent("arbitrary")).toMatchObject({kind:"ok",status:{kind:"ended",attendance:"attended",attended:1,registration:{checkedInAt:expect.any(String)}}});
  await q().query("update checkins set undone_at=clock_timestamp() where registration_id=$1", [state.registrationId]);
  expect(await read()).toMatchObject({ guest: { attendance: "no_show" } });
  await q().query("update registrations set admission='rejected' where id=$1", [state.registrationId]);
  expect(await read()).toMatchObject({ guest: { attendance: "none" } });
  expect(await q().query("select id from outbox where kind='email:M-14'")).toHaveLength(0);
});
it("overview counts only active direct invites outside the registrations list", async () => {
  const event = (await eventService.get(state.eventId))!;
  const create = (email?: string) => inviteService.create(auth.staff!, { eventId: event.id, email, maxUses: 1, expiresAt: event.startsAt, skipApproval: false });
  await create("active@example.test");
  const revoked = await create("revoked@example.test"); await inviteService.revoke(auth.staff!, revoked.invite.id);
  const expired = await create("expired@example.test"); await q().query("update invites set expires_at=clock_timestamp() where id=$1", [expired.invite.id]);
  const used = await create("used@example.test"); await q().query("update invites set uses=1 where id=$1", [used.invite.id]);
  await create("ana@example.test"); // An existing completed request is already represented; opening another invitation must not duplicate it.
  await create("ana@example.test"); // A still-valid duplicate invitation is represented by the registration.
  await create(); // Share links do not count as invited people.
  const before = await q().query("select id from outbox order by id"), m = (await eventReadModel(event.id))!;
  expect(overview(m).counts.invited).toBe(1);
  expect(m.activeInvites.map(i => i.email)).toEqual(["active@example.test"]);
  expect(applicantsEvent(m.event, m.approvedCount).autoPromote).toBe(false);
  expect(await q().query("select id from outbox order by id")).toEqual(before);
});
