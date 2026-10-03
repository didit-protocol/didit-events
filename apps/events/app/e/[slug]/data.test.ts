import { render } from "../../../src/testing/react-cache";
import "../../../src/testing/b4";

import { queryable } from "@didit-events/core/db/tx";
import type * as ReadModel from "@didit-events/core/admission/read-model";
import { beforeEach,expect,it,vi } from "vitest";
import { auth,databaseSuite } from "../../../src/testing/b4";
import type * as Hosts from "../../../src/server/hosts";

// The real read model and host photo read on the real database; the spies only count the reads.
vi.mock("@didit-events/core/admission/read-model", async original => { const actual = await original<typeof ReadModel>(); return { ...actual, eventReadModel: vi.fn(actual.eventReadModel) }; });
vi.mock("../../../src/server/hosts", async original => { const actual = await original<typeof Hosts>(); return { ...actual, hostPhotoVersions: vi.fn(actual.hostPhotoVersions) }; });
const { eventReadModel } = await import("@didit-events/core/admission/read-model");
const { hostPhotoVersions } = await import("../../../src/server/hosts");
const { getEvent, getEventPage } = await import("./data");
const { default: EventRoute, generateMetadata } = await import("./page");

const state = databaseSuite(), models = vi.mocked(eventReadModel), photos = vi.mocked(hostPhotoVersions);
const props = () => ({ params: Promise.resolve({ slug: "arbitrary" }), searchParams: Promise.resolve({}) });
const rename = (name: string) => queryable(state.db).query("update events set name=$2 where id=$1", [state.eventId, name]);
beforeEach(() => { models.mockClear(); photos.mockClear(); });

it("generateMetadata and the page of one render share one event read and one host photo read", async () => {
  await render(async () => {
    expect(await generateMetadata(props())).toMatchObject({ title: "Arbitrary event · Didit Events", openGraph: { title: "Arbitrary event" } });
    expect((await EventRoute(props())).props).toMatchObject({ event: { slug: "arbitrary", title: "Arbitrary event" }, viewer: { email: "ana@example.test" } });
  });
  expect(models.mock.calls.map(([slug]) => slug)).toEqual(["arbitrary"]);
  expect(photos).toHaveBeenCalledTimes(1);
});
it("both get the same event view, whichever asks first", async () => {
  await render(async () => {
    const event = await getEvent("arbitrary");
    expect((await getEventPage("arbitrary", new Date()))!.event).toBe(event);
    expect(await getEvent("arbitrary")).toBe(event);
  });
  await render(async () => {
    const [page, event] = await Promise.all([getEventPage("arbitrary", new Date()), getEvent("arbitrary")]);
    expect(page!.event).toBe(event);
  });
  expect(models).toHaveBeenCalledTimes(2);
  expect(photos).toHaveBeenCalledTimes(2);
});
it("the next render reads the event again", async () => {
  const title = () => render(async () => { const meta = await generateMetadata(props()); await EventRoute(props()); return meta.title; });
  expect(await title()).toBe("Arbitrary event · Didit Events");
  await rename("Renamed event");
  expect(await title()).toBe("Renamed event · Didit Events");
  expect(models).toHaveBeenCalledTimes(2);
  expect(photos).toHaveBeenCalledTimes(2);
});
it("an unknown event is not found for both, on one read", async () => {
  await render(async () => {
    expect(await generateMetadata({ ...props(), params: Promise.resolve({ slug: "nope" }) })).toEqual({ title: "Event not found · Didit Events" });
    expect(await getEventPage("nope", new Date())).toBeNull();
  });
  expect(models).toHaveBeenCalledTimes(1);
  expect(photos).not.toHaveBeenCalled();
});
it("signed out or signed in, the event view is the same read", async () => {
  auth.guest = null;
  await render(async () => { await getEvent("arbitrary"); expect(await getEventPage("arbitrary", new Date())).toMatchObject({ viewer: null, event: { slug: "arbitrary" } }); });
  expect(models).toHaveBeenCalledTimes(1);
  expect(photos).toHaveBeenCalledTimes(1);
});
