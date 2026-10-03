import { expect, it, vi } from "vitest";
import { auth, databaseSuite } from "../../../../../../../src/testing/b4";
import { queryable } from "@didit-events/core/db/tx";
import { eventService } from "@didit-events/core";
import { lifecycleAction, deleteEventAction, endEventAction, saveWelcomeAction, setRequestFormAction, saveLimitsAction } from "./actions";
import { getSettings } from "./data";
import { getEventHeader } from "../../data";
import { listApplicants } from "../applicants/data";
import { reopenRequestsAction } from "../applicants/actions";
import { parseApplicantQuery } from "../../../../../../../src/admin/applicants/query";
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error("NEXT_REDIRECT;" + url); } }));
const state = databaseSuite();
const version=async(id=state.eventId)=>(await eventService.get(id))!.editVersion;
it("settings update the database, validate limits and persist welcome copy", async () => {
 const form = new FormData(); form.set("subject", "See you there"); form.set("block", "Doors open at six");
 form.set("expectedVersion",String(await version()));
 expect(await saveWelcomeAction(state.eventId, { status: "idle" }, form)).toEqual({ status: "saved" });
 expect((await getSettings(state.eventId))!.welcome.subject).toBe("See you there");
 expect(await setRequestFormAction(state.eventId, false,undefined,await version())).toEqual({ ok: true });
 expect((await getSettings(state.eventId))!.requestForm.open).toBe(false);
 const event=await eventService.get(state.eventId);
 await eventService.update(auth.staff!,state.eventId,{expectedVersion:event!.editVersion,door:{kiosk:true,mode:"supervised",match_threshold:80}});
 const limits = new FormData(); limits.set("budget", "500"); limits.set("mode", "strict"); limits.set("strictness", "90");
 limits.set("expectedVersion",String(await version()));
 expect(await saveLimitsAction(state.eventId, { status: "idle" }, limits)).toEqual({ status: "saved" });
 expect(await queryable(state.db).query("select door from events where id=$1", [state.eventId])).toEqual([{ door: {kiosk:true,mode:"strict",match_threshold:90} }]);
});
it("requires exact name for deletion, preserves other events and returns to list", async () => {
 expect(await deleteEventAction(state.eventId, "Wrong")).toEqual({ error: "invalid" });
 await expect(deleteEventAction(state.eventId, "Arbitrary event")).rejects.toThrow("NEXT_REDIRECT;/admin");
 expect(await queryable(state.db).query("select id from registrations where event_id=$1", [state.eventId])).toEqual([]);
 expect(await queryable(state.db).query("select id from events where id=$1", [state.otherId])).toHaveLength(1);
});
it("end persists and expired session cannot change settings", async () => {
 expect(await endEventAction(state.eventId,undefined,await version())).toEqual({ ok: true });
 expect((await getSettings(state.eventId))!.ended).toBe(true);
 auth.staff = null; await expect(setRequestFormAction(state.otherId, false)).rejects.toThrow(/(?:NEXT_REDIRECT|REDIRECT:)/);
});

// v24: the callers (header Publish / Cancel event, Applicants "Reopen requests") send the version their loader read.
it("the header's edit version publishes and cancels; a missing or stale one answers conflict and changes nothing", async () => {
 const draft = await eventService.create(auth.staff!, { slug: "draft-header", name: "Draft", venue:"HQ",address:"One Street", startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000), capacity: 10 });
 const header = async (id: string) => (await getEventHeader(id))!.editVersion;
 expect(await header(draft.id)).toBe(draft.editVersion);
 expect(await lifecycleAction(draft.id, "publish", "")).toEqual({ error: "conflict" });
 expect(await lifecycleAction(draft.id, "publish", "", undefined, draft.editVersion + 1)).toEqual({ error: "conflict" });
 expect((await eventService.get(draft.id))!.status).toBe("draft");
 expect(await lifecycleAction(draft.id, "publish", "", undefined, await header(draft.id))).toEqual({ ok: true });
 expect((await eventService.get(draft.id))!.status).toBe("published");
 const stale = draft.editVersion;
 expect(await header(draft.id)).not.toBe(stale);
 expect(await lifecycleAction(draft.id, "cancel", "Venue unavailable", undefined, stale)).toEqual({ error: "conflict" });
 expect(await lifecycleAction(draft.id, "cancel", "Venue unavailable", undefined, await header(draft.id))).toEqual({ ok: true });
 expect((await eventService.get(draft.id))!.status).toBe("cancelled");
});
it("the applicants list's edit version reopens requests; a missing or stale one answers conflict", async () => {
 expect(await setRequestFormAction(state.eventId, false, undefined, await version())).toEqual({ ok: true });
 const listed = async () => (await listApplicants(state.eventId, parseApplicantQuery({})))!.event;
 const closed = await listed();
 expect(closed).toMatchObject({ registration: "closed", editVersion: await version() });
 expect(await reopenRequestsAction(state.eventId)).toMatchObject({ error: "conflict" });
 expect(await reopenRequestsAction(state.eventId, undefined, closed.editVersion! - 1)).toMatchObject({ error: "conflict", message: expect.stringContaining("changed") });
 expect((await getSettings(state.eventId))!.requestForm.open).toBe(false);
 expect(await reopenRequestsAction(state.eventId, undefined, closed.editVersion)).toEqual({ ok: true });
 expect((await listed()).registration).toBe("open");
});
it("publish and cancellation actions persist lifecycle and every cancellation notification", async () => {
 const draft = await eventService.create(auth.staff!, { slug: "draft-lifecycle", name: "Draft", venue:"HQ",address:"One Street", startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000), capacity: 10 });
 expect(await lifecycleAction(draft.id, "publish","",undefined,draft.editVersion)).toEqual({ ok: true });
 expect((await eventService.get(draft.id))!.status).toBe("published");
 expect(await lifecycleAction(state.eventId, "cancel", "")).toEqual({ error: "invalid" });
 expect((await eventService.get(state.eventId))!.status).toBe("published");
 expect(await lifecycleAction(state.eventId, "cancel", "Venue unavailable",undefined,await version())).toEqual({ ok: true });
 expect(await queryable(state.db).query("select admission from registrations where event_id=$1", [state.eventId])).toEqual([{ admission: "cancelled_by_host" }]);
 expect(await queryable(state.db).query("select count(*)::int n from outbox where kind='email:M-21'")).toEqual([{ n: 1 }]);
 auth.staff = null; await expect(lifecycleAction(draft.id, "cancel", "Cancelled")).rejects.toThrow(/(?:NEXT_REDIRECT|REDIRECT:)/);
});

it("rejects stale settings instead of silently saving over newer edits",async()=>{
 const old=await version();
 expect(await setRequestFormAction(state.eventId,false,undefined,old)).toEqual({ok:true});
 await expect(setRequestFormAction(state.eventId,true,undefined,old)).rejects.toThrow("context_changed");
 expect((await getSettings(state.eventId))!.requestForm.open).toBe(false);
});

it("event details: name, date and times save in the event's zone against the edit version, end after start",async()=>{
 const { saveDetailsAction } = await import("./actions");
 const v=await version();
 expect(await saveDetailsAction(state.eventId,{name:"  Renamed night ",date:"2030-03-14",start:"18:30",end:"9:45pm"},v)).toEqual({ok:true,editVersion:expect.any(Number)});
 const saved=(await eventService.get(state.eventId))!;
 expect(saved.name).toBe("Renamed night");
 // Europe/Madrid is UTC+1 in March.
 expect(saved.startsAt.toISOString()).toBe("2030-03-14T17:30:00.000Z");
 expect(saved.endsAt.toISOString()).toBe("2030-03-14T20:45:00.000Z");
 expect((await getSettings(state.eventId))!.details).toEqual({name:"Renamed night",date:"2030-03-14",start:"18:30",end:"21:45",timeZone:"Europe/Madrid"});
 expect(await saveDetailsAction(state.eventId,{name:"x",date:"2030-03-14",start:"20:00",end:"19:00"},saved.editVersion)).toMatchObject({error:"invalid",errors:{end:expect.stringContaining("End must be after start")}});
 expect(await saveDetailsAction(state.eventId,{name:"",date:"",start:"",end:""},saved.editVersion)).toMatchObject({error:"invalid",errors:{name:expect.any(String),date:expect.any(String),start:expect.any(String),end:expect.any(String)}});
 expect(await saveDetailsAction(state.eventId,{name:"Stale",date:"2030-03-14",start:"18:00",end:"20:00"},v)).toEqual({error:"conflict"});
 expect((await eventService.get(state.eventId))!.name).toBe("Renamed night");
 auth.staff=null; await expect(saveDetailsAction(state.eventId,{name:"x",date:"2030-03-14",start:"18:00",end:"20:00"},saved.editVersion)).rejects.toThrow(/(?:NEXT_REDIRECT|REDIRECT:)/);
});
