import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import type { Db } from "../db/index.ts";
import { lockAccount,lockForDeletion,queryable,withTx } from "../db/tx.ts";
import { fakeDiditServer } from "../didit/fake-server.ts";
import { type ConsentInput } from "../domain/event-model.ts";
import type { GuestPrincipal,StaffPrincipal } from "../domain/services.ts";
import { JobRegistry } from "../jobs.ts";
import { registerEmailHandlers } from "../notifications/email.ts";
import { startFakeResend } from "../notifications/fake-resend.ts";
import { dispatchOutbox,OutboxRegistry } from "../outbox.ts";
import { deferred,resetDatabase,testDatabase } from "../testing/database.ts";
import { Admissions } from "./admission.ts";
import { csvCell,parseCsv } from "./csv.ts";
import { Events } from "./events.ts";
import { Invites } from "./invites.ts";
import { dispatchAdmissionJobs } from "./jobs.ts";
import { eventReadModel } from "./read-model.ts";
import { Requests } from "./requests.ts";

const owner: StaffPrincipal = { principal: "staff", email: "owner@didit.me", role: "owner", sessionId: randomUUID() };
const staff: StaffPrincipal = { ...owner, email: "staff@didit.me", role: "staff",sessionId:randomUUID() };
for (const kind of ["pglite", ...(process.env.TEST_DATABASE_URL ? ["postgres" as const] : [])] as const) describe(`B4 ${kind}`, () => {
  let db: Db, close: () => Promise<void>, admissions: Admissions, events: Events, invites: Invites, fake: Awaited<ReturnType<typeof fakeDiditServer>>;
  beforeAll(async () => { ({ db, close } = await testDatabase(kind)); admissions = new Admissions(db); events = new Events(db); invites = new Invites(db); fake = await fakeDiditServer(); }, 60000);
  afterAll(async () => { expect(fake.calls).toHaveLength(0); await fake.close(); await close(); });
  let jobs: JobRegistry;
  beforeEach(async () => { jobs = new JobRegistry(); await resetDatabase(db); await queryable(db).query("insert into staff (email,role) values ($1,'owner'),($2,'staff')", [owner.email, staff.email]);
    for(const actor of [owner,staff])await queryable(db).query("insert into sessions(id,token_hash,principal,auth_method,staff_email,expires_at) values($1,$2,'staff','email_otp',$3,clock_timestamp()+interval '1 day')",[actor.sessionId,randomUUID(),actor.email]);
  });
  async function event(capacity = 5, registrationMode: "open" | "request" | "invite_only" = "request", hours = 48) {
    const e = await events.create(owner, { name: "Real database event", slug: randomUUID(), startsAt: new Date(Date.now() + hours * 3600000), endsAt: new Date(Date.now() + (hours + 3) * 3600000), capacity,venue:"HQ",address:"One Street", form: {version:1,mode:registrationMode,closes_at:null,waitlist:true,fields:{phone_number:"off"},questions:[],consent_text:null} });
    return events.publish(owner, e.id);
  }
  async function guest(email = `${randomUUID()}@example.test`): Promise<GuestPrincipal> {
    const id = randomUUID(); await queryable(db).query("insert into accounts (id,email,first_name,last_name) values ($1,$2,'Test','Guest')", [id, email]); await qBaseline(id); const sessionId=randomUUID();await queryable(db).query("insert into sessions(id,token_hash,principal,auth_method,account_id,expires_at) values($1,$2,'guest','email_otp',$3,clock_timestamp()+interval '1 day')",[sessionId,randomUUID(),id]);return { principal: "guest", accountId: id, sessionId, authenticatedAt: new Date() };
  }
  // Tests now enter through the same baseline and receipt contract as real requests.
  async function qBaseline(id:string) {
    await queryable(db).query(`update accounts set email_verified_at=clock_timestamp(),email_proof_method='didit_otp',email_proof_ref='fixture',full_name='Test Guest',headline='Builder',company='Independent',job_role='',bio='Building software',profile_links='[{"kind":"website","label":"Website","href":"https://example.test/"}]' where id=$1`,[id]);
    await verify({principal:"guest",accountId:id,sessionId:randomUUID(),authenticatedAt:new Date()});
  }
  async function verify(g:GuestPrincipal) {
    const q=queryable(db),id=randomUUID();
    await q.query("update evidence set activation='superseded',state='superseded',superseded_at=clock_timestamp() where account_id=$1 and kind='face' and activation='active'",[g.accountId]);
    await q.query("insert into verifications(id,account_id,didit_session_id,workflow_id,vendor_data,status,decided_at) values($1,$2,$3,$4,$5,'approved',clock_timestamp())",[id,g.accountId,randomUUID(),randomUUID(),`acct_${g.accountId}`]);
    await q.query("insert into evidence(account_id,verification_id,kind,established_at,valid_until,activation,provider_status) values($1,$2,'face',clock_timestamp(),clock_timestamp()+interval '170 days','active','approved')",[g.accountId,id]);
  }
  const consent:ConsentInput={disclosureVersion:"events-profile-v2",shareProfileWithHosts:true,eventConsentAccepted:true,acceptedChecks:["face"]};
  async function input(g:GuestPrincipal,eventId:string,joinWaitlist=false) {
    const c=await new Requests(db).getRequestContext(g,eventId);
    return {expectedPolicyVersion:c.event.policyVersion,expectedFormVersion:c.event.formVersion,profileVersion:c.onboarding.profileVersion,application:{fields:{},answers:{}},consent,joinWaitlist,idempotencyKey:randomUUID()};
  }
  async function apply(g:GuestPrincipal,eventId:string,_application:unknown={},joinWaitlist=false) {
    return admissions.apply(g,eventId,await input(g,eventId,joinWaitlist));
  }
  const redeemKeys=new Map<string,string>();
  async function redeem(g:GuestPrincipal,token:string) {
    const invite=(await invites.get(token))!,data=await input(g,invite.eventId),key=g.accountId+token;
    if(!redeemKeys.has(key))redeemKeys.set(key,randomUUID());
    return invites.redeem(g,token,{...data,idempotencyKey:redeemKeys.get(key)});
  }
  async function update(id:string,patch:Record<string,unknown>) {
    return events.update(owner,id,{...patch,expectedVersion:(await events.get(id))!.editVersion});
  }
  it("50 concurrent Guests-tab approvals never oversubscribe or silently waitlist", async () => {
    const e = await event(7), registrations = [];
    for (let i = 0; i < 50; i++) registrations.push(await apply(await guest(), e.id));
    const settled = await Promise.allSettled(registrations.map(r => admissions.transition(owner, r.id, "approved")));
    expect(settled.filter(r => r.status === "rejected")).toHaveLength(43);
    for (const result of settled) if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "Capacity" });
    const result = settled.flatMap(r => r.status === "fulfilled" ? [r.value] : []);
    expect(result.filter(r => r.admission === "approved")).toHaveLength(7);
    const model = (await eventReadModel(e.id, db))!;
    expect(model.approvedCount).toBe(7);
    expect(model.registrations.filter(r => r.admission === "pending")).toHaveLength(43);
    expect(model.views.filter(v => v.waitlistPosition)).toEqual([]);
    expect(await queryable(db).query("select id from outbox where kind='email:M-09'")).toHaveLength(0);
    expect(await queryable(db).query("select count(*)::int n from outbox where kind='verify_invite'")).toEqual([{ n: 0 }]);
    expect(fake.calls).toHaveLength(0);
  });
  it("over capacity requires owner/admin, is flagged and audited, and disabled actors cannot mutate", async () => {
    const e = await event(1), a = await apply(await guest(), e.id), b = await apply(await guest(), e.id);
    await admissions.transition(owner, a.id, "approved");
    await expect(admissions.decide(staff, b.id, "approved", { overCapacity: true })).rejects.toThrow("Forbidden");
    expect((await admissions.decide(owner, b.id, "approved", { overCapacity: true })).overCapacity).toBe(true);
    expect(await queryable(db).query("select action from audit where action='admission.over_capacity' and target=$1", [b.id])).toHaveLength(1);
    await queryable(db).query("update staff set disabled_at=clock_timestamp() where email=$1", [owner.email]);
    await expect(admissions.transition(owner, a.id, "revoked", "Reason")).rejects.toThrow("Forbidden");
    expect((await eventReadModel(e.id, db))!.approvedCount).toBe(2);
  });
  it("sequential waitlisting and rejected-row undo restore the original queue order", async () => {
    const e = await event(), rows = [];
    for (let i = 0; i < 5; i++) { const r = await apply(await guest(), e.id); rows.push(await admissions.transition(owner, r.id, "waitlisted")); }
    await admissions.decide(owner, rows[1]!.id, "rejected", { reason: "At capacity" });
    expect((await eventReadModel(e.id, db))!.views.filter(v => v.waitlistPosition).map(v => v.waitlistPosition)).toEqual([1, 2, 3, 4]);
    expect(await admissions.undoReject(owner, rows[1]!.id)).toBe(true);
    const restored = (await eventReadModel(e.id, db))!.views.filter(v => v.waitlistPosition);
    expect(restored.map(v => v.registration.id)).toEqual(rows.map(r => r.id));
    expect(restored.map(v => v.waitlistPosition)).toEqual([1, 2, 3, 4, 5]);
    expect(await queryable(db).query("select provider_id from outbox where kind='email:M-10'")).toEqual([{ provider_id: "cancelled:undo" }]);
  });
  it("invites without skip approval preserve requests, create invite records only, store M-19 messages", async () => {
    const e = await event(), g = await guest("existing@example.test"), r = await apply(g, e.id);
    expect(await invites.batch(owner, e.id, ["existing@example.test", "new@example.test", "new@example.test", "bad"], { skipApproval: false, message: "Please join us" })).toEqual({ invited: 1, alreadyRequested: 1, waitlisted: 0, approvedExisting: 0, skippedInvalid: 1 });
    expect((await eventReadModel(e.id, db))!.registrations).toHaveLength(1);
    expect((await eventReadModel(e.id, db))!.registrations[0]).toMatchObject({ id: r.id, admission: "pending" });
    expect(await queryable(db).query("select email,message,skip_approval from invites")).toEqual([{ email: "new@example.test", message: "Please join us", skip_approval: false }]);
    expect(await queryable(db).query("select payload->'data'->>'message' message from outbox where kind='email:M-19'")).toEqual([{ message: "Please join us" }]);
    await expect(invites.batch(owner, e.id, ["long@example.test"], { skipApproval: false, message: "x".repeat(501) })).rejects.toThrow("MessageTooLong");
  });
  it("skip-approval invites reserve no seat until a baseline-complete request is submitted",async()=>{
    const e=await event(1),q=queryable(db);
    expect(await invites.batch(owner,e.id,["a@example.test","b@example.test"],{skipApproval:true})).toMatchObject({invited:2,waitlisted:0});
    expect((await eventReadModel(e.id,db))!.registrations).toHaveLength(0);
    const messages=await q.query<{to:string;token:string}>("select payload->>'to' as to,substring(payload->'data'->>'acceptUrl' from 4) token from outbox where kind='email:M-19' order by payload->>'to'");
    const first=await guest(messages[0]!.to),approved=await redeem(first,messages[0]!.token);
    expect(approved.admission).toBe("approved");await redeem(first,messages[0]!.token);
    expect((await redeem(await guest(messages[1]!.to),messages[1]!.token)).admission).toBe("waitlisted");
    expect(await q.query("select uses from invites order by email")).toEqual([{uses:1},{uses:1}]);
    expect(await q.query("select id from outbox where kind='verify_invite'")).toHaveLength(0);
    expect(await q.query("select id from outbox where kind='email:M-06'")).toHaveLength(1);
  });
  it("accepting a review-required invite preserves pending admission and sends one request receipt", async () => {
    const e = await event(1, "invite_only"), g = await guest(), q = queryable(db);
    const email = (await q.query<{ email: string }>("select email from accounts where id=$1", [g.accountId]))[0]!.email;
    const link = await invites.create(owner, { eventId: e.id, email, maxUses: 1, expiresAt: e.startsAt, skipApproval: false });
    const first=await invites.redeem(g,link.token,await input(g,e.id));
    const second=await invites.redeem(g,link.token,await input(g,e.id));
    expect(second.id).toBe(first.id);
    expect(await q.query("select uses from invites where id=$1",[link.invite.id])).toEqual([{uses:1}]);
    expect(await q.query("select registration_id from invite_redemptions where invite_id=$1",[link.invite.id])).toEqual([{registration_id:first.id}]);
    expect((await eventReadModel(e.id, db))!.registrations[0]!.admission).toBe("pending");
    expect(await q.query("select count(*)::int n from outbox where kind='email:M-02'")).toEqual([{ n: 1 }]);
    expect(await q.query("select id from outbox where kind='verify_invite'")).toHaveLength(0);
    expect(await q.query("select \"to\" from admission_history")).toEqual([{ to: "pending" }]);
    expect(await q.query("select payload->'data'->>'skipApproval' skip_approval from outbox where kind='email:M-19'")).toEqual([{ skip_approval: "false" }]);
  });
  it("share-link redemption is atomic, limited and idempotent per account", async () => {
    const e = await event(50, "invite_only"), link = await invites.create(owner, { eventId: e.id, maxUses: 3, expiresAt: e.startsAt });
    const guests = []; for (let i = 0; i < 20; i++) guests.push(await guest());
    const results = await Promise.allSettled(guests.map(g => redeem(g, link.token)));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(3);
    expect(await queryable(db).query("select uses from invites where id=$1", [link.invite.id])).toEqual([{ uses: 3 }]);
    expect(await queryable(db).query("select count(*)::int n from invite_redemptions")).toEqual([{ n: 3 }]);
    expect((await eventReadModel(e.id, db))!.registrations).toHaveLength(3);
    const index = results.findIndex(r => r.status === "fulfilled"); await redeem(guests[index]!, link.token);
    expect(await queryable(db).query("select uses from invites where id=$1", [link.invite.id])).toEqual([{ uses: 3 }]);
  });
  it("direct invite is email bound and revoked/expired links cannot consume uses", async () => {
    const e = await event(), right = await guest("bound@example.test"), wrong = await guest();
    const link = await invites.create(owner, { eventId: e.id, email: " BOUND@example.test ", maxUses: 1, expiresAt: e.startsAt });
    await expect(redeem(wrong, link.token)).rejects.toThrow("invite_invalid");
    await invites.revoke(owner, link.invite.id);
    await expect(redeem(right, link.token)).rejects.toThrow("invite_invalid");
    expect(await queryable(db).query("select uses from invites")).toEqual([{ uses: 0 }]);
    expect((await eventReadModel(e.id, db))!.registrations).toHaveLength(0);
  });
  it("late cancellation stores reason/history, forbids after start, and allows only one reapplication", async () => {
    const e = await event(4, "open", 12), g = await guest(), r = await apply(g, e.id);
    const cancelled = await admissions.transition(g, r.id, "cancelled_by_guest", "Travel changed");
    expect(cancelled).toMatchObject({ lateCancellation: true, reason: "Travel changed" });
    await apply(g, e.id); await admissions.transition(g, r.id, "cancelled_by_guest", "Again");
    await expect(apply(g, e.id)).rejects.toThrow("context_changed");
    const g2 = await guest(), r2 = await apply(g2, e.id);
    await queryable(db).query("update events set starts_at=clock_timestamp()-interval '1 second' where id=$1", [e.id]);
    await expect(admissions.transition(g2, r2.id, "cancelled_by_guest", "Too late")).rejects.toThrow("CancellationClosed");
    expect((await eventReadModel(e.id, db))!.views.find(v => v.registration.id === r2.id)?.registration.admission).toBe("approved");
    expect(await queryable(db).query("select count(*)::int n from outbox where kind='email:M-20'")).toEqual([{ n: 2 }]);
  });
  it("returning verified requests require review; staff approval reuses evidence without verification", async () => {
    const e = await event(), g = await guest(); await verify(g);
    const r = await apply(g, e.id); expect(r.admission).toBe("pending");
    expect((await eventReadModel(e.id, db))!.views[0]).toMatchObject({ eligible: true, status: { status: "pending" } });
    expect(await queryable(db).query("select kind from outbox order by kind")).toEqual([{ kind: "email:M-02" }, { kind: "email:M-25" }]); // M-25: the hosts hear about the request
    await admissions.transition(owner, r.id, "approved");
    expect(await queryable(db).query("select id from outbox where kind='verify_invite'")).toHaveLength(0);
    expect((await eventReadModel(e.id, db))!.views[0]?.status.status).toMatch(/verified|reused/);
    expect(await queryable(db).query("select count(*)::int n from outbox where kind='email:M-06'")).toEqual([{ n: 1 }]);
    await update(e.id, { checks: {version:1,required:[],max_age:{},age_min:18} });
    const v = (await eventReadModel(e.id, db))!.views[0]!; expect(v.registration.admission).toBe("approved"); expect(v.eligible).toBe(true); // Existing requests retain the accepted policy.
  });
  it("B4 request and reused approval messages dispatch once through B5, without a Didit call", async () => {
    const e = await event(), g = await guest(), resend = await startFakeResend(), registry = new OutboxRegistry();
    try {
      registerEmailHandlers(registry, { db, baseUrl: "https://events.test", resend: { apiKey: "local-fixture", apiUrl: resend.url } });
      await verify(g);
      const r = await apply(g, e.id);
      await admissions.transition(owner, r.id, "approved");
      await admissions.transition(owner, r.id, "approved");
      await dispatchOutbox(db, registry); await dispatchOutbox(db, registry); await dispatchOutbox(db, registry);
      // The host notice (M-25) is not sent for a request already decided by the time the worker reaches it.
      expect(await queryable(db).query("select kind,status from outbox order by kind")).toEqual([{ kind: "email:M-02", status: "sent" }, { kind: "email:M-06", status: "sent" }, { kind: "email:M-25", status: "failed" }]);
      expect(resend.calls).toHaveLength(2);
      expect(resend.calls.map(c => c.body.subject)).toEqual(expect.arrayContaining([expect.stringContaining("You're in"), expect.stringContaining("We got your request")]));
      expect(new Set(resend.calls.map(c => c.headers["idempotency-key"])).size).toBe(2);
      expect(fake.calls).toHaveLength(0);
    } finally { await resend.close(); }
  });
  it("merged invitation, waitlist, rejection and cancellation mail renders and reaches B5 once", async () => {
    const e = await event(1), a = await guest(), b = await guest(), resend = await startFakeResend(), registry = new OutboxRegistry(), q = queryable(db);
    try {
      registerEmailHandlers(registry, { db, baseUrl: "https://events.test", resend: { apiKey: "local-fixture", apiUrl: resend.url } });
      await verify(a); await verify(b);
      const holder = await apply(a, e.id); await admissions.transition(owner, holder.id, "approved");
      const waiting = await apply(b, e.id); await admissions.transition(owner, waiting.id, "rejected", "Capacity");
      await admissions.transition(a, holder.id, "cancelled_by_guest", "Travel");
      await invites.create(owner, { eventId: e.id, email: "invited@example.test", maxUses: 1, expiresAt: e.startsAt, message: "Join us", skipApproval: false });
      await events.cancel(owner, e.id, "Venue closed");
      await q.query("update outbox set next_attempt_at=clock_timestamp()");
      const expected = (await q.query("select id from outbox")).length;
      for (let i = 0; i <= expected; i++) await dispatchOutbox(db, registry);
      // v2 rechecks queued confirmations: the cancelled place's stale M-06 must not be delivered.
      // Host notices (M-25) for the two requests are suppressed too: both were decided before the worker ran.
      expect(await q.query("select kind,error from outbox where status <> 'sent' order by kind")).toEqual([{kind:"email:M-06",error:"suppressed_registration"},{kind:"email:M-25",error:"suppressed_registration"},{kind:"email:M-25",error:"suppressed_registration"}]);
      expect(resend.calls).toHaveLength(expected-3);
      expect(new Set(resend.calls.map(c => c.headers["idempotency-key"])).size).toBe(expected-3);
      expect(await q.query("select distinct kind from outbox order by kind")).toEqual(["M-02", "M-06", "M-09", "M-10", "M-19", "M-20", "M-21", "M-25"].map(code => ({ kind: `email:${code}` })));
      expect(resend.calls.some(c => String(c.body.html).includes("Join us"))).toBe(true);
      expect(resend.calls.some(c => String(c.body.html).includes("hosts will review"))).toBe(true);
      expect(fake.calls).toHaveLength(0);
    } finally { await resend.close(); }
  });
  it("FIFO promotion skips missing evidence, obeys two-hour window and handles a cancellation race", async () => {
    const e = await event(1, "open"), holder = await guest(), occupied = await apply(holder, e.id), guests = [await guest(), await guest(), await guest()];
    const queue = []; for (const g of guests) queue.push(await apply(g, e.id));
    await queryable(db).query("update evidence set invalidated_at=clock_timestamp(),provider_status='withdrawn' where account_id=$1",[guests[0]!.accountId]);
    await admissions.transition(holder, occupied.id, "cancelled_by_guest", "Cannot attend");
    await Promise.all([admissions.promoteWaitlist(e.id), admissions.transition(guests[1]!, queue[1]!.id, "cancelled_by_guest", "Cannot attend")]);
    await admissions.promoteWaitlist(e.id);
    const m = (await eventReadModel(e.id, db))!; expect(m.approvedCount).toBe(1); expect(m.views.find(v => v.account.id === guests[2]!.accountId)!.registration.admission).toBe("approved");
    await admissions.transition(guests[2]!, queue[2]!.id, "cancelled_by_guest", "Cannot attend");
    await verify(guests[0]!); await queryable(db).query("update events set starts_at=clock_timestamp()+interval '2 hours' where id=$1", [e.id]);
    expect(await admissions.promoteWaitlist(e.id)).toBeNull();
    expect((await eventReadModel(e.id, db))!.approvedCount).toBe(0);
  });
  it("event CRUD validates requirements, threshold and dates; cancellation completes all registrations", async () => {
    const e = await event(), r = await apply(await guest(), e.id);
    await expect(update(e.id, { matchThreshold: 59 })).rejects.toThrow();
    await expect(update(e.id, { requirements: { identity: true, email: false, liveness: true } })).rejects.toThrow("Use checks, door, form and emails");
    await events.cancel(owner, e.id, "Venue unavailable");
    expect((await events.get(e.id))!.status).toBe("cancelled");
    expect((await eventReadModel(e.id, db))!.registrations[0]).toMatchObject({ id: r.id, admission: "cancelled_by_host" });
    expect(await queryable(db).query("select count(*)::int n from outbox where kind='email:M-21'")).toEqual([{ n: 1 }]);
    await events.cancel(owner, e.id, "Venue unavailable"); expect(await queryable(db).query("select count(*)::int n from outbox where kind='email:M-21'")).toEqual([{ n: 1 }]);
  });
  it("event edits preserve over-capacity approvals and keep age inputs consistent", async () => {
    const e = await event(1), a = await apply(await guest(), e.id), b = await apply(await guest(), e.id);
    await admissions.transition(owner, a.id, "approved");
    await admissions.decide(owner, b.id, "approved", { overCapacity: true });
    await update(e.id, { name: "Updated name", door:{kiosk:true,mode:"strict",match_threshold:99}, checks:{version:1,required:[],max_age:{},age_min:21} });
    expect(await events.get(e.id)).toMatchObject({ name: "Updated name", capacity:1,door:{kiosk:true,mode:"strict",match_threshold:99},checks:{age_min:21} });
    await update(e.id, {checks:{version:1,required:[],max_age:{}}});
    const updated = (await events.get(e.id))!;
    expect(updated.checks.age_min).toBeUndefined();
    expect((await eventReadModel(e.id, db))!.approvedCount).toBe(2);
    await update(e.id, { capacity: 3 });
    await expect(update(e.id, { capacity: 1 })).rejects.toThrow("CapacityBelowApproved");
  });
  it("event cancellation notifies unregistered invitees once and revokes their links", async () => {
    const e = await event(), q = queryable(db);
    for (let i = 0; i < 2; i++) await invites.create(owner, { eventId: e.id, email: "not-yet-registered@example.test", expiresAt: e.startsAt, maxUses: 1, skipApproval: false });
    await events.cancel(owner, e.id, "Venue closed");
    await events.cancel(owner, e.id, "Venue closed");
    expect(await q.query("select count(*)::int n from registrations")).toEqual([{ n: 0 }]);
    expect(await q.query("select payload->>'to' email from outbox where kind='email:M-21'")).toEqual([{ email: "not-yet-registered@example.test" }]);
    expect(await q.query("select id from invites where revoked_at is null")).toHaveLength(0);
    expect(fake.calls).toHaveLength(0);
  });
  it("past live events derive ended, while unpublished drafts remain drafts", async () => {
    const e = await event(), q = queryable(db);
    await q.query("update events set starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-interval '1 hour' where id=$1", [e.id]);
    expect((await events.get(e.id))!.status).toBe("ended");
    await expect(events.cancel(owner, e.id, "Too late")).rejects.toThrow("EventClosed");
    await q.query("update events set status='draft' where id=$1", [e.id]);
    expect((await events.get(e.id))!.status).toBe("draft");
  });
  it("the scheduler persists start/end transitions while reads already use the current time", async () => {
    const e = await event(), q = queryable(db);
    await q.query("update events set starts_at=clock_timestamp()-interval '1 hour' where id=$1", [e.id]);
    expect((await events.get(e.id))!.status).toBe("live");
    await dispatchAdmissionJobs(db, jobs);
    expect(await q.query("select status from events where id=$1", [e.id])).toEqual([{ status: "live" }]);
    await q.query("update events set ends_at=clock_timestamp()-interval '1 second' where id=$1", [e.id]);
    await q.query("update jobs set next_run_at=clock_timestamp() where name='events:end'");
    await dispatchAdmissionJobs(db, jobs);
    expect(await q.query("select status from events where id=$1", [e.id])).toEqual([{ status: "ended" }]);
  });

  it("promotion passes 50 ineligible candidates and the durable worker completes cancellation after staff disablement", async () => {
    const e = await event(1,"open"), q = queryable(db);
    for (let i = 0; i < 51; i++) {
      const g = await guest(), r = await apply(g, e.id);
      await queryable(db).query("update registrations set admission='waitlisted' where id=$1",[r.id]);
      if (i < 50) await q.query("update evidence set invalidated_at=clock_timestamp(),provider_status='withdrawn' where account_id=$1",[g.accountId]);
    }
    expect((await admissions.promoteWaitlist(e.id))?.admission).toBe("approved");
    expect((await eventReadModel(e.id, db))!.views.filter(v => v.waitlistPosition).map(v => v.waitlistPosition)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    await q.query("update events set status='cancelled' where id=$1", [e.id]);
    await q.query("update staff set disabled_at=clock_timestamp() where email=$1", [owner.email]);
    await q.query("insert into jobs (name,interval_sec,payload) values ($1,15,$2::jsonb)", ["cancel-event:" + e.id, JSON.stringify({ eventId: e.id, actor: owner, reason: "Venue closed" })]);
    await dispatchAdmissionJobs(db, jobs);
    expect((await eventReadModel(e.id, db))!.registrations.every(r => r.admission === "cancelled_by_host")).toBe(true);
    expect(await q.query("select count(*)::int n from outbox where kind='email:M-21'")).toEqual([{ n: 51 }]);
  });
  it("waitlist needs actual capacity and the accepted request mode requires staff promotion",async()=>{
    const e=await event(1),q=queryable(db),g=await guest();
    await expect(apply(g,e.id,{},true)).rejects.toThrow("context_changed");
    const holder=await guest(),occupied=await apply(holder,e.id);await admissions.transition(owner,occupied.id,"approved");
    const r=await apply(g,e.id,{},true);expect(r.admission).toBe("waitlisted");
    await admissions.transition(holder,occupied.id,"cancelled_by_guest","Cannot attend");
    expect(await admissions.promoteWaitlist(e.id)).toBeNull();await dispatchAdmissionJobs(db,jobs);
    expect((await eventReadModel(e.id,db))!.registrations.find(x=>x.id===r.id)!.admission).toBe("waitlisted");
    await admissions.transition(owner,r.id,"approved");
    expect(await q.query("select kind from outbox where payload->'data'->>'registrationId'=$1 order by kind",[r.id])).toEqual([{kind:"email:M-06"},{kind:"email:M-09"},{kind:"email:M-25"}]);
  });
  it.each([[25, false], [24, false], [23, true]] as const)("cancellation at %i hours persists late=%s", async (hours, late) => {
    // Leave 10 seconds above 24h for transaction time; exact equality is covered by the pure predicate.
    try {
      const e = await event(1, "open", hours===24?24+10/3600:hours), g = await guest(), r = await apply(g, e.id), q = queryable(db);
      await admissions.transition(g, r.id, "cancelled_by_guest", "Travel changed");
      expect(await q.query("select admission,late_cancellation,reason from registrations where id=$1", [r.id])).toEqual([{ admission: "cancelled_by_guest", late_cancellation: late, reason: "Travel changed" }]);
      expect(await q.query("select data->>'lateCancellation' late from audit where action='admission.cancelled_by_guest'")).toEqual([{ late: String(late) }]);
      expect(await q.query("select kind from outbox where kind='email:M-20'")).toEqual([{ kind: "email:M-20" }]);
      expect(fake.calls).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });
  it("revoked guests cannot fall through approval into waitlisted, and owner override is audited", async () => {
    const e = await event(1), a = await apply(await guest(), e.id), b = await apply(await guest(), e.id), q = queryable(db);
    await admissions.transition(owner, a.id, "approved");
    await admissions.transition(owner, a.id, "revoked", "Removed");
    await admissions.transition(owner, b.id, "approved");
    const outbox = await q.query("select id from outbox order by id"), history = await q.query("select id from admission_history order by id");
    await expect(admissions.transition(owner, a.id, "approved")).rejects.toThrow("Capacity");
    await expect(admissions.decide(owner, a.id, "approved", { waitlistAtCapacity: true })).rejects.toThrow("InvalidTransition");
    await expect(admissions.decide(owner, a.id, "waitlisted")).rejects.toThrow("InvalidTransition");
    await expect(admissions.transition(staff, a.id, "approved", undefined, { overCapacity: true })).rejects.toThrow("Forbidden");
    expect(await q.query("select admission from registrations where id=$1", [a.id])).toEqual([{ admission: "revoked" }]);
    expect(await q.query("select id from outbox order by id")).toEqual(outbox);
    expect(await q.query("select id from admission_history order by id")).toEqual(history);
    await admissions.transition(owner, a.id, "approved", undefined, { overCapacity: true });
    expect(await q.query("select admission,over_capacity from registrations where id=$1", [a.id])).toEqual([{ admission: "approved", over_capacity: true }]);
    expect(await q.query("select target from audit where action='admission.over_capacity'")).toEqual([{ target: a.id }]);
    expect(fake.calls).toHaveLength(0);
  });



  it("v2 display state follows admission, accepted proof freshness and attendance independently",async()=>{
    const e=await event(1),g=await guest(),r=await apply(g,e.id),q=queryable(db);
    const view=async()=>(await eventReadModel(e.id,db))!.views.find(x=>x.registration.id===r.id)!;
    expect((await view()).status.status).toBe("pending");await admissions.transition(owner,r.id,"approved");
    expect((await view()).eligible).toBe(true);
    await q.query("update evidence set established_at=clock_timestamp()-interval '2 days',valid_until=clock_timestamp()-interval '1 second' where account_id=$1",[g.accountId]);
    expect((await view()).registration.admission).toBe("approved");expect((await view()).eligible).toBe(false);
    await verify(g);expect((await view()).eligible).toBe(true);
    await q.query("insert into checkins(event_id,registration_id,method,by_staff) values($1,$2,'manual',$3)",[e.id,r.id,owner.email]);
    expect((await view()).status.status).toBe("checked_in");
    await admissions.transition(owner,r.id,"revoked","No longer invited");expect((await view()).status.status).toBe("revoked");
  });

  if (kind === "postgres") {
    it("C26 full snapshots include late commits and remove deleted rows", async () => {
      const e = await event(), g = await guest(), r = await apply(g, e.id), started = deferred(), release = deferred();
      const [kiosk] = await queryable(db).query<{ id: string }>("insert into kiosks (event_id,name) values ($1,'Snapshot door') returning id", [e.id]);
      const delayed = withTx(async tx => {
        await tx.query("insert into audit (event_id,actor,action,target) values ($1::uuid,'system','delayed',$1::text)", [e.id]);
        await tx.query("insert into scans (event_id,kiosk_id,result,latency_ms) values ($1,$2,'unknown',25)", [e.id, kiosk!.id]);
        started.resolve(); await release.promise;
      }, db);
      try {
        await Promise.race([started.promise, delayed]);
        await queryable(db).query("insert into audit (event_id,actor,action,target) values ($1::uuid,'system','early',$1::text)", [e.id]);
        expect((await events.liveSnapshot(owner, e.id)).audit.some(a => a.action === "delayed")).toBe(false);
        expect((await events.liveSnapshot(owner, e.id)).scans).toHaveLength(0);
      } finally { release.resolve(); await delayed; }
      expect((await events.liveSnapshot(owner, e.id)).audit.filter(a => ["early", "delayed"].includes(a.action))).toHaveLength(2);
      expect((await events.liveSnapshot(owner, e.id)).scans).toHaveLength(1);
      expect((await events.liveSnapshot(owner, e.id)).counts).toMatchObject({ pending: 1, approved: 0 });
      await withTx(async tx => { await lockForDeletion(tx, g.accountId); await tx.query("delete from registrations where id=$1", [r.id]); }, db);
      expect((await events.liveSnapshot(owner, e.id)).registrations).toEqual([]);
      expect((await events.liveSnapshot(owner, e.id)).statuses).toEqual([]);
      expect((await events.liveSnapshot(owner, e.id)).counts.pending).toBe(0);
    });
    it("account deletion linearizes before approval", async () => {
      const e = await event(), g = await guest(), r = await apply(g, e.id), locked = deferred(), release = deferred();
      const deletion = withTx(async tx => { await lockAccount(tx, g.accountId); locked.resolve(); await release.promise; await tx.query("update accounts set deleting_at=clock_timestamp() where id=$1", [g.accountId]); }, db);
      await locked.promise; const approval = admissions.transition(owner, r.id, "approved"); release.resolve(); await deletion;
      await expect(approval).rejects.toThrow("AccountUnavailable"); expect((await events.liveSnapshot(owner, e.id)).registrations[0]!.admission).toBe("pending");
    });
  }
});
describe("B4 CSV", () => {
  it.each(["=SUM(A1)", "+cmd", "-1+2", "@SUM(1)", "  =1", "\tcmd", "\rtext", "\ntext"])("escapes %s", value => expect(csvCell(value).startsWith('"\'')).toBe(true));
  it("parses quoted commas, newlines and deduplicates; invalid rows fail before any import", () => {
    expect(parseCsv('first,last,email\r\n"Ana, A",Soler,a@example.test\r\nOther,,A@example.test\r\n')).toEqual([{ first: "Ana, A", last: "Soler", email: "a@example.test" }]);
    expect(() => parseCsv("first,last,email\nAna,,invalid")).toThrow("InvalidCsvRow:2");
    expect(() => parseCsv('first,last,email\n"unclosed')).toThrow("InvalidCsv");
  });
});
