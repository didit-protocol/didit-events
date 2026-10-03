import { readFileSync } from "node:fs";
import type * as Core from "@didit-events/core";
import type * as EventAssets from "@didit-events/core/content/event-assets";
import { accountSession } from "@didit-events/core/testing/account-session";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createIdentityServices } from "@didit-events/core/identity";
import { testDatabase, resetDatabase } from "@didit-events/core/testing/database";
import { queryable } from "@didit-events/core/db/tx";
import { csrfToken } from "./browser";
import { guardAction } from "./actions";
import { createEventAction } from "../../app/admin/(events)/events/new/actions";
import { updateEventAction } from "../../app/admin/(events)/events/[id]/edit/actions";
import { addGuestBatchAction } from "../../app/admin/(events)/events/[id]/(tabs)/guests/actions";
import { inviteAction } from "../../app/admin/(events)/events/[id]/(tabs)/applicants/actions";
import { inviteStaffAction } from "../../app/admin/team/actions";
import { uploadPhotoAction } from "../../app/me/profile/photo/actions";
import { BCN_FORM } from "../admin/form/fixtures";
import nextConfig from "../../next.config";

const state = vi.hoisted(() => ({ cookie: "", csrf: "", origin: "https://events.test", identity: undefined as ReturnType<typeof createIdentityServices> | undefined,
  upload: vi.fn(), create: vi.fn(), update: vi.fn(), add: vi.fn(), invite: vi.fn() }));
vi.mock("./runtime", () => ({ get identity() { return state.identity!; } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: state.cookie }) }), headers: async () => new Headers({ origin: state.origin, cookie: `__Host-sid=${state.cookie}; __Host-csrf=${state.csrf}` }) }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); }, notFound: () => { throw new Error("NOT_FOUND"); }, forbidden: () => { throw new Error("FORBIDDEN"); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@didit-events/core/content/event-assets", async original => ({...await original<typeof EventAssets>(), uploadEventCover: state.upload}));
vi.mock("@didit-events/core", async original => { const actual=await original<typeof Core>();return {...actual,eventService:{...actual.eventService,get:async()=>({editVersion:2,cover:{kind:"theme",theme:"aqua"}})}};});
// Isolate action dispatch limits; service and storage integration are covered against both real databases.
vi.mock("../../app/admin/(events)/events/new/data", () => ({ createEvent: state.create }));
vi.mock("../../app/admin/(events)/events/[id]/edit/data", () => ({ updateEvent: state.update }));
vi.mock("../../app/admin/(events)/events/[id]/(tabs)/guests/data", () => ({ addGuests: state.add, ADD_GUEST_COPY: {} }));
vi.mock("../../app/admin/(events)/events/[id]/(tabs)/applicants/data", () => ({ invite: state.invite }));
const secret = "body-limits-test-secret-longer-than-32-characters";
let database: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { database = await testDatabase(process.env.TEST_DATABASE_URL ? "postgres" : "pglite"); (globalThis as typeof globalThis & { __diditEventsDb?: typeof database.db }).__diditEventsDb = database.db; }, 60000);
beforeEach(async () => {
  vi.clearAllMocks(); await resetDatabase(database.db);
  vi.stubEnv("APP_URL", "https://events.test"); vi.stubEnv("SESSION_SECRET", secret); state.origin = "https://events.test";
  state.identity = createIdentityServices({ db: database.db, secret });
  await queryable(database.db).query("insert into staff(email,role) values('admin@didit.me','admin')");
  // Admin actions name their event (capability check): the fixture ids exist as event slugs.
  for (const slug of ["created", "event"]) await queryable(database.db).query("insert into events (slug,name,starts_at,ends_at,capacity,status) values ($1,'Fixture',clock_timestamp()+interval '1 day',clock_timestamp()+interval '2 days',10,'published')", [slug]);
  const session = await accountSession(state.identity, database.db, "admin@didit.me");
  state.cookie = session.cookie; state.csrf = csrfToken(session.cookie, secret);
  state.upload.mockImplementation(async (_actor: unknown, _id: string, input: { expectedEventVersion: number }) => ({ editVersion: input.expectedEventVersion + 1 }));
  state.create.mockResolvedValue({ id: "created" }); state.update.mockResolvedValue({ ok: true, editVersion: 2, savedAt: new Date().toISOString() });
  state.add.mockResolvedValue({ added: 1, waitlisted: 0, duplicates: [] }); state.invite.mockResolvedValue({ invited: 1, approvedExisting: 0, waitlisted: 0, skippedInvalid: 0 });
});
afterEach(() => vi.unstubAllEnvs()); afterAll(async () => { delete (globalThis as typeof globalThis & { __diditEventsDb?: typeof database.db }).__diditEventsDb; await database?.close(); });
const jpeg=readFileSync(new URL("../../../../packages/core/src/identity/fixtures/photo.jpg",import.meta.url));
function form(size = 0, wide = 0) {
  const f = new FormData(); f.set("csrf", state.csrf); f.set("id", "created");
  for (const [key, value] of Object.entries(BCN_FORM)) f.set(key, typeof value === "boolean" ? value ? "on" : "" : typeof value === "object" ? JSON.stringify(value) : String(value));
  if (size) f.set("cover", new Blob([Buffer.concat([jpeg,Buffer.alloc(Math.max(0,size-jpeg.length))])], { type: "image/jpeg" }), "cover.jpg");
  if (wide) f.set("coverWide", new Blob([Buffer.concat([jpeg,Buffer.alloc(Math.max(0,wide-jpeg.length))])], { type: "image/jpeg" }), "banner.jpg");
  return f;
}
const prev = { status: "idle", values: BCN_FORM } as const;
it.each([200 * 1024, 3 * 1024 * 1024])("a %i-byte cover reaches event creation and update", async size => {
  await expect(createEventAction(prev, form(size))).rejects.toThrow("REDIRECT:/admin/events/created");
  expect(state.create).toHaveBeenCalledOnce(); expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ name: BCN_FORM.name }));
  expect(await updateEventAction(prev, form(size))).toMatchObject({ status: "saved" }); expect(state.update).toHaveBeenCalledOnce(); expect(state.upload).toHaveBeenCalledTimes(2);
});
it("invalid image bytes are rejected before creating or updating an event", async () => {
  const f=form();f.set("cover",new Blob(["not an image"],{type:"image/jpeg"}),"invalid.jpg");
  for(const action of [createEventAction,updateEventAction]) expect(await action(prev,f)).toMatchObject({status:"invalid",errors:{cover:expect.stringContaining("valid JPG")}});
  expect(state.create).not.toHaveBeenCalled();expect(state.update).not.toHaveBeenCalled();expect(state.upload).not.toHaveBeenCalled();
});
// The shared cover transport limit is 5 MiB for editor, multipart actions and MCP.
it("a 6 MB cover produces field errors without calling either writer", async () => {
  for (const action of [createEventAction, updateEventAction]) expect(await action(prev, form(6 * 1024 * 1024))).toMatchObject({ status: "invalid", errors: { cover: "Up to 5 MB" } });
  expect(state.create).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
  expect(nextConfig.experimental?.serverActions).toMatchObject({ bodySizeLimit: "11mb" });
});
it("a staged square cover and banner (4 MB each) are both stored after creation, main first, chaining the edit version", async () => {
  const f = form(4 * 1024 * 1024, 4 * 1024 * 1024); f.set("coverAlt", "Guests on the terrace");
  await expect(createEventAction(prev, f)).rejects.toThrow("REDIRECT:/admin/events/created");
  expect(state.upload.mock.calls.map(([, id, input]) => [id, input.variant, input.expectedEventVersion, input.alt])).toEqual([
    ["created", "main", 1, "Guests on the terrace"], ["created", "wide", 2, "Guests on the terrace"],
  ]);
  state.upload.mockClear();
  expect(await updateEventAction(prev, form(0, 200 * 1024))).toMatchObject({ status: "saved" });
  expect(state.upload.mock.calls.map(([, , input]) => [input.variant, input.expectedEventVersion])).toEqual([["wide", 2]]);
});
it("a 6 MB or undecodable banner is a cover field error and nothing is written", async () => {
  for (const action of [createEventAction, updateEventAction]) expect(await action(prev, form(0, 6 * 1024 * 1024))).toMatchObject({ status: "invalid", errors: { cover: "Banner: Up to 5 MB" } });
  const bad = form(); bad.set("coverWide", new Blob(["not an image"], { type: "image/jpeg" }), "banner.jpg");
  for (const action of [createEventAction, updateEventAction]) expect(await action(prev, bad)).toMatchObject({ status: "invalid", errors: { cover: expect.stringMatching(/^Banner: Use a valid JPG/) } });
  expect(state.create).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled(); expect(state.upload).not.toHaveBeenCalled();
});
it("event fields retain their own 512 KiB bound (v2 editor JSON) even with a cover allowance", async () => {
  const f = form(); f.set("extra", "x".repeat(513 * 1024));
  expect(await createEventAction(prev, f)).toMatchObject({ status: "invalid", errors: { description: "Keep event fields under 512 KB." } });
  expect(state.create).not.toHaveBeenCalled();
});
it("large guest batches and invitations reach their writers below 2 MB, and return input errors above it", async () => {
  const guest = { first: "Ana", last: "Ruiz", email: "ana@example.test", extra: "x".repeat(200 * 1024) };
  expect(await addGuestBatchAction("event", [guest], true, state.csrf)).toMatchObject({ ok: true, added: 1 });
  expect(await inviteAction("event", [guest.email], "Join us", false, true, state.csrf)).toMatchObject({ ok: true });
  expect(await inviteAction("event", [guest.email], guest.extra, false, true, state.csrf)).toMatchObject({ error: "invalid" });
  const oversized = "x".repeat(2 * 1024 * 1024);
  expect(await addGuestBatchAction("event", [{ ...guest, extra: oversized }], true, state.csrf)).toEqual({ error: "invalid", message: "Keep guest lists under 2 MB." });
  expect(await inviteAction("event", [guest.email], oversized, false, true, state.csrf)).toEqual({ error: "invalid", message: "Keep invitations under 2 MB." });
  expect(state.add).toHaveBeenCalledOnce(); expect(state.invite).toHaveBeenCalledOnce();
});
it("staff invitation limit returns a field error and makes no staff change", async () => {
  const f = form(); f.set("email", "new@didit.me"); f.set("role", "staff"); f.set("extra", "x".repeat(2 * 1024 * 1024));
  expect(await inviteStaffAction({ status: "idle" }, f)).toMatchObject({ status: "invalid", errors: { email: "Keep invitations under 2 MB." } });
  expect(await queryable(database.db).query("select email from staff")).toEqual([{ email: "admin@didit.me" }]);
});
it("photo transport oversize returns the photo form error", async () => {
  const [account] = await queryable(database.db).query<{ id: string }>("insert into accounts(email) values('photo@example.test') returning id");
  const issued = await state.identity!.sessions.rotate({ principal: "guest", accountId: account!.id, authenticatedAt: new Date(), authMethod: "email_otp" });
  state.cookie = issued.cookie; state.csrf = csrfToken(issued.cookie, secret);
  const f = form(); f.set("photo", new Blob([new Uint8Array(311 * 1024)]), "photo.jpg");
  expect(await uploadPhotoAction({}, f)).toEqual({ error: "Use a 512 by 512 JPEG under 300 KB." });
});
it("other actions default to 64 KiB and invalid Origin is rejected before size errors", async () => {
  const f = form(); f.set("extra", "x".repeat(65 * 1024));
  await expect(guardAction(f)).rejects.toMatchObject({ status: 413 });
  state.origin = "https://evil.test";
  await expect(createEventAction(prev, form(6 * 1024 * 1024))).rejects.toMatchObject({ status: 403 });
  expect(state.create).not.toHaveBeenCalled();
});
