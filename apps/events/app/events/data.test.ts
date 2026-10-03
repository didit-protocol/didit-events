import { render } from "../../src/testing/react-cache";
import "../../src/testing/b4";

import { queryable } from "@didit-events/core/db/tx";
import type * as CalendarCore from "@didit-events/core/calendar";
import { beforeEach,expect,it,vi } from "vitest";
import { databaseSuite } from "../../src/testing/b4";

// The real calendar profile read on the real database; the spy only counts the reads.
vi.mock("@didit-events/core/calendar", async original => { const actual = await original<typeof CalendarCore>(); return { ...actual, getCalendarProfile: vi.fn(actual.getCalendarProfile) }; });
const { getCalendarProfile, saveCalendarText } = await import("@didit-events/core/calendar");
const { getCalendar, getProfile } = await import("./data");
const { default: EventsRoute, generateMetadata } = await import("./page");

const state = databaseSuite(), reads = vi.mocked(getCalendarProfile);
const props = () => ({ searchParams: Promise.resolve({}) });
beforeEach(() => { reads.mockClear(); });

it("generateMetadata and the page of one render share one calendar profile read", async () => {
  await render(async () => {
    const meta = await generateMetadata(), page = await EventsRoute(props());
    expect(page.props).toMatchObject({ tab: "upcoming", calendar: { name: meta.title, description: meta.description } });
    expect(meta.title).toBeTruthy();
    expect((page.props.events as { slug: string }[]).map(e => e.slug).sort()).toEqual(["arbitrary", "second"]);
  });
  expect(reads).toHaveBeenCalledTimes(1);
});
it("the header and the calendar get the same profile, whichever asks first", async () => {
  await render(async () => {
    const [{ calendar }, profile] = await Promise.all([getCalendar("upcoming", new Date()), getProfile()]);
    expect(calendar).toMatchObject(profile);
    expect(await getProfile()).toBe(profile);
  });
  expect(reads).toHaveBeenCalledTimes(1);
});
it("the next render reads the profile again: a saved header shows", async () => {
  const before = await render(async () => (await generateMetadata()).title);
  const [row] = await queryable(state.db).query("select 1 as saved from calendar_profiles");
  expect(row).toBeUndefined();
  const builtIn = await getProfile();
  await saveCalendarText("events.owner@didit.me", { name: "Saved calendar", tagline: builtIn.tagline, description: "Saved description", websiteUrl: null, xUrl: null, linkedinUrl: null });
  reads.mockClear();
  const after = await render(async () => { const meta = await generateMetadata(); expect((await EventsRoute(props())).props.calendar).toMatchObject({ name: "Saved calendar", description: "Saved description" }); return meta.title; });
  expect([before, after]).toEqual([builtIn.name, "Saved calendar"]);
  expect(reads).toHaveBeenCalledTimes(1);
});
