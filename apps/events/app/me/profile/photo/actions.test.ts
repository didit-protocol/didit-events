import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createIdentityServices } from "@didit-events/core/identity";
import { testDatabase, resetDatabase } from "@didit-events/core/testing/database";
import { queryable } from "@didit-events/core/db/tx";
import { csrfToken } from "../../../../src/auth/browser";
import { photoSrc } from "../../../../src/accounts/photo";
import { removePhotoAction, savePhotoAction } from "./actions";
import { GET } from "../../../api/me/photo/route";

// Real identity service, real guards, real (PGlite) database: only Next's request plumbing is substituted.
const state = vi.hoisted(() => ({ cookie: "", csrf: "", origin: "https://events.test", identity: undefined as ReturnType<typeof createIdentityServices> | undefined }));
vi.mock("../../../../src/auth/runtime", () => ({ get identity() { return state.identity!; } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "__Host-sid" ? { value: state.cookie } : name === "__Host-csrf" ? { value: state.csrf } : undefined) }),
  headers: async () => new Headers({ origin: state.origin, cookie: `__Host-sid=${state.cookie}; __Host-csrf=${state.csrf}` }),
}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const secret = "photo-upload-test-secret-longer-than-32-characters";
let database: Awaited<ReturnType<typeof testDatabase>>;
let accountId = "";
const jpeg = async () => new Uint8Array(await readFile(new URL("../../../../../../packages/core/src/identity/fixtures/photo.jpg", import.meta.url)));
const form = (photo?: Blob) => {
  const f = new FormData();
  f.set("csrf", state.csrf);
  if (photo) f.set("photo", photo, "photo.jpg");
  return f;
};
const getPhoto = () => GET(new Request("https://events.test/api/me/photo", { headers: { cookie: `__Host-sid=${state.cookie}`, "sec-fetch-site": "same-origin" } }));

beforeAll(async () => {
  database = await testDatabase(process.env.TEST_DATABASE_URL ? "postgres" : "pglite");
  (globalThis as typeof globalThis & { __diditEventsDb?: typeof database.db }).__diditEventsDb = database.db;
}, 60000);
beforeEach(async () => {
  await resetDatabase(database.db);
  vi.stubEnv("APP_URL", "https://events.test");
  vi.stubEnv("SESSION_SECRET", secret);
  state.origin = "https://events.test";
  state.identity = createIdentityServices({ db: database.db, secret });
  const [account] = await queryable(database.db).query<{ id: string }>("insert into accounts(email) values('photo@example.test') returning id");
  accountId = account!.id;
  const issued = await state.identity.sessions.rotate({ principal: "guest", accountId, authenticatedAt: new Date(), authMethod: "email_otp" });
  state.cookie = issued.cookie;
  state.csrf = csrfToken(issued.cookie, secret);
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  delete (globalThis as typeof globalThis & { __diditEventsDb?: typeof database.db }).__diditEventsDb;
  await database?.close();
});

it("a 512 px JPEG is stored in accounts.photo and served back by GET /api/me/photo", async () => {
  const bytes = await jpeg();
  expect(await savePhotoAction({}, form(new Blob([bytes], { type: "image/jpeg" })))).toEqual({ saved: true });
  const [row] = await queryable(database.db).query<{ photo_url: string; photo: Uint8Array; updated_at: Date }>("select photo_url,photo,updated_at from accounts where id=$1", [accountId]);
  expect(row!.photo_url).toBe("/api/me/photo");
  expect(await sharp(row!.photo).metadata()).toMatchObject({format:"jpeg",width:512,height:512});
  expect((await sharp(row!.photo).metadata()).exif).toBeUndefined();
  const res = await getPhoto();
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/jpeg");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(row!.photo));
  // The avatar URL carries the update time, so a new upload changes every <img src>.
  expect(photoSrc(row!.photo_url, row!.updated_at)).toMatch(/^\/api\/me\/photo\?v=\d+$/);
});

it("wrong type, wrong size and a PNG are refused with an inline error and nothing is stored", async () => {
  const bytes = await jpeg();
  expect(await savePhotoAction({}, form(new Blob([bytes], { type: "image/png" })))).toEqual({ error: "That photo didn’t upload. Use a JPG or PNG under 5 MB." });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Uint8Array(64)]);
  expect(await savePhotoAction({}, form(new Blob([png], { type: "image/jpeg" })))).toEqual({ error: "That file is not a JPG or PNG. Use a JPG or PNG under 5 MB." });
  const notSquare = bytes.slice();
  const sof = notSquare.findIndex((b, i) => b === 255 && notSquare[i + 1] === 192);
  notSquare[sof + 5] = 1;
  expect(await savePhotoAction({}, form(new Blob([notSquare], { type: "image/jpeg" })))).toEqual({ error: "Use a 512 by 512 JPEG under 300 KB." });
  expect(await savePhotoAction({}, form())).toEqual({ error: "Choose a JPG or PNG under 5 MB." });
  expect((await getPhoto()).status).toBe(404);
});

it("Remove clears the stored photo; the route then 404s and the avatar falls back to the initial", async () => {
  await savePhotoAction({}, form(new Blob([await jpeg()], { type: "image/jpeg" })));
  expect(await removePhotoAction({}, form())).toEqual({ removed: true });
  expect(await queryable(database.db).query("select photo,photo_url from accounts where id=$1", [accountId])).toEqual([{ photo: null, photo_url: null }]);
  expect((await getPhoto()).status).toBe(404);
});

it("both actions reject a wrong CSRF token and a foreign Origin before touching the photo", async () => {
  const bad = form(new Blob([await jpeg()], { type: "image/jpeg" }));
  bad.set("csrf", "wrong");
  await expect(savePhotoAction({}, bad)).rejects.toMatchObject({ status: 403 });
  await expect(removePhotoAction({}, bad)).rejects.toMatchObject({ status: 403 });
  state.origin = "https://evil.test";
  await expect(savePhotoAction({}, form(new Blob([await jpeg()], { type: "image/jpeg" })))).rejects.toMatchObject({ status: 403 });
  expect(await queryable(database.db).query("select photo_url from accounts where id=$1", [accountId])).toEqual([{ photo_url: null }]);
});

it("a signed-out browser is sent to sign in and back to Edit profile", async () => {
  await state.identity!.sessions.revoke((await state.identity!.auth.requireGuest(state.cookie)).sessionId);
  await expect(savePhotoAction({}, form(new Blob([await jpeg()], { type: "image/jpeg" })))).rejects.toThrow(/REDIRECT:\/login\?next=/);
  await expect(removePhotoAction({}, form())).rejects.toThrow(/REDIRECT:\/login\?next=/);
});
