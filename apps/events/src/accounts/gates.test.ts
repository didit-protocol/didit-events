import "../testing/b4";
import { requestFixture } from "../../../../packages/core/src/testing/model";
import { expect, it, vi } from "vitest";
import { auth, databaseSuite } from "../testing/b4";
import { queryable } from "@didit-events/core/db/tx";
import { admissionService, eventService } from "@didit-events/core";
import { createRequest, getRegisterPage, registerGate } from "../../app/e/[slug]/register/data";
import { cancelAction } from "../../app/me/events/[slug]/cancel/actions";
import { cancelRegistration } from "../../app/me/events/[slug]/cancel/data";
import { getMyEvent } from "../../app/me/events/[slug]/data";
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error("NEXT_REDIRECT;" + url); } }));
const state = databaseSuite(), form = (values: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(values)) f.set(k, v); return f; };
it.each(["closed", "ended", "invite_only"] as const)("registration uses persisted %s gate", async gate => {
 if (gate === "ended") await eventService.end(auth.staff!, state.otherId);
 else { const event=await eventService.get(state.otherId);await eventService.update(auth.staff!, state.otherId,{expectedVersion:event!.editVersion,form:{...event!.form,...(gate==="closed"?{closes_at:new Date().toISOString()}:{mode:"invite_only"})}}); }
 expect(await registerGate("second", new Date())).toMatchObject({ kind: "gated", gate });
 auth.guest = null; expect(await getRegisterPage("second", new Date())).toMatchObject({ view: "unavailable", gate });
});
it("unknown and open events work for arbitrary slugs; existing registration redirects to status", async () => {
 expect(await registerGate("missing", new Date())).toEqual({ kind: "not_found" });
 expect(await registerGate("second", new Date())).toMatchObject({ kind: "open" });
 expect(await getRegisterPage("arbitrary", new Date())).toEqual({ view: "registered", slug: "arbitrary" });
 // V2 collects the baseline through unified sign-in/onboarding, then renders the canonical request context.
 expect(await getRegisterPage("second",new Date())).toMatchObject({view:"request",context:{event:{id:state.otherId}}});
 auth.guest=null;expect(await getRegisterPage("second",new Date())).toEqual({view:"sign_in",slug:"second"});
});
it("createRequest uses the signed-in account, ignores submitted email and writes M-02", async () => {
 expect(await createRequest("second", { email: "attacker@example.test", fullName: "Ana", company: "Example", role: "Founder" },new Date(),await requestFixture(state.db,auth.guest!,state.otherId))).toMatchObject({ kind: "created" });
 expect(await queryable(state.db).query("select account_id,application_v2 from registrations where event_id=$1", [state.otherId])).toEqual([{ account_id: state.accountId, application_v2: { fields:{},answers:{} } }]);
 expect(await createRequest("second", { email: "", fullName: "", company: "", role: "" })).toMatchObject({ kind: "already" });
 expect(await queryable(state.db).query("select count(*)::int n from outbox where kind='email:M-02'")).toEqual([{ n: 2 }]);
});
it("signed-out cancellation requires a guest; reason is optional and mode comes from admission", async () => {
 const principal = auth.guest; auth.guest = null;
 await expect(cancelAction({}, form({ slug: "arbitrary" }))).rejects.toThrow("NEXT_REDIRECT;/login?next=%2Fme%2Fevents%2Farbitrary%2Fcancel");
 auth.guest = principal; await admissionService.transition(auth.staff!, state.registrationId, "approved");
 await expect(cancelAction({}, form({ slug: "arbitrary", mode: "withdraw" }))).rejects.toThrow("NEXT_REDIRECT;/me/events/arbitrary?cancelled=");
 expect(await queryable(state.db).query("select admission,reason from registrations")).toEqual([{ admission: "cancelled_by_guest", reason:"Guest cancelled place" }]);
});
it("withdrawal is persisted; a query flag alone never changes status", async () => {
 expect(await getMyEvent("arbitrary", { withdrawn: true })).toMatchObject({ kind: "ok", status: { kind: "pending" } });
 expect(await cancelRegistration("arbitrary", "", "")).toBe("withdrawn");
 expect(await getMyEvent("arbitrary")).toMatchObject({ kind: "ok", status: { kind: "withdrawn" } });
 expect(await queryable(state.db).query("select admission,reason from registrations")).toEqual([{ admission: "cancelled_by_guest", reason: "Guest withdrew request" }]);
});
it("cancellation checks the exact start instant", async () => {
 await admissionService.transition(auth.staff!, state.registrationId, "approved");
 await queryable(state.db).query("update events set starts_at=clock_timestamp() where id=$1", [state.eventId]);
 expect(await cancelRegistration("arbitrary", "Schedule conflict", "")).toBe("started");
 expect(await queryable(state.db).query("select admission from registrations")).toEqual([{ admission: "approved" }]);
});
