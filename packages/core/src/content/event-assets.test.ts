import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { queryable } from "../db/tx.ts";
import type { StaffPrincipal } from "../domain/services.ts";
import { toEmailEvent } from "../notifications/email.ts";
import { testDatabase } from "../testing/database.ts";
import { skipPostgres } from "../testing/postgres.ts";
import { canonicalCover,coverWidth,eventCoverUrl,eventWideCoverUrl,readEventCover,uploadEventCover } from "./event-assets.ts";

describe.each(["pglite", ...(skipPostgres ? [] : ["postgres"])] as const)("immutable event covers (%s)", (driver) => {
  let database: Awaited<ReturnType<typeof testDatabase>>, id: string;
  const actor: StaffPrincipal = { principal: "staff", role: "admin", email: "admin@didit.me", sessionId: randomUUID() };
  const pixels = () => sharp({ create: { width: 600, height: 400, channels: 3, background: "#f00" } }).png().toBuffer();
  beforeAll(async () => {
    database = await testDatabase(driver as "pglite" | "postgres"); id = randomUUID();
    await queryable(database.db).query("insert into staff(email,role) values($1,'admin')", [actor.email]);
    await queryable(database.db).query("insert into sessions(id,token_hash,principal,auth_method,staff_email,expires_at) values($1,$2,'staff','email_otp',$3,now()+interval '1 day')",[actor.sessionId,randomUUID(),actor.email]);
    await queryable(database.db).query("insert into events(id,slug,name,starts_at,ends_at,capacity) values($1::uuid,$1::text,'Cover',now()+interval '1 day',now()+interval '2 days',5)", [id]);
  });
  afterAll(async () => database?.close());
  it("decodes and re-encodes; rejects SVG, invalid data, bombs and dimensions", async () => {
    const image = await canonicalCover(await pixels());
    expect(image).toMatchObject({ contentType: "image/webp", width: 600, height: 400 });
    expect((await sharp(image.bytes).metadata()).exif).toBeUndefined();
    for (const input of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from("not an image"), new Uint8Array(3 * 1024 * 1024 + 1)])
      await expect(canonicalCover(input)).rejects.toThrow("invalid");
    await expect(canonicalCover(await sharp({ create: { width: 4097, height: 1, channels: 3, background: "red" } }).png().toBuffer())).rejects.toThrow();
  });
  it("persists exact immutable versions and uses one URL for public projection and email hero", async () => {
    const a = await uploadEventCover(actor, id, { expectedEventVersion: 1, alt: "First", bytes: await pixels() }, database.db);
    expect(a.editVersion).toBe(2);
    expect((await readEventCover(id, a.version, undefined, database.db)).status).toBe(404);
    const privateResponse = await readEventCover(id, a.version, actor, database.db);
    expect(privateResponse.headers.get("cache-control")).toBe("private, no-store");
    const bytes = await privateResponse.arrayBuffer();
    await expect(uploadEventCover(actor, id, { expectedEventVersion: 1, alt: "Stale", bytes: await pixels() }, database.db)).rejects.toThrow("context_changed");
    expect((await queryable(database.db).query("select * from event_assets")).length).toBe(1);
    const b = await uploadEventCover(actor, id, { expectedEventVersion: 2, alt: "Second", bytes: await pixels() }, database.db);
    expect(a.version).not.toBe(b.version);
    await queryable(database.db).query("update events set status='published' where id=$1", [id]);
    const publicResponse = await readEventCover(id, a.version, undefined, database.db);
    expect(publicResponse.headers.get("cache-control")).toContain("immutable");
    expect(await publicResponse.arrayBuffer()).toEqual(bytes);
    expect((await readEventCover(randomUUID(), a.version, undefined, database.db)).status).toBe(404);
    const cover = { kind: "asset", version: b.version, alt: "Second" };
    expect(eventCoverUrl(id, cover)).toBe(b.url);
    expect(toEmailEvent({ id, slug: "cover", name: "Cover", starts_at: new Date(), ends_at: new Date(), timezone: "UTC",
      status: "published", venue: null, address: null,  cover }, "https://events.test").coverImageUrl).toBe(`https://events.test${b.url}`);
    await expect(queryable(database.db).query("update event_assets set bytes=$1 where event_id=$2", [Buffer.from("changed"), id])).rejects.toThrow();
  });
  it("serves width-limited variants (?w=) for display and keeps the original at the bare URL", async () => {
    const own = randomUUID();
    await queryable(database.db).query("insert into events(id,slug,name,starts_at,ends_at,capacity,status) values($1::uuid,$1::text,'Sized',now()+interval '1 day',now()+interval '2 days',5,'published')", [own]);
    const big = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: "#08f" } }).png().toBuffer();
    const up = await uploadEventCover(actor, own, { expectedEventVersion: 1, alt: "Big", bytes: big }, database.db);
    const original = await readEventCover(own, up.version, undefined, database.db);
    expect(await sharp(Buffer.from(await original.arrayBuffer())).metadata()).toMatchObject({ width: 2400, height: 1600 });
    const sized = await readEventCover(own, up.version, undefined, database.db, 720);
    expect(sized.headers.get("content-type")).toBe("image/webp");
    expect(sized.headers.get("cache-control")).toContain("immutable");
    expect(sized.headers.get("etag")).not.toBe(original.headers.get("etag"));
    expect(await sharp(Buffer.from(await sized.arrayBuffer())).metadata()).toMatchObject({ width: 720, height: 480 });
    // The same variant again comes from the cache: identical bytes, same ETag.
    expect((await readEventCover(own, up.version, undefined, database.db, 720)).headers.get("etag")).toBe(sized.headers.get("etag"));
    // The unversioned URL redirects to the current version and keeps the requested size (Astra, 2026-10-02).
    const redirect = await readEventCover(own, null, undefined, database.db, 192);
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("location")).toMatch(new RegExp(`v=${up.version}.*[?&]w=192$|w=192.*v=${up.version}`));
    // Never enlarged: a cover inside the box is the stored file.
    expect((await readEventCover(own, up.version, undefined, database.db, 1080)).headers.get("etag")).not.toBe(original.headers.get("etag"));
    const small = await uploadEventCover(actor, own, { expectedEventVersion: up.editVersion, alt: "Small", bytes: await pixels() }, database.db);
    const smallOriginal = await readEventCover(own, small.version, undefined, database.db);
    expect((await readEventCover(own, small.version, undefined, database.db, 720)).headers.get("etag")).toBe(smallOriginal.headers.get("etag"));
    // Only the allow-list is a width; anything else is the original.
    expect([coverWidth("720"), coverWidth("192"), coverWidth("721"), coverWidth("0720"), coverWidth(""), coverWidth(null)]).toEqual([720, 192, null, null, null, null]);
  });
  it("serves the cover of a cancelled event (its public page and My events still show it); a draft stays private", async () => {
    const [row] = await queryable(database.db).query<{ cover: { version: string } }>("select cover from events where id=$1", [id]);
    await queryable(database.db).query("update events set status='cancelled' where id=$1", [id]);
    const cancelled = await readEventCover(id, row!.cover.version, undefined, database.db, 192);
    expect(cancelled.status).toBe(200);
    expect((await readEventCover(id, null, undefined, database.db, 192)).status).toBe(307);
    await queryable(database.db).query("update events set status='draft' where id=$1", [id]);
    expect((await readEventCover(id, row!.cover.version, undefined, database.db, 192)).status).toBe(404);
    await queryable(database.db).query("update events set status='published' where id=$1", [id]);
  });
  it("keeps a wide banner beside the main cover: each upload replaces only its own variant", async () => {
    const own = randomUUID();
    await queryable(database.db).query("insert into events(id,slug,name,starts_at,ends_at,capacity) values($1::uuid,$1::text,'Wide',now()+interval '1 day',now()+interval '2 days',5)", [own]);
    const main = await uploadEventCover(actor, own, { expectedEventVersion: 1, alt: "Main", bytes: await pixels() }, database.db);
    const wide = await uploadEventCover(actor, own, { expectedEventVersion: main.editVersion, alt: "Banner", bytes: await pixels(), variant: "wide" }, database.db);
    let [row] = await queryable(database.db).query<{ cover: unknown }>("select cover from events where id=$1", [own]);
    expect(eventCoverUrl(own, row!.cover)).toBe(main.url);
    expect(eventWideCoverUrl(own, row!.cover)).toBe(wide.url);
    const main2 = await uploadEventCover(actor, own, { expectedEventVersion: wide.editVersion, alt: "Main 2", bytes: await pixels() }, database.db);
    [row] = await queryable(database.db).query<{ cover: unknown }>("select cover from events where id=$1", [own]);
    expect(eventCoverUrl(own, row!.cover)).toBe(main2.url);
    expect(eventWideCoverUrl(own, row!.cover)).toBe(wide.url);
  });
});
