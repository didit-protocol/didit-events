import { render } from "../testing/react-cache";
import "../testing/b4";

import { queryable } from "@didit-events/core/db/tx";
import type * as ReadModel from "@didit-events/core/admission/read-model";
import { beforeEach,expect,it,vi } from "vitest";
import { auth,databaseSuite } from "../testing/b4";

// The real read model on the real database; the spy only counts the reads.
vi.mock("@didit-events/core/admission/read-model", async original => { const actual = await original<typeof ReadModel>(); return { ...actual, eventReadModel: vi.fn(actual.eventReadModel) }; });
const { eventReadModel } = await import("@didit-events/core/admission/read-model");
const { adminModel } = await import("./b4-views");

const state = databaseSuite(), reads = vi.mocked(eventReadModel);
const rename = (name: string) => queryable(state.db).query("update events set name=$2 where id=$1", [state.eventId, name]);
beforeEach(() => { reads.mockClear(); });

it("one render reads an event's model once, for loaders one after another and side by side", async () => {
  await render(async () => {
    const first = await adminModel(state.eventId);
    const [second, third] = await Promise.all([adminModel(state.eventId), adminModel(state.eventId)]);
    expect(first!.event.id).toBe(state.eventId);
    expect(second).toBe(first); expect(third).toBe(first);
  });
  expect(reads).toHaveBeenCalledTimes(1);
});
it("the model is per event: another event of the same render is its own read", async () => {
  await render(async () => {
    expect((await adminModel(state.eventId))!.event.slug).toBe("arbitrary");
    expect((await adminModel(state.otherId))!.event.slug).toBe("second");
    await adminModel(state.otherId);
  });
  expect(reads.mock.calls.map(([id]) => id)).toEqual([state.eventId, state.otherId]);
});
it("access is checked on every call: a cached model is never served past a refused check", async () => {
  await render(async () => {
    const owner = auth.staff;
    expect(await adminModel(state.eventId)).not.toBeNull();
    auth.staff = null;
    await expect(adminModel(state.eventId)).rejects.toThrow("NEXT_REDIRECT");
    auth.staff = owner;
    expect(await adminModel(state.eventId)).not.toBeNull();
  });
  expect(reads).toHaveBeenCalledTimes(1);
});
it("a refused first call reads nothing", async () => {
  auth.staff = null;
  await render(async () => { await expect(adminModel(state.eventId)).rejects.toThrow("NEXT_REDIRECT"); });
  expect(reads).not.toHaveBeenCalled();
});
it("the next render reads fresh", async () => {
  const before = await render(async () => (await adminModel(state.eventId))!.event.name);
  await rename("Renamed event");
  const after = await render(async () => { const m = await adminModel(state.eventId); expect(await adminModel(state.eventId)).toBe(m); return m!.event.name; });
  expect([before, after]).toEqual(["Arbitrary event", "Renamed event"]);
  expect(reads).toHaveBeenCalledTimes(2);
});
it("outside a render (server action, route handler) every call reads: a read after a write is never stale", async () => {
  expect((await adminModel(state.eventId))!.event.name).toBe("Arbitrary event");
  await rename("Renamed event");
  expect((await adminModel(state.eventId))!.event.name).toBe("Renamed event");
  expect(reads).toHaveBeenCalledTimes(2);
});
