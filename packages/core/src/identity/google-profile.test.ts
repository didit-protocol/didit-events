/**
 * Google sign-in prefill: the Didit OIDC claims (idp=google) fill an empty name and import the Google picture as the
 * profile photo of an account without one, never replacing what the person set. Fake OIDC claims and a fake picture host.
 */
import sharp from "sharp";
import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
import { queryable } from "../db/tx.ts";
import { DiditClient } from "../didit/client.ts";
import { fakeDiditServer } from "../didit/fake-server.ts";
import { createModelServices } from "../verification/model-runtime.ts";
import { googleNames, nameFromEmail } from "./auth.ts";
import { createIdentityServices } from "./index.ts";
import { photoFromPicture,pictureSource } from "./picture.ts";
import type { OidcClaims } from "./shared.ts";
import { testDatabase } from "../testing/database.ts";

const PICTURE = "https://lh3.googleusercontent.com/a/ACg8ocAna=s96-c";

describe("Google profile prefill", () => {
  let database: Awaited<ReturnType<typeof testDatabase>>, fake: Awaited<ReturnType<typeof fakeDiditServer>>;
  let identity: ReturnType<typeof createIdentityServices>, model: ReturnType<typeof createModelServices>;
  let claims: OidcClaims, picture: { bytes: Uint8Array; status: number; requests: string[] };
  const q = () => queryable(database.db);
  const pictureFetch: typeof fetch = async (input) => {
    picture.requests.push(String(input));
    return new Response(picture.status === 200 ? new Blob([picture.bytes as BlobPart]) : null, { status: picture.status, headers: { "content-type": "image/jpeg" } });
  };

  beforeAll(async () => {
    database = await testDatabase("pglite"); fake = await fakeDiditServer();
    const client = new DiditClient({ apiKey: "fake", fetch: fake.fetch });
    identity = createIdentityServices({ db: database.db, didit: client, secret: "s".repeat(40), appUrl: "https://events.test", fetch: pictureFetch,
      oidc: { authorize: async ({ state }) => `https://apx.didit.test/authorize?state=${state}&idp=google`, exchange: async () => claims } });
    model = createModelServices({ db: database.db, client, appUrl: "https://events.test" });
  }, 60000);
  afterAll(async () => { await fake?.close(); await database?.close(); });
  beforeEach(async () => {
    claims = { issuer: "https://auth.didit.me/", subject: `google-${Math.random()}`, email: `ana${Math.random().toString(36).slice(2)}@example.test`,
      firstName: "Ana", lastName: "Ruiz", fullName: "Ana Ruiz", picture: PICTURE };
    picture = { bytes: new Uint8Array(await sharp({ create: { width: 96, height: 96, channels: 3, background: "#c08060" } }).jpeg().toBuffer()), status: 200, requests: [] };
  });

  async function signIn() {
    const start = await identity.auth.beginOidc("guest", "/me/events");
    const state = new URL(start.url).searchParams.get("state");
    const result = await identity.auth.finishOidc(`https://events.test/api/auth/oidc/callback?state=${state}&code=fixture`, start.cookie);
    if (result.principal.principal !== "guest") throw new Error("Guest required");
    return result.principal;
  }
  const row = async (accountId: string) => (await q().query<{ first_name: string | null; last_name: string | null; full_name: string | null; photo: Uint8Array | null; photo_url: string | null }>(
    "select first_name,last_name,full_name,photo,photo_url from accounts where id=$1", [accountId]))[0]!;

  it("a new account gets the Google name and picture; the join modal's profile step shows them", async () => {
    const principal = await signIn(), account = await row(principal.accountId);
    expect(account).toMatchObject({ first_name: "Ana", last_name: "Ruiz", full_name: "Ana Ruiz", photo_url: "/api/me/photo" });
    const photo = await sharp(account.photo!).metadata();
    expect(photo).toMatchObject({ format: "jpeg", width: 512, height: 512 });
    expect(account.photo!.byteLength).toBeLessThanOrEqual(300 * 1024);
    expect(picture.requests).toEqual(["https://lh3.googleusercontent.com/a/ACg8ocAna=s512-c"]);
    const view = await model.onboarding.getOnboarding(principal);
    expect(view.profile.fullName).toBe("Ana Ruiz");
    expect(view.photoUrl).toBe("/api/me/photo");
  });

  it("an existing account without a name or photo is filled on its next Google sign-in", async () => {
    const principal = await signIn();
    await q().query("update accounts set first_name=null,last_name=null,full_name=null,photo=null,photo_url=null where id=$1", [principal.accountId]);
    await signIn();
    expect(await row(principal.accountId)).toMatchObject({ first_name: "Ana", last_name: "Ruiz", full_name: "Ana Ruiz", photo_url: "/api/me/photo" });
  });

  it("never replaces a name or photo the person set", async () => {
    const principal = await signIn(), mine = new Uint8Array(await sharp({ create: { width: 512, height: 512, channels: 3, background: "#123456" } }).jpeg().toBuffer());
    await q().query("update accounts set first_name='Annie',last_name=null,full_name='Annie',photo=$2 where id=$1", [principal.accountId, mine]);
    picture.requests = [];
    claims = { ...claims, firstName: "Google", lastName: "Name", fullName: "Google Name" };
    await signIn();
    const account = await row(principal.accountId);
    expect(account).toMatchObject({ first_name: "Annie", last_name: null, full_name: "Annie" });
    expect(Buffer.from(account.photo!).equals(Buffer.from(mine))).toBe(true);
    expect(picture.requests).toEqual([]);
  });

  it.each([
    ["the picture host fails", () => { picture.status = 404; }],
    ["the picture is not an image", () => { picture.bytes = new TextEncoder().encode("<html>nope</html>"); }],
    ["the picture is over the upload limit", () => { picture.bytes = new Uint8Array(311 * 1024).fill(1); }],
    ["the picture URL is not on a Google host", () => { claims = { ...claims, picture: "https://attacker.example/ana.jpg" }; }],
    ["there is no picture claim", () => { claims = { ...claims, picture: undefined }; }],
  ])("sign-in still succeeds without a photo when %s", async (_label, arrange) => {
    arrange();
    const principal = await signIn();
    expect(await row(principal.accountId)).toMatchObject({ full_name: "Ana Ruiz", photo: null, photo_url: null });
    if (!claims.picture?.startsWith("https://lh3.")) expect(picture.requests).toEqual([]);
  });

  it("splits a lone Google full name the way the profile form does", () => {
    expect(googleNames({ issuer: "i", subject: "s", email: "e", fullName: "Ana María Ruiz" })).toEqual({ firstName: "Ana", lastName: "María Ruiz", fullName: "Ana María Ruiz" });
    expect(googleNames({ issuer: "i", subject: "s", email: "e", firstName: "Ana" })).toEqual({ firstName: "Ana", lastName: null, fullName: "Ana" });
    expect(googleNames(undefined)).toEqual({ firstName: null, lastName: null, fullName: null });
  });

  it("only fetches https pictures on Google/Didit hosts and asks Google for 512 px", async () => {
    expect(pictureSource(PICTURE)).toBe("https://lh3.googleusercontent.com/a/ACg8ocAna=s512-c");
    for (const bad of ["http://lh3.googleusercontent.com/a/x", "https://googleusercontent.com.evil.test/a", "https://user:pw@lh3.googleusercontent.com/a", "https://lh3.googleusercontent.com:8443/a", "not a url"]) expect(pictureSource(bad)).toBeNull();
    const png = new Uint8Array(await sharp({ create: { width: 800, height: 600, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).png().toBuffer());
    expect(await sharp(await photoFromPicture(png)).metadata()).toMatchObject({ format: "jpeg", width: 512, height: 512 });
  });
});

describe("name suggestion from the email (Didit sent no name)", () => {
  it("firstname.lastname style addresses only", () => {
    expect(nameFromEmail("events.owner@didit.me")).toBe("Events Owner");
    expect(nameFromEmail("uma.bramwell+events@didit.me")).toBe("Uma Bramwell");
    expect(nameFromEmail("maria_jose-lopez@x.es")).toBe("Maria Jose Lopez");
    for (const e of ["eventsowner@example.com", "a.b@x.com", "j.smith2@x.com", "info@x.com", "one.two.three.four@x.com", undefined]) expect(nameFromEmail(e)).toBeNull();
    expect(googleNames({ issuer: "i", subject: "s", email: "events.owner@didit.me" })).toEqual({ firstName: "Events", lastName: "Owner", fullName: "Events Owner" });
    expect(googleNames({ issuer: "i", subject: "s", email: "events.owner@didit.me", fullName: "Alberto R." }).fullName).toBe("Alberto R.");
  });
});
