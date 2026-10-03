import { readFile } from "node:fs/promises";
import { queryable } from "@didit-events/core/db/tx";
import { testDatabase } from "@didit-events/core/testing/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hostAccountPhoto, hostPhoto, hostPhotoPath, hostPhotoVersions, publicHosts, searchPeople } from "./hosts";

let database: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { database = await testDatabase(process.env.TEST_DATABASE_URL ? "postgres" : "pglite"); }, 60000);
afterAll(async () => { await database?.close(); });

const EVENT = "3f0a6c1e-8b1d-4c1a-9d5e-2a7b6c5d4e3f";

describe("hosts with an account photo", () => {
  it("public hosts never carry the email; an account host gets a versioned photo URL, others keep theirs", () => {
    const at = new Date("2026-09-30T10:00:00Z");
    const hosts = [
      { name: "Alberto Rosas", role: "Didit · CEO", email: "Events.Owner@didit.me" },
      { name: "Uma Bramwell", role: "Didit" },
      { name: "Guest", role: "Speaker", photoUrl: "https://example.test/g.jpg", email: "nophoto@example.test" },
    ];
    const out = publicHosts(EVENT, hosts, new Map([["events.owner@didit.me", at]]));
    expect(out).toEqual([
      { name: "Alberto Rosas", role: "Didit · CEO", photoUrl: hostPhotoPath(EVENT, 0, at) },
      { name: "Uma Bramwell", role: "Didit" },
      { name: "Guest", role: "Speaker", photoUrl: "https://example.test/g.jpg" },
    ]);
    expect(hostPhotoPath(EVENT, 0, at)).toBe(`/api/events/${EVENT}/hosts/0/photo?v=${at.getTime()}`);
    expect(JSON.stringify(out)).not.toContain("@");
  });

  it("resolves photos only for hosts of a published event, by index, and finds staff/accounts for the picker", async () => {
    const q = queryable(database.db), photo = await readFile(new URL("../../../../packages/core/src/identity/fixtures/photo.jpg", import.meta.url));
    const [alberto] = await q.query<{ id: string; updated_at: Date }>("insert into accounts(email,first_name,last_name,full_name,photo) values('events.owner@didit.me','Alberto','Rosas','Alberto Rosas',$1) returning id,updated_at", [photo]);
    await q.query("insert into accounts(email,first_name) values('uma@example.test','Uma')");
    await q.query("insert into staff(email,role) values('ops@didit.me','staff') on conflict do nothing");
    const speakers = JSON.stringify([{ name: "Alberto Rosas", role: "CEO", email: "events.owner@didit.me" }, { name: "Uma Bramwell", role: "Didit" }]);
    const insert = (slug: string, status: string, id: string) => q.query(
      `insert into events(id,slug,name,starts_at,ends_at,timezone,capacity,status,speakers) values($1,$2,'Hosts',clock_timestamp()+interval '1 day',clock_timestamp()+interval '2 days','UTC',10,$3,$4::jsonb)`,
      [id, slug, status, speakers]);
    await insert("hosts-live", "published", EVENT);
    await insert("hosts-draft", "draft", "4f0a6c1e-8b1d-4c1a-9d5e-2a7b6c5d4e3f");

    const versions = await hostPhotoVersions([{ name: "A", role: "", email: "EVENTS.OWNER@didit.me" }, { name: "U", role: "", email: "uma@example.test" }], database.db);
    expect([...versions.keys()]).toEqual(["events.owner@didit.me"]);
    expect(versions.get("events.owner@didit.me")!.getTime()).toBe(new Date(alberto!.updated_at).getTime());

    expect(await hostPhoto(EVENT, 0, database.db)).toEqual(photo);
    expect(await hostPhoto(EVENT, 1, database.db)).toBeNull(); // no account email
    expect(await hostPhoto(EVENT, 7, database.db)).toBeNull();
    expect(await hostPhoto("4f0a6c1e-8b1d-4c1a-9d5e-2a7b6c5d4e3f", 0, database.db)).toBeNull(); // drafts are not public
    await q.query("update accounts set deleting_at=clock_timestamp() where id=$1", [alberto!.id]);
    expect(await hostPhoto(EVENT, 0, database.db)).toBeNull();
    await q.query("update accounts set deleting_at=null where id=$1", [alberto!.id]);

    expect(await searchPeople("a", database.db)).toEqual([]);
    expect(await searchPeople("rosas", database.db)).toEqual([{ email: "events.owner@didit.me", name: "Alberto Rosas", hasPhoto: true }]);
    expect((await searchPeople("ops@", database.db)).map((p) => p.email)).toEqual(["ops@didit.me"]);
    expect(await searchPeople("%", database.db)).toEqual([]);

    // The editor's host avatar: any live account with a photo, by email (drafts included; staff-only route).
    expect(await hostAccountPhoto(" Events.Owner@didit.me ", database.db)).toEqual(photo);
    expect(await hostAccountPhoto("uma@example.test", database.db)).toBeNull(); // no photo
    expect(await hostAccountPhoto("nobody@example.test", database.db)).toBeNull();
    expect(await hostAccountPhoto("not-an-email", database.db)).toBeNull();
  });
});
