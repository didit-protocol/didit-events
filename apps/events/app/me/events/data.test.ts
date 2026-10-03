import "../../../src/testing/b4";

import { admissionService } from "@didit-events/core";
import { queryable } from "@didit-events/core/db/tx";
import type * as ReadModel from "@didit-events/core/admission/read-model";
import { beforeEach,expect,it,vi } from "vitest";
import { auth,databaseSuite } from "../../../src/testing/b4";
import { deferred } from "../../../../../packages/core/src/testing/database.ts";
import { guestFixture,requestFixture } from "../../../../../packages/core/src/testing/model.ts";

// The real read model on the real database; a test may hold one event's read back or stamp what it returned.
const real = vi.hoisted(() => ({ eventReadModel: null as unknown as typeof ReadModel.eventReadModel }));
vi.mock("@didit-events/core/admission/read-model", async original => { const actual = await original<typeof ReadModel>(); real.eventReadModel = actual.eventReadModel; return { ...actual, eventReadModel: vi.fn(actual.eventReadModel) }; });
const { eventReadModel } = await import("@didit-events/core/admission/read-model");
const { getMyEvents } = await import("./data");

const state = databaseSuite(), q = () => queryable(state.db), reads = vi.mocked(eventReadModel);
beforeEach(() => { reads.mockReset(); reads.mockImplementation(real.eventReadModel); });
/** `hoursAgo` fixes each request's place in the list (latest first). */
async function requestedAt(hoursAgo: { arbitrary: number; second: number }) {
  await q().query("update registrations set applied_at=clock_timestamp()-make_interval(hours => $2) where event_id=$1", [state.eventId, hoursAgo.arbitrary]);
  await q().query("update registrations set applied_at=clock_timestamp()-make_interval(hours => $2) where event_id=$1", [state.otherId, hoursAgo.second]);
}
/** Each event's read names the account after the event, so the returned account tells which row it came from. */
const stamped = async (id: string) => { const m = await real.eventReadModel(id); if (m) for (const v of m.views) v.account = { ...v.account, firstName: m.event.slug }; return m; };
/** Ana also asks for the second event. */
async function secondRequest(hoursAgo: { arbitrary: number; second: number }) {
  await admissionService.apply(auth.guest!, state.otherId, await requestFixture(state.db, auth.guest!, state.otherId));
  await requestedAt(hoursAgo);
}
const slugs = async () => (await getMyEvents())!.events.map(e => e.event.slug);

it("rows follow the latest request first, whichever event's read finishes first", async () => {
  await secondRequest({ arbitrary: 2, second: 1 });
  expect(await slugs()).toEqual(["second", "arbitrary"]);
  // The first row's read is held until the last row's read has finished: the rows still come back in request order.
  const gate = deferred(), started: string[] = [];
  reads.mockImplementation(async id => { started.push(id); if (id === state.otherId) await gate.promise; else queueMicrotask(() => gate.resolve()); return real.eventReadModel(id); });
  expect(await slugs()).toEqual(["second", "arbitrary"]);
  expect(started).toEqual([state.otherId, state.eventId]);
  await requestedAt({ arbitrary: 1, second: 2 });
  expect(await slugs()).toEqual(["arbitrary", "second"]);
});
it("the account is the one of the last row that matched", async () => {
  await secondRequest({ arbitrary: 2, second: 1 });
  reads.mockImplementation(stamped);
  expect(await getMyEvents()).toMatchObject({ account: { id: state.accountId, firstName: "arbitrary", email: "ana@example.test" }, events: [{ event: { slug: "second" } }, { event: { slug: "arbitrary" } }] });
  // The last row no longer resolves (its event is gone from the read model): the account comes from the row before it.
  reads.mockImplementation(async id => id === state.eventId ? null : stamped(id));
  expect(await getMyEvents()).toMatchObject({ account: { firstName: "second" }, events: [{ event: { slug: "second" } }] });
  expect((await getMyEvents())!.events).toHaveLength(1);
  // A model that lists other guests only is no match either.
  reads.mockImplementation(async id => { const m = await stamped(id); if (m && id === state.eventId) m.views = m.views.filter(v => v.account.id !== state.accountId); return m; });
  expect(await getMyEvents()).toMatchObject({ account: { firstName: "second" } });
});
it("no row matches: the account is read from the accounts table, with no events", async () => {
  reads.mockImplementation(async () => null);
  expect(await getMyEvents()).toMatchObject({ account: { id: state.accountId, firstName: "Test", lastName: "Guest", email: "ana@example.test", verification: { state: "none" } }, events: [] });
  expect(reads).toHaveBeenCalledTimes(1);
});
it("a guest with no requests gets their account and an empty list, without reading any event", async () => {
  auth.guest = await guestFixture(state.db, "new@example.test");
  expect(await getMyEvents()).toMatchObject({ account: { id: auth.guest.accountId, email: "new@example.test" }, events: [] });
  expect(reads).not.toHaveBeenCalled();
});
it("no row matches and the account is being deleted: nothing to show", async () => {
  auth.guest = await guestFixture(state.db, "leaving@example.test");
  await q().query("update accounts set deleting_at=clock_timestamp() where id=$1", [auth.guest.accountId]);
  expect(await getMyEvents()).toBeNull();
});
it("signed out: the page redirects to sign in before any read", async () => {
  auth.guest = null;
  await expect(getMyEvents()).rejects.toThrow("NEXT_REDIRECT");
  expect(reads).not.toHaveBeenCalled();
});
it("a failed read fails the page", async () => {
  await secondRequest({ arbitrary: 2, second: 1 });
  reads.mockImplementation(async id => { if (id === state.eventId) throw new Error("read failed"); return real.eventReadModel(id); });
  await expect(getMyEvents()).rejects.toThrow("read failed");
});
it("a rejected request is Not approved, never Cancelled, and stays so after the event ends", async () => {
  expect((await getMyEvents())!.events.map(e => e.badge)).toEqual(["pending"]);
  await admissionService.transition(auth.staff!, state.registrationId, "rejected", "Not this time");
  expect((await getMyEvents())!.events.map(e => e.badge)).toEqual(["not-approved"]);
  await q().query("update events set starts_at=clock_timestamp()-interval '5 hours',ends_at=clock_timestamp()-interval '1 hour' where id=$1", [state.eventId]);
  expect((await getMyEvents())!.events.map(e => e.badge)).toEqual(["not-approved"]);
});
