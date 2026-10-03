import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/index.ts";
import { queryable } from "../db/tx.ts";
import type { StaffPrincipal } from "../domain/services.ts";
import { resetDatabase, testDatabase } from "../testing/database.ts";
import { guestFixture, requestFixture, staffFixture } from "../testing/model.ts";
import { skipPostgres } from "../testing/postgres.ts";
import { Events } from "./events.ts";
import { Invites } from "./invites.ts";
import { Requests } from "./requests.ts";
import { staffAdmitting } from "./shared.ts";

/** Walk-ins: staff and hosts add or invite guests until the event ENDS; public requests still close at the start. */
for (const kind of ["pglite", "postgres"] as const) describe.skipIf(kind === "postgres" && skipPostgres)(`walk-ins ${kind}`, () => {
  let db: Db, close: () => Promise<void>, eventId: string;
  const q = () => queryable(db);
  const owner: StaffPrincipal = { principal: "staff", email: "owner@didit.me", role: "owner", sessionId: randomUUID() };
  beforeAll(async () => { ({ db, close } = await testDatabase(kind)); }, 60_000);
  afterAll(async () => { await close?.(); });
  beforeEach(async () => {
    await resetDatabase(db); await staffFixture(db, owner);
    const events = new Events(db);
    const event = await events.create(owner, { slug: `walk-in-${randomUUID().slice(0, 6)}`, name: "Walk-in night", startsAt: new Date(Date.now() + 86400_000), endsAt: new Date(Date.now() + 90000_000), capacity: 10, venue: "HQ", address: "One Street" });
    await events.publish(owner, event.id); eventId = event.id;
    // Doors are open: the event started an hour ago and ends in two.
    await q().query("update events set starts_at=clock_timestamp()-interval '1 hour',ends_at=clock_timestamp()+interval '2 hours' where id=$1", [eventId]);
  });
  async function host() {
    const accountId = randomUUID(), sessionId = randomUUID(), email = `host-${accountId.slice(0, 6)}@example.test`;
    await q().query("insert into accounts (id,email,email_verified_at,email_proof_method,email_proof_ref) values ($1,$2,clock_timestamp(),'legacy_verified','fixture')", [accountId, email]);
    await q().query("insert into sessions(id,token_hash,principal,auth_method,account_id,expires_at) values($1,$2,'guest','email_otp',$3,clock_timestamp()+interval '1 day')", [sessionId, randomUUID(), accountId]);
    await q().query("insert into event_members(event_id,email,role,invited_by) values($1,$2,'host',$3)", [eventId, email, owner.email]);
    return { principal: "staff", email, role: "staff", accountId, sessionId, scope: { eventId, role: "host" } } satisfies StaffPrincipal;
  }

  it("staff and hosts invite during a live event; the invitation expires when the event ENDS (not at its start)", async () => {
    const invites = new Invites(db);
    expect(await invites.batch(owner, eventId, ["walkin@example.test"], { skipApproval: true })).toMatchObject({ invited: 1 });
    expect(await invites.batch(await host(), eventId, ["second@example.test"], { skipApproval: true, sendLink: true })).toMatchObject({ invited: 1 });
    const rows = await q().query<{ expires: boolean }>("select abs(extract(epoch from i.expires_at-e.ends_at))<0.001 as expires from invites i join events e on e.id=i.event_id");
    expect(rows).toEqual([{ expires: true }, { expires: true }]);
    expect(await q().query("select count(*)::int n from outbox where kind='email:M-19'")).toEqual([{ n: 2 }]);
  });

  it("a walk-in redeems the invitation at the door while public requests are closed", async () => {
    const invites = new Invites(db), requests = new Requests(db);
    const walkIn = await guestFixture(db, "walkin@example.test"), stranger = await guestFixture(db);
    const { token } = await invites.create(owner, { eventId, email: "walkin@example.test", maxUses: 1, expiresAt: new Date(Date.now() + 3600_000), skipApproval: true });
    await expect(requests.submitRequest(stranger, eventId, { ...await requestFixture(db, stranger, eventId), idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "closed" });
    const result = await requests.submitRequest(walkIn, eventId, { ...await requestFixture(db, walkIn, eventId), inviteToken: token, idempotencyKey: randomUUID() });
    expect(result.registration.admission).toBe("approved");
  });

  it("after the end, adding guests says the event ended (never a server error)", async () => {
    await q().query("update events set ends_at=clock_timestamp()-interval '1 minute' where id=$1", [eventId]);
    const invites = new Invites(db);
    await expect(invites.batch(owner, eventId, ["late@example.test"], { skipApproval: true })).rejects.toThrow("EventEnded");
    await q().query("update events set status='cancelled',ends_at=clock_timestamp()+interval '1 hour' where id=$1", [eventId]);
    await expect(invites.batch(owner, eventId, ["late@example.test"], { skipApproval: true })).rejects.toThrow("EventCancelled");
  });

  it("staffAdmitting: published or live until the end; never drafts, ended or cancelled", () => {
    const at = new Date("2026-10-08T20:00:00Z"), base = { startsAt: new Date("2026-10-08T18:00:00Z"), endsAt: new Date("2026-10-08T22:00:00Z") } as never as Parameters<typeof staffAdmitting>[0];
    expect(staffAdmitting({ ...base, status: "published" }, at)).toBe(true);
    expect(staffAdmitting({ ...base, status: "live" }, at)).toBe(true);
    expect(staffAdmitting({ ...base, status: "published" }, new Date("2026-10-08T22:00:00Z"))).toBe(false);
    expect(staffAdmitting({ ...base, status: "draft" }, at)).toBe(false);
    expect(staffAdmitting({ ...base, status: "cancelled" }, at)).toBe(false);
  });
});
