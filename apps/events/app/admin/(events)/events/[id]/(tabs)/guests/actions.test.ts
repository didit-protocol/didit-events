import { expect, it, vi } from "vitest";
import { auth, databaseSuite } from "../../../../../../../src/testing/b4";
import { queryable } from "@didit-events/core/db/tx";
import { doorService } from "@didit-events/core";
import { addGuestAction, addGuestBatchAction, bulkGuestsAction, manualCheckInAction, resolveEmailMismatchAction } from "./actions";
import { allGuests } from "./data";
const state = databaseSuite();
it("validates whole batches, stores invitations and deduplicates case-insensitive emails", async () => {
 expect(await addGuestBatchAction(state.eventId, [{ first: "", email: "bad" }, { first: "B", last: "C", email: "b@example.test" }], true)).toMatchObject({ ok: true, added: 1, invalid: [{ row: 0 }] });
 expect((await allGuests(state.eventId))).toHaveLength(0);
 expect(await addGuestBatchAction(state.eventId, [{ first: "B", last: "C", email: "B@example.test" }], true)).toMatchObject({ ok: true, added: 0, duplicates: ["b@example.test"] });
 expect(await addGuestBatchAction(state.eventId, Array(51).fill({}), false)).toEqual({ error: "invalid" });
 expect(await addGuestBatchAction(state.eventId, null as never, false)).toEqual({ error: "invalid" });
 expect(await queryable(state.db).query("select count(*)::int n from outbox where kind='email:M-19'")).toEqual([{ n: 1 }]);
});
it("one guest preserves field errors and send choice", async () => {
 const form = new FormData(); form.set("first", "Ana"); form.set("email", "invalid");
 expect(await addGuestAction(state.eventId, { status: "idle" }, form)).toMatchObject({ status: "invalid", values: { first: "Ana", send: false }, errors: { email: expect.any(String) } });
 expect(await queryable(state.db).query("select count(*)::int n from registrations")).toEqual([{ n: 1 }]);
});
it("bulk decisions use service state and never affect another event", async () => {
 expect(await bulkGuestsAction(state.otherId, "approve", [state.registrationId])).toMatchObject({ ok: true, changed: [] });
 expect(await bulkGuestsAction(state.eventId, "approve", [state.registrationId])).toMatchObject({ ok: true, changed: [state.registrationId] });
 expect(await bulkGuestsAction(state.eventId, "revoke", [state.registrationId])).toMatchObject({ ok: true, changed: [state.registrationId] });
 expect(await queryable(state.db).query("select admission from registrations")).toEqual([{ admission: "revoked" }]);
});
it("manual check-in delegates to B3; B4 never changes verified email", async () => {
 const check = vi.spyOn(doorService, "manualCheckin").mockResolvedValue({ checkinId: "b3" });
 expect(await manualCheckInAction(state.eventId, state.registrationId, "Desk verification")).toMatchObject({ ok: true });
 expect(check).toHaveBeenCalledWith(auth.staff, state.registrationId, "Desk verification"); check.mockRestore();
 expect(await resolveEmailMismatchAction(state.eventId, state.registrationId, "accept")).toEqual({ error: "conflict" });
 expect(await queryable(state.db).query("select email from accounts where id=$1", [state.accountId])).toEqual([{ email: "ana@example.test" }]);
});
it("v24: manual check-in before the event starts answers with the reason and checks nobody in", async () => {
 expect(await manualCheckInAction(state.eventId, state.registrationId, "")).toEqual({ error: "conflict", message: expect.stringContaining("Check-in opens when the event starts") });
 expect(await queryable(state.db).query("select id from checkins")).toEqual([]);
});
it("expired session returns errors without writes", async () => { auth.staff = null; await expect(bulkGuestsAction(state.eventId, "approve", [state.registrationId])).rejects.toThrow(/(?:NEXT_REDIRECT|REDIRECT:)/); expect(await queryable(state.db).query("select admission from registrations")).toEqual([{ admission: "pending" }]); });
