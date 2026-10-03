import { expect, it, vi } from "vitest";
import { eventService } from "@didit-events/core";
import { auth, databaseSuite } from "../../testing/b4";
import { getRequirements, saveRequirements } from "../../../app/admin/(events)/events/[id]/(tabs)/applicants/data";
import { saveRequirementsAction } from "../../../app/admin/(events)/events/[id]/(tabs)/applicants/actions";

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error("NEXT_REDIRECT;" + url); } }));

const state = databaseSuite();
const MONTH_S = 30 * 86400;

it("AP-27 saves the checks through the versioned event update and refuses a stale version", async () => {
  const initial = (await getRequirements(state.eventId))!;
  expect(initial).toMatchObject({ age18: false, document: false, reuseMonths: 6, editVersion: expect.any(Number) });
  expect(await saveRequirementsAction(state.eventId, { ...initial, age18: true, reuseMonths: 3 })).toEqual({ ok: true });
  const saved = (await eventService.get(state.eventId))!;
  expect(saved.checks).toMatchObject({ age_min: 18, max_age: { age: 3 * MONTH_S } });
  expect(saved.editVersion).toBeGreaterThan(initial.editVersion);
  expect(await getRequirements(state.eventId)).toMatchObject({ age18: true, reuseMonths: 3, editVersion: saved.editVersion });

  // A modal opened before that save is a conflict, never a silent overwrite.
  expect(await saveRequirementsAction(state.eventId, { ...initial, age18: false })).toMatchObject({ error: "conflict", message: expect.stringContaining("changed") });
  expect((await eventService.get(state.eventId))!.checks.age_min).toBe(18);

  // Turning age off drops its freshness too (the schema refuses freshness for a check not asked).
  const current = (await getRequirements(state.eventId))!;
  expect(await saveRequirements(state.eventId, { ...current, age18: false })).toEqual({ ok: true });
  expect((await eventService.get(state.eventId))!.checks).toEqual({ version: 1, required: [], max_age: {} });

  // The ID document is not offered; a missing version is invalid.
  expect(await saveRequirementsAction(state.eventId, { ...current, document: true })).toMatchObject({ error: "invalid" });
  expect(await saveRequirementsAction(state.eventId, { ...current, editVersion: undefined })).toMatchObject({ error: "invalid" });
  expect(auth.staff).not.toBeNull();
});
