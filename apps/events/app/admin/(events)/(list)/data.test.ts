import "../../../../src/testing/b4";

import { admissionService,eventService } from "@didit-events/core";
import type * as ReadModel from "@didit-events/core/admission/read-model";
import { beforeEach,expect,it,vi } from "vitest";
import { auth,databaseSuite } from "../../../../src/testing/b4";
import { deferred } from "../../../../../../packages/core/src/testing/database.ts";

// The real read model on the real database; a test may hold one event's read back or fail it.
const real = vi.hoisted(() => ({ eventReadModel: null as unknown as typeof ReadModel.eventReadModel }));
vi.mock("@didit-events/core/admission/read-model", async original => { const actual = await original<typeof ReadModel>(); real.eventReadModel = actual.eventReadModel; return { ...actual, eventReadModel: vi.fn(actual.eventReadModel) }; });
const { eventReadModel } = await import("@didit-events/core/admission/read-model");
const { listEvents } = await import("./data");

const state = databaseSuite(), reads = vi.mocked(eventReadModel);
beforeEach(() => { reads.mockReset(); reads.mockImplementation(real.eventReadModel); });
const listed = async () => (await eventService.list()).map(e => e.id);

it("rows keep the order of the event list, whichever event's counts arrive first", async () => {
  const order = await listed();
  expect(order).toHaveLength(2);
  expect((await listEvents()).rows.map(r => r.id)).toEqual(order);
  // The first event's read is held until the last one's has finished.
  const gate = deferred(), started: string[] = [];
  reads.mockImplementation(async id => { started.push(id); if (id === order[0]) await gate.promise; else queueMicrotask(() => gate.resolve()); return real.eventReadModel(id); });
  expect((await listEvents()).rows.map(r => r.id)).toEqual(order);
  expect(started).toEqual(order);
});
it("each row carries its own event's counts", async () => {
  await admissionService.transition(auth.staff!, state.registrationId, "approved");
  const { rows, canCreate } = await listEvents();
  expect(canCreate).toBe(true);
  expect(rows.find(r => r.id === state.eventId)).toMatchObject({ name: "Arbitrary event", status: "open", where: "HQ, One Street", invited: 1, verified: 1, checkedIn: 0 });
  expect(rows.find(r => r.id === state.otherId)).toMatchObject({ name: "Arbitrary event", invited: 0, verified: 0, checkedIn: 0 });
});
it("one event's failed read fails the whole list, first or last in it", async () => {
  for (const failing of await listed()) {
    reads.mockImplementation(async id => { if (id === failing) throw new Error("read failed"); return real.eventReadModel(id); });
    await expect(listEvents()).rejects.toThrow("read failed");
  }
});
it("signed out: the list redirects to the admin sign-in before any read", async () => {
  auth.staff = null;
  await expect(listEvents()).rejects.toThrow("NEXT_REDIRECT");
  expect(reads).not.toHaveBeenCalled();
});
