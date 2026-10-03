import sharp from "sharp";
import { readEventCover } from "@didit-events/core/content/event-assets";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@didit-events/core/db";
import { testDatabase, resetDatabase } from "@didit-events/core/testing/database";
import { skipPostgres } from "@didit-events/core/testing/postgres";
import { testStaffSession } from "@didit-events/core/testing/staff-session";
import { queryable } from "@didit-events/core/db/tx";
import { bootstrapApiToken } from "@didit-events/core/api-tokens";
import { guestFixture, requestFixture } from "@didit-events/core/testing/model";
import { Events } from "@didit-events/core/admission/events";
import { Admissions } from "@didit-events/core/admission/admission";
import { Door } from "@didit-events/core/door/service";
import { POST } from "../../app/api/mcp/route";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const globalDb = globalThis as typeof globalThis & { __diditEventsDb?: Db };

for (const driver of ["pglite", "postgres"] as const) describe.skipIf(driver === "postgres" && skipPostgres)(`MCP route integration (${driver})`, () => {
  let database: Awaited<ReturnType<typeof testDatabase>>, token: string, oldDb: Db | undefined;
  let uiActor: Awaited<ReturnType<Awaited<ReturnType<typeof testStaffSession>>["requireStaff"]>>;
  const q = () => queryable(database.db);
  beforeAll(async () => { database = await testDatabase(driver); oldDb = globalDb.__diditEventsDb; globalDb.__diditEventsDb = database.db; });
  afterAll(async () => { globalDb.__diditEventsDb = oldDb; await database?.close(); });
  beforeEach(async () => {
    await resetDatabase(database.db);
    const browser = await testStaffSession(database.db); uiActor = await browser.requireStaff(browser.cookie);
    token = (await bootstrapApiToken(uiActor.email, "route-client", database.db)).token;
  });
  async function call(name: string, args: unknown = {}, success = true) {
    const response = await POST(new Request("http://localhost:3310/api/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } }) }));
    expect(response.status).toBe(200); const body = await response.json(); expect(body.error).toBeUndefined();
    if (success) expect(body.result.isError, JSON.stringify(body.result)).not.toBe(true);
    return body.result;
  }
  const eventInput = (slug: string) => ({ slug, name: "MCP parity", capacity: 10, venue:"HQ", address:"One Street", door:{kiosk:true as const,mode:"supervised" as const,match_threshold:80}, startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 90000000).toISOString() });
  async function apply(eventId: string) {
    // v2 requests require proven email, complete profile, face and an immutable consent receipt.
    const guest=await guestFixture(database.db);
    return new Admissions(database.db).apply(guest,eventId,await requestFixture(database.db,guest,eventId));
  }
  async function state(eventId: string) {
    return {
      event: await q().query("select name,status,capacity,checks,door,form from events where id=$1", [eventId]),
      registration: await q().query("select admission,staff_note from registrations where event_id=$1", [eventId]),
      checkin: await q().query("select method,by_staff,undone_at from checkins where event_id=$1", [eventId]),
      // now() is transaction-stable; UUID ordering does not describe insertion order within a transaction.
      audit: await q().query("select actor,action from audit where event_id=$1 order by action,actor", [eventId]),
      outbox: await q().query("select kind,status from outbox where payload->>'eventId'=$1 order by kind", [eventId]),
      history: await q().query('select h."from",h."to",h.over_capacity from admission_history h join registrations r on r.id=h.registration_id where r.event_id=$1 order by h.created_at,h.id', [eventId]),
    };
  }
  it("event_create -> event_publish -> applicant_approve -> guest_check_in matches the UI service state, audit and outbox", async () => {
    const events = new Events(database.db), admissions = new Admissions(database.db), door = new Door({ db: database.db });
    const input = eventInput("mcp-path"), mcp = (await call("event_create", input)).structuredContent;
    const ui = await events.create(uiActor, { ...input, slug: "ui-path", startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt) });
    await call("event_publish", { eventId: mcp.id }); await events.publish(uiActor, ui.id);
    const mcpReg = await apply(mcp.id), uiReg = await apply(ui.id);
    await call("applicant_approve", { registrationId: mcpReg.id }); await admissions.decide(uiActor, uiReg.id, "approved", { waitlistAtCapacity: false });
    expect((await call("applicants_list", { eventId: mcp.id, status: "approved", search: "Guest" })).structuredContent.items).toHaveLength(1);
    expect((await call("applicant_get", { eventId: mcp.id, registrationId: mcpReg.id })).structuredContent.registration.admission).toBe("approved");
    expect((await call("applicant_get", { eventId: ui.id, registrationId: mcpReg.id }, false)).isError).toBe(true);
    // Manual entry, just like the UI, is permitted only once the event is live.
    const live = { startsAt: new Date(Date.now() - 3600000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString() };
    await call("event_update", { eventId: mcp.id, expectedVersion:(await events.get(mcp.id))!.editVersion, patch: live }); await events.update(uiActor, ui.id, { expectedVersion:(await events.get(ui.id))!.editVersion, startsAt: new Date(live.startsAt), endsAt: new Date(live.endsAt) });
    const checked = (await call("guest_check_in", { registrationId: mcpReg.id, note: "Confirmed at reception" })).structuredContent;
    await door.manualCheckin(uiActor, uiReg.id, "Confirmed at reception");
    expect((await call("guest_check_in", { registrationId: mcpReg.id, note: "Confirmed at reception" })).structuredContent).toEqual(checked);
    expect((await call("guests_list", { eventId: mcp.id })).structuredContent.items[0].checkedIn.id).toBe(checked.checkinId);
    expect(await state(mcp.id)).toEqual(await state(ui.id));
    const snapshot = await state(mcp.id);
    expect(snapshot.audit.map(row => row.action)).toEqual(expect.arrayContaining(["event.create", "event.published", "admission.approve", "checkin.manual"]));
    expect(snapshot.outbox.filter(row => row.kind === "M-13")).toHaveLength(1);
    expect(snapshot.checkin).toEqual([{ method: "manual", by_staff: uiActor.email, undone_at: null }]);
    expect((await call("event_delete", { eventId: mcp.id }, false)).structuredContent.error).toBe("DraftRequired");
    await call("guest_check_in_undo", { checkinId: checked.checkinId }); await call("guest_check_in_undo", { checkinId: checked.checkinId });
    expect(await q().query("select id from audit where action='checkin.undone' and event_id=$1", [mcp.id])).toHaveLength(1);
  });
  it("round-trips canonical fields, hosts and privacy, and stores validated covers with optimistic concurrency", async () => {
    const event=(await call("event_create",eventInput("cover-model"))).structuredContent;
    const patch={descriptionMd:"## A real event",checks:{version:1,required:[],max_age:{}},form:{version:1,mode:"request",closes_at:null,waitlist:true,fields:{phone_number:"optional"},questions:[],consent_text:null},emails:{version:1,templates:{}},speakers:[{name:"Alex",role:"Host",photoUrl:"https://example.test/alex.jpg"}],cover:{kind:"theme",theme:"aqua",privacy:{guestList:"names"}}};
    const updated=(await call("event_update",{eventId:event.id,expectedVersion:event.editVersion,patch})).structuredContent;
    expect((await call("event_get",{eventId:event.id})).structuredContent).toMatchObject(patch);
    const bytes=await sharp({create:{width:600,height:400,channels:3,background:"red"}}).png().toBuffer();
    const args={eventId:event.id,expectedVersion:updated.editVersion,alt:"Host at the venue",base64:bytes.toString("base64")};
    expect((await call("event_cover_set",{...args,base64:Buffer.from("not PNG").toString("base64")},false)).isError).toBe(true);
    expect(await q().query("select version from event_assets")).toHaveLength(0);
    const stored=(await call("event_cover_set",args)).structuredContent;
    expect(stored.editVersion).toBe(updated.editVersion+1);
    const saved=(await call("event_get",{eventId:event.id})).structuredContent;
    expect(saved.cover).toEqual({kind:"asset",version:stored.version,alt:args.alt,privacy:{guestList:"names"}});
    expect((await readEventCover(event.id,stored.version,undefined,database.db)).status).toBe(404);
    await call("event_publish",{eventId:event.id});
    const response=await readEventCover(event.id,stored.version,undefined,database.db);
    expect(response.status).toBe(200);expect(response.headers.get("content-type")).toBe("image/webp");
    expect((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width).toBe(600);
    expect((await call("event_cover_set",args,false)).structuredContent.error).toBe("context_changed");
    expect(await q().query("select version from event_assets")).toHaveLength(1);
    expect(await q().query("select actor from audit where action='event_cover_uploaded' and event_id=$1",[event.id])).toEqual([{actor:uiActor.email}]);
  });
  it("event_update still accepts an agenda patch; the editor's {at,label} shape round-trips through event_get", async () => {
    const event=(await call("event_create",eventInput("agenda-mcp"))).structuredContent;
    const agenda=[{at:"2026-10-23T17:00:00.000Z",label:"Doors"},{at:"2026-10-23T18:30:00.000Z",label:"Panel",emphasis:true}];
    const updated=(await call("event_update",{eventId:event.id,expectedVersion:event.editVersion,patch:{agenda}})).structuredContent;
    expect(updated.editVersion).toBe(event.editVersion+1);
    expect((await call("event_get",{eventId:event.id})).structuredContent.agenda).toEqual(agenda);
    // Optional endAt (after at) round-trips; an end before the start is refused.
    const ranged=[{at:"2026-10-23T17:10:00.000Z",endAt:"2026-10-23T18:00:00.000Z",label:"Talk"}];
    const withEnd=(await call("event_update",{eventId:event.id,expectedVersion:updated.editVersion,patch:{agenda:ranged}})).structuredContent;
    expect((await call("event_get",{eventId:event.id})).structuredContent.agenda).toEqual(ranged);
    expect((await call("event_update",{eventId:event.id,expectedVersion:withEnd.editVersion,patch:{agenda:[{...ranged[0],endAt:"2026-10-23T17:00:00.000Z"}]}},false)).isError).toBe(true);
    await call("event_update",{eventId:event.id,expectedVersion:withEnd.editVersion,patch:{agenda:[]}});
    expect((await call("event_get",{eventId:event.id})).structuredContent.agenda).toEqual([]);
  });
  it("supports draft deletion, partial updates, decisions, invites, event team and door status, cancellation and team changes", async () => {
    const draft = (await call("event_create", eventInput("delete-me"))).structuredContent;
    await call("event_delete", { eventId: draft.id }); expect(await new Events(database.db).get(draft.id)).toBeNull();
    const event = (await call("event_create", eventInput("manage-me"))).structuredContent;
    await call("event_update", { eventId: event.id, expectedVersion:event.editVersion, patch: { name: "Renamed" } });
    expect((await call("event_get", { eventId: event.id })).structuredContent.name).toBe("Renamed");
    await call("event_publish", { eventId: event.id }); await call("event_publish", { eventId: event.id });
    const applicant = await apply(event.id);
    await call("applicant_reject", { registrationId: applicant.id, reason: "Wrong audience" });
    await call("applicant_undo", { registrationId: applicant.id });
    await call("applicant_waitlist", { registrationId: applicant.id });
    expect((await call("applicants_list", { eventId: event.id, status: "waitlisted" })).structuredContent.items).toHaveLength(1);
    await call("invite_guests", { eventId: event.id, emails: ["invited@example.test"], skipApproval: true, sendLink: false });
    const added = (await call("event_team_add", { eventId: event.id, email: "Door-Op@Example.test", role: "operator" })).structuredContent;
    expect(added).toMatchObject({ created: true, member: { email: "door-op@example.test", role: "operator" } });
    expect((await call("event_team_list", { eventId: event.id })).structuredContent.items).toHaveLength(1);
    expect(await q().query("select payload->>'to' as to from outbox where kind='email:M-27'")).toEqual([{ to: "door-op@example.test" }]);
    expect((await call("door_status", { eventId: event.id })).structuredContent).toMatchObject({ faceCheckin: true, doors: [], pinSet: false, checkedIn: 0 });
    const status = (await call("system_status", {})).structuredContent as { diditApi: string; stuckWebhooks: unknown[]; stuckVerificationSends: unknown[]; reconcileOverdue: boolean };
    expect(status).toMatchObject({ stuckWebhooks: [], stuckVerificationSends: [] });
    expect(["ok", "degraded"]).toContain(status.diditApi);
    await q().query("insert into inbox(event_id,raw,attempts,error) values('evt-stuck',$1,3,'processing_failed')", [JSON.stringify({ webhook_type: "status.updated", session_id: "x" })]);
    const stuck = (await call("system_status", {})).structuredContent as typeof status;
    expect(stuck).toMatchObject({ diditApi: "degraded", stuckWebhooks: [{ kind: "status.updated", error: "processing_failed", n: 1, attempts: 3 }] });
    await q().query("delete from inbox where event_id='evt-stuck'");
    await call("event_team_remove", { eventId: event.id, memberId: added.member.id });
    expect((await call("event_team_list", { eventId: event.id })).structuredContent.items).toHaveLength(0);
    await call("team_invite", { email: "new@didit.me", role: "staff" }); await call("team_disable", { email: "new@didit.me" });
    expect((await call("team_list")).structuredContent.items.find((member: { email: string }) => member.email === "new@didit.me").disabledAt).toBeTruthy();
    await call("event_cancel", { eventId: event.id, reason: "Venue closed" });
    expect((await call("event_get", { eventId: event.id })).structuredContent.status).toBe("cancelled");
  });
});
