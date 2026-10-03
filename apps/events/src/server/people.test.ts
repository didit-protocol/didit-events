import { randomUUID } from "node:crypto";
import { queryable } from "@didit-events/core/db/tx";
import { seed, testDatabase } from "@didit-events/core/testing/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parsePeopleQuery } from "../admin/people/query";
import { peopleList, peoplePhoto, personDetail } from "./people";

let database: Awaited<ReturnType<typeof testDatabase>>;
const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const ids = { ana: randomUUID(), bob: randomUUID(), cara: randomUUID(), dee: randomUUID() };
let events: { live: string; past: string; other: string };
const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

/** An event from the core seed, with the seed's own account removed so only our accounts count. */
async function event(name: string, slug: string, startsDaysAgo: number) {
  const q = queryable(database.db), { eventId, accountId } = await seed(database.db);
  await q.query("delete from accounts where id=$1", [accountId]);
  await q.query("update events set name=$2,slug=$3,timezone='Europe/Madrid',starts_at=$4,ends_at=$5 where id=$1", [eventId, name, slug, ago(startsDaysAgo), ago(startsDaysAgo - 0.2)]);
  return eventId;
}

beforeAll(async () => {
  database = await testDatabase(process.env.TEST_DATABASE_URL ? "postgres" : "pglite");
  const q = queryable(database.db);
  events = { live: await event("Barcelona Office Opening", "bcn-opening", 1), past: await event("Madrid Fraud Summit", "mad-summit", 30), other: await event("Lisbon Meetup", "lis-meetup", -10) };

  // Ana: every field filled — photo, profile, verified email, current selfie, Google + email code, two registrations
  // (approved + checked in, waitlisted), an approval in the history, host on another event.
  await q.query(
    `insert into accounts(id,email,first_name,last_name,full_name,photo,headline,company,job_role,bio,profile_links,email_verified_at,email_proof_method,email_proof_ref,created_at,profile_version)
     values($1,'ana@example.test','Ana','García','Ana García',$2,'Head of Risk','Globex','Fraud & Identity','Building fraud tooling.',$3::jsonb,$4,'didit_google','fixture',$5,3)`,
    [ids.ana, PHOTO, JSON.stringify([{ kind: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/in/ana" }]), ago(40), ago(41)],
  );
  const verification = randomUUID(), session = randomUUID();
  await q.query("insert into verifications(id,account_id,didit_session_id,workflow_id,vendor_data,status) values($1,$2,$3,$4,'ana@example.test','approved')", [verification, ids.ana, session, randomUUID()]);
  await q.query("insert into evidence(account_id,verification_id,kind,source,established_at,valid_until,activation,provider_status) values($1,$2,'face','liveness',$3,$4,'active','approved')", [ids.ana, verification, ago(39), ago(-150)]);
  await q.query("insert into account_identities(account_id,issuer,subject) values($1,'https://accounts.google.com','ana-sub')", [ids.ana]);
  await q.query("insert into sessions(token_hash,principal,auth_method,account_id,expires_at,last_seen_at) values($1,'guest','email_otp',$2,$3,$4)", [randomUUID(), ids.ana, ago(-30), ago(0.01)]);
  const [approved] = await q.query<{ id: string }>("insert into registrations(legacy_imported,policy_version,form_version,account_id,event_id,admission,applied_at) values(true,1,1,$1,$2,'approved',$3) returning id", [ids.ana, events.live, ago(5)]);
  await q.query(`insert into admission_history(registration_id,"from","to",actor) values($1,'pending','approved','owner@didit.me')`, [approved!.id]);
  await q.query("insert into checkins(event_id,registration_id,method,by_staff,checked_in_at) values($1,$2,'manual','ops@didit.me',$3)", [events.live, approved!.id, ago(0.9)]);
  await q.query("insert into registrations(legacy_imported,policy_version,form_version,account_id,event_id,admission,applied_at) values(true,1,1,$1,$2,'waitlisted',$3)", [ids.ana, events.past, ago(35)]);
  await q.query("insert into event_members(event_id,email,role,invited_by) values($1,'ana@example.test','host','owner@didit.me')", [events.other]);

  // Bob: not verified, works at Acme, one rejected request. Cara: deleting. Dee: Didit staff (admin).
  await q.query("insert into accounts(id,email,first_name,company,created_at) values($1,'bob@example.test','Bob','Acme Corp',$2)", [ids.bob, ago(20)]);
  await q.query("insert into registrations(legacy_imported,policy_version,form_version,account_id,event_id,admission) values(true,1,1,$1,$2,'rejected')", [ids.bob, events.other]);
  await q.query("insert into accounts(id,email,full_name,created_at,deleting_at) values($1,'cara@example.test','Cara Old',$2,$3)", [ids.cara, ago(60), ago(1)]);
  await q.query("insert into accounts(id,email,full_name,created_at) values($1,'dee@didit.me','Dee Staff',$2)", [ids.dee, ago(10)]);
  await q.query("insert into staff(email,role) values('dee@didit.me','admin')");
  // 30 more sign-ups (oldest), so the list pages.
  for (let i = 0; i < 30; i++) await q.query("insert into accounts(email,full_name,created_at) values($1,$2,$3)", [`filler${String(i).padStart(2, "0")}@example.test`, `Filler ${i}`, ago(100 + i)]);
}, 120_000);
afterAll(async () => { await database?.close(); });

const list = (params: Record<string, string>) => peopleList(parsePeopleQuery(params), database.db, NOW);

describe("People list (SQL search, filters, sort, pages)", () => {
  it("counts every chip over everyone and returns the newest sign-ups first, 25 per page", async () => {
    const { page, counts } = await list({});
    expect(counts).toEqual({ all: 34, verified: 1, unverified: 32, attended: 1, team: 2, deleted: 1 });
    expect(page.total).toBe(34);
    expect(page.rows).toHaveLength(25);
    expect(page.rows.slice(0, 4).map((r) => r.email)).toEqual(["dee@didit.me", "bob@example.test", "ana@example.test", "cara@example.test"]);
    const second = await list({ page: "2" });
    expect(second.page.rows).toHaveLength(9);
    expect(second.page.total).toBe(34);
    expect((await list({ page: "9" })).page).toMatchObject({ rows: [], total: 34 });
  });

  it("a row carries the photo, badge, counts, staff role and activity", async () => {
    const ana = (await list({ q: "ana@" })).page.rows[0]!;
    expect(ana).toMatchObject({ id: ids.ana, name: "Ana García", emailVerified: true, headline: "Head of Risk", company: "Globex", verification: "verified", registered: 2, attended: 1, staffRole: null, memberships: 1, deletion: null });
    expect(ana.photoUrl).toMatch(new RegExp(`^/api/admin/people/${ids.ana}/photo\\?v=\\d+$`));
    expect(ana.verified).toMatchObject({ method: "Selfie liveness", verifiedAt: ago(39).toISOString() });
    expect(new Date(ana.lastActiveAt!).getTime()).toBeGreaterThan(ago(0.02).getTime());
    const dee = (await list({ q: "dee" })).page.rows[0]!;
    expect(dee).toMatchObject({ staffRole: "admin", verification: "not_started", verified: null, photoUrl: null });
  });

  it("searches name, email and company; filters by each chip", async () => {
    const emails = async (params: Record<string, string>) => (await list(params)).page.rows.map((r) => r.email);
    expect(await emails({ q: "garcía" })).toEqual(["ana@example.test"]);
    expect(await emails({ q: "ACME" })).toEqual(["bob@example.test"]);
    expect(await emails({ q: "@didit.me" })).toEqual(["dee@didit.me"]);
    expect(await emails({ q: "100%" })).toEqual([]);
    expect(await emails({ filter: "verified" })).toEqual(["ana@example.test"]);
    expect(await emails({ filter: "attended" })).toEqual(["ana@example.test"]);
    expect((await emails({ filter: "team" })).sort()).toEqual(["ana@example.test", "dee@didit.me"]);
    expect(await emails({ filter: "deleted" })).toEqual(["cara@example.test"]);
    expect(await emails({ filter: "unverified", q: "example" })).not.toContain("cara@example.test");
    expect(await emails({ filter: "verified", q: "bob" })).toEqual([]);
  });

  it("sorts by registrations, name and sign-up date both ways", async () => {
    expect((await list({ sort: "registered" })).page.rows.slice(0, 2).map((r) => r.email)).toEqual(["ana@example.test", "bob@example.test"]);
    expect((await list({ sort: "name", dir: "asc" })).page.rows[0]!.name).toBe("Ana García");
    expect((await list({ sort: "createdAt", dir: "asc" })).page.rows[0]!.email).toBe("filler29@example.test");
    expect((await list({ sort: "attended" })).page.rows[0]!.email).toBe("ana@example.test");
  });
});

describe("People detail", () => {
  it("returns every section for a fully populated account", async () => {
    const d = (await personDetail(ids.ana, database.db, NOW))!;
    expect(d).toMatchObject({
      id: ids.ana, name: "Ana García", email: "ana@example.test", headline: "Head of Risk", company: "Globex", role: "Fraud & Identity", bio: "Building fraud tooling.",
      links: [{ kind: "LinkedIn", label: "LinkedIn", href: "https://www.linkedin.com/in/ana" }],
      emailVerifiedAt: ago(40).toISOString(), createdAt: ago(41).toISOString(), profileVersion: 3, deletingAt: null, deletedAt: null,
      verification: { state: "verified", method: "Selfie liveness", verifiedAt: ago(39).toISOString(), validUntil: ago(-150).toISOString() },
      signIn: ["Google", "Email code"],
      attendance: { registered: 2, approved: 1, attended: 1, noShows: 0 },
      staff: null,
      memberships: [{ eventId: events.other, eventName: "Lisbon Meetup", href: "/admin/events/lis-meetup", role: "host" }],
    });
    expect(d.verification.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(d.verification.diditUrl).toBe(`https://business.didit.me/verification/sessions/${d.verification.sessionId}`);
    expect(d.photoUrl).toMatch(`/api/admin/people/${ids.ana}/photo`);
    expect(d.verified).toMatchObject({ method: "Selfie liveness" });
    expect(d.registrations).toEqual([
      expect.objectContaining({ eventName: "Barcelona Office Opening", href: "/admin/events/bcn-opening", status: "approved", requestedAt: ago(5).toISOString(), checkedInAt: ago(0.9).toISOString(), timeZone: "Europe/Madrid" }),
      expect.objectContaining({ eventName: "Madrid Fraud Summit", status: "waitlisted", checkedInAt: null }),
    ]);
    // The selfie reuses the staff selfie route of a registration whose data is retained.
    expect(d.selfieUrl).toBe(`/api/admin/events/${events.live}/applicants/${d.registrations[0]!.id}/selfie`);
    const labels = d.activity.map((a) => a.label);
    for (const label of ["Signed up", "Email verified", "Verified by Didit", "Approved", "Checked in", "Profile updated"]) expect(labels).toContain(label);
    expect(d.activity.find((a) => a.label === "Checked in")!.detail).toBe("Barcelona Office Opening · Manual by ops@didit.me");
    expect(d.activity.map((a) => a.at)).toEqual([...d.activity.map((a) => a.at)].sort().reverse());
  });

  it("maps statuses, staff, deletion and the empty cases", async () => {
    const bob = (await personDetail(ids.bob, database.db, NOW))!;
    expect(bob).toMatchObject({ signIn: [], selfieUrl: null, verification: { state: "not_started", sessionId: null }, registrations: [expect.objectContaining({ status: "rejected" })], attendance: { registered: 1, approved: 0, attended: 0, noShows: 0 } });
    expect((await personDetail(ids.dee, database.db, NOW))!.staff).toMatchObject({ role: "admin", disabledAt: null });
    const cara = (await personDetail(ids.cara, database.db, NOW))!;
    expect(cara.deletingAt).toBe(ago(1).toISOString());
    expect(cara.activity.map((a) => a.label)).toContain("Account deletion started");
    expect(await personDetail(randomUUID(), database.db, NOW)).toBeNull();
    expect(await personDetail("not-a-uuid", database.db, NOW)).toBeNull();
  });

  it("serves the photo only for live accounts that have one", async () => {
    expect(Buffer.from((await peoplePhoto(ids.ana, database.db))!)).toEqual(PHOTO);
    expect(await peoplePhoto(ids.bob, database.db)).toBeNull();
    expect(await peoplePhoto("x", database.db)).toBeNull();
  });
});
