/**
 * v5 re-join, end to end against the real request service (PGlite and Postgres): withdraw → request again, cancel →
 * request the place again (approval again / open event / invitation still standing / lapsed invitation), rejected →
 * once unless blocked, the one re-request limit, cancelled by the hosts, a full event, and an account kept during its
 * deletion grace period (everything restored, then the join carries on) or deleted for good (a fresh account).
 */
import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { lockForSeatGrant,queryable,withTx } from "../db/tx.ts";
import { DiditClient } from "../didit/client.ts";
import { fakeDiditServer } from "../didit/fake-server.ts";
import type { ConsentInput,EventForm } from "../domain/event-model.ts";
import type { GuestPrincipal,StaffPrincipal } from "../domain/services.ts";
import { SEAT_TAKEN_NOTE } from "../identity/accounts.ts";
import { createIdentityServices } from "../identity/index.ts";
import { deferred,testDatabase } from "../testing/database.ts";
import { skipPostgres } from "../testing/postgres.ts";
import { createModelServices } from "../verification/model-runtime.ts";
import { applyModelDecision } from "../verification/model-verification.ts";
import { Admissions } from "./admission.ts";
import { EventEditor } from "./event-editor.ts";
import { Invites } from "./invites.ts";
import { Requests } from "./requests.ts";

const consent: ConsentInput = { disclosureVersion: "events-profile-v2", shareProfileWithHosts: true, eventConsentAccepted: true, acceptedChecks: ["face"] };
type Guest = { principal: GuestPrincipal; cookie: string; email: string };

describe.each(["pglite", ...(skipPostgres ? [] : ["postgres"])] as const)("v5 re-join and account states (%s)", (driver) => {
  let database: Awaited<ReturnType<typeof testDatabase>>, fake: Awaited<ReturnType<typeof fakeDiditServer>>;
  let identity: ReturnType<typeof createIdentityServices>, model: ReturnType<typeof createModelServices>, requests: Requests, admissions: Admissions, staff: StaffPrincipal;
  const q = () => queryable(database.db);
  /** The address the fake Google sign-in returns. */
  const google = { email: "" };

  beforeAll(async () => {
    database = await testDatabase(driver as "pglite" | "postgres"); fake = await fakeDiditServer();
    const client = new DiditClient({ apiKey: "fake", fetch: fake.fetch });
    identity = createIdentityServices({ db: database.db, didit: client, secret: "s".repeat(40), appUrl: "https://events.test",
      oidc: { authorize: async ({ state }) => `https://accounts.google.test/auth?state=${state}`, exchange: async () => ({ issuer: "https://accounts.google.com", subject: `sub-${google.email}`, email: google.email }) } });
    model = createModelServices({ db: database.db, client, appUrl: "https://events.test" });
    requests = new Requests(database.db); admissions = new Admissions(database.db);
    staff = { principal: "staff", email: "admin@didit.me", role: "admin", sessionId: randomUUID() };
    await q().query("insert into staff(email,role) values($1,'admin')", [staff.email]);
    await q().query("insert into sessions(id,token_hash,principal,auth_method,staff_email,expires_at) values($1,$2,'staff','email_otp',$3,now()+interval '1 day')", [staff.sessionId, randomUUID(), staff.email]);
  }, 60000);
  afterAll(async () => { await fake?.close(); await database?.close(); });

  /** A guest with a proven email, a complete profile and an approved face check. */
  async function guest(email: string): Promise<Guest> {
    const challenge = await identity.auth.sendOtp(email, "127.0.0.1");
    const result = await identity.auth.checkOtp(challenge.challengeId, "481903", { otpCookie: challenge.cookie, consent });
    const g = { principal: result.principal, cookie: result.cookie, email };
    const view = await model.onboarding.getOnboarding(g.principal);
    await model.onboarding.saveOnboardingProfile(g.principal, { expectedProfileVersion: view.profileVersion, fullName: `Guest ${email.split("@")[0]}`, headline: "Builder", company: "Example", jobRole: "Founder", bio: "I build.", links: [{ kind: "website", label: "Website", href: "https://example.com" }] });
    const decision = [...fake.decisions.values()].at(-1)!, at = new Date().toISOString();
    fake.decisions.set(decision.session_id, { ...decision, status: "Approved", liveness_checks: [{ status: "Approved", matches: [], warnings: [] }], events: [{ event_type: "SESSION_STATUS_CHANGED", feature_step: null, created_at: at, details: { current_status: "Approved" } }] });
    await withTx(tx => applyModelDecision(tx, g.principal.accountId, decision.session_id, model.verification.options.client), database.db);
    expect((await model.onboarding.getOnboarding(g.principal)).step).toBe("complete");
    return g;
  }

  async function event(form: Partial<EventForm> = {}, capacity = 10): Promise<string> {
    const editor = new EventEditor(database.db), start = new Date(Date.now() + 3 * 86400_000), end = new Date(start.getTime() + 3600_000);
    const draft = await editor.create(staff, { name: "Meetup", description: "Meet builders", descriptionMd: "Hello", startsAt: start.toISOString(), endsAt: end.toISOString(), timezone: "UTC", venue: "HQ", address: "One Street", placeId: null, lat: null, lng: null, mapsUrl: null, capacity,
      checks: { version: 1, required: [], max_age: {} }, door: { kiosk: false }, form: { version: 1, mode: "request", closes_at: null, waitlist: true, fields: { phone_number: "off" }, questions: [], consent_text: null, ...form }, emails: { version: 1, templates: {} }, cover: { kind: "theme", theme: "aqua" } });
    await editor.lifecycle(staff, draft.eventId, "publish", draft.editVersion);
    return draft.eventId;
  }

  /** The one tap: exactly what the modal sends from the context it was given. */
  async function tap(g: Guest, eventId: string, extra: { inviteToken?: string } = {}, key = randomUUID()) {
    const ctx = await requests.getRequestContext(g.principal, eventId);
    return requests.submitRequest(g.principal, eventId, { ...(ctx.draft ? { draftId: ctx.draft.id } : {}), expectedPolicyVersion: ctx.event.policyVersion, expectedFormVersion: ctx.event.formVersion, profileVersion: ctx.onboarding.profileVersion,
      application: { fields: {}, answers: {} }, consent, joinWaitlist: ctx.submitLabel === "Join waitlist", idempotencyKey: key, ...extra });
  }
  const context = (g: Guest, eventId: string) => requests.getRequestContext(g.principal, eventId);
  const history = async (id: string) => (await q().query<{ from: string | null; to: string }>('select "from","to" from admission_history where registration_id=$1 order by created_at,id', [id])).map(h => `${h.from ?? "∅"}→${h.to}`);

  it.each(["", " \t\n\u00a0\u3000\ufeff"])("a stored blank consent text (%j, saved over MCP before v1.3.2) asks for nothing and never blocks the request", async (blank) => {
    const g = await guest(`blank-consent-${blank.length}@example.test`), eventId = await event();
    await q().query("update events set form=jsonb_set(form,'{consent_text}',to_jsonb($2::text)) where id=$1", [eventId, blank]);
    // Policy rows are immutable: the fixture recreates the legacy row with the guard off, for this write only.
    await q().query("alter table event_policies disable trigger user");
    try { await q().query("update event_policies set form=jsonb_set(form,'{consent_text}',to_jsonb($2::text)) where event_id=$1", [eventId, blank]); }
    finally { await q().query("alter table event_policies enable trigger user"); }
    const ctx = await context(g, eventId);
    const res = await requests.submitRequest(g.principal, eventId, { expectedPolicyVersion: ctx.event.policyVersion, expectedFormVersion: ctx.event.formVersion, profileVersion: ctx.onboarding.profileVersion,
      application: { fields: {}, answers: {} }, consent: { ...consent, eventConsentAccepted: false }, joinWaitlist: false, idempotencyKey: randomUUID() });
    expect(ctx.event.form.consent_text).toBeNull();
    expect(res.registration.admission).toBe("pending");
  });

  it("withdraw → request again: one tap, count 1, a fresh host notice, idempotent; then status only (once)", async () => {
    const g = await guest("withdraw@example.test"), eventId = await event();
    const first = await tap(g, eventId);
    expect(first.registration.admission).toBe("pending");
    await requests.withdrawOrCancel(g.principal, first.registration.id, { expectedAdmission: "pending" });
    const ctx = await context(g, eventId);
    expect(ctx.nextAction).toBe("submit");
    expect(ctx.onboarding.step).toBe("complete");
    expect(ctx.registration!.rejoin).toMatchObject({ kind: "withdrew", canRequest: true, outcome: "pending", blockedBy: null });
    const key = randomUUID(), again = await tap(g, eventId, {}, key);
    expect(again.registration.admission).toBe("pending");
    expect((await tap(g, eventId, {}, key)).replayed).toBe(true);
    expect(await q().query("select reapplication_count from registrations where id=$1", [first.registration.id])).toEqual([{ reapplication_count: 1 }]);
    expect(await history(first.registration.id)).toEqual(["∅→pending", "pending→cancelled_by_guest", "cancelled_by_guest→pending"]);
    expect(await q().query("select id from outbox where kind='email:M-02' and payload->'data'->>'registrationId'=$1", [first.registration.id])).toHaveLength(2);
    await requests.withdrawOrCancel(g.principal, first.registration.id, { expectedAdmission: "pending" });
    const done = await context(g, eventId);
    expect(done.nextAction).toBe("status");
    expect(done.registration!.rejoin).toMatchObject({ kind: "withdrew", canRequest: false, blockedBy: "once" });
    await expect(tap(g, eventId)).rejects.toThrow("context_changed");
  });

  it("cancel an approved place → request it again: approval again on a request event, straight back on an open one", async () => {
    const g = await guest("cancel@example.test"), eventId = await event();
    const first = await tap(g, eventId);
    await admissions.decide(staff, first.registration.id, "approved");
    await requests.withdrawOrCancel(g.principal, first.registration.id, { expectedAdmission: "approved" });
    const ctx = await context(g, eventId);
    expect(ctx.registration!.rejoin).toMatchObject({ kind: "cancelled", canRequest: true, outcome: "pending" });
    expect(ctx.registration!.rejoin.rule).toMatch(/hosts approve/);
    expect((await tap(g, eventId)).registration.admission).toBe("pending");

    const open = await event({ mode: "open" }), o = await tap(g, open);
    expect(o.registration.admission).toBe("approved");
    await requests.withdrawOrCancel(g.principal, o.registration.id, { expectedAdmission: "approved" });
    expect((await context(g, open)).registration!.rejoin).toMatchObject({ kind: "cancelled", outcome: "approved" });
    expect((await tap(g, open)).registration.admission).toBe("approved");
  });

  it("invited guest who cancelled → rejoin restores the place while the invitation stands; a revoked one is a normal request", async () => {
    const g = await guest("invited@example.test"), h = await guest("lapsed@example.test"), eventId = await event({ mode: "invite_only" });
    const invites = new Invites(database.db);
    const inv = await invites.create(staff, { eventId, email: g.email, maxUses: 1, expiresAt: new Date(Date.now() + 3 * 86400_000), skipApproval: true });
    const accepted = await tap(g, eventId, { inviteToken: inv.token });
    expect(accepted.registration.admission).toBe("approved");
    await requests.withdrawOrCancel(g.principal, accepted.registration.id, { expectedAdmission: "approved" });
    const ctx = await context(g, eventId);
    expect(ctx.availability).toBe("open");
    expect(ctx.registration!.rejoin).toMatchObject({ kind: "invited", canRequest: true, outcome: "approved" });
    expect((await tap(g, eventId)).registration.admission).toBe("approved");
    expect(await q().query("select uses from invites where id=$1", [inv.invite.id])).toEqual([{ uses: 1 }]);
    expect(await q().query("select id from invite_redemptions where invite_id=$1", [inv.invite.id])).toHaveLength(1);

    // Revoked invitation on an invite-only event: no self-rejoin, the screen says why.
    const inv2 = await invites.create(staff, { eventId, email: h.email, maxUses: 1, expiresAt: new Date(Date.now() + 3 * 86400_000), skipApproval: true });
    const r2 = await tap(h, eventId, { inviteToken: inv2.token });
    await requests.withdrawOrCancel(h.principal, r2.registration.id, { expectedAdmission: "approved" });
    await invites.revoke(staff, inv2.invite.id);
    const lapsed = await context(h, eventId);
    expect(lapsed.registration!.rejoin).toMatchObject({ kind: "cancelled", canRequest: false, blockedBy: "invite_required" });
    expect(lapsed.nextAction).toBe("status");

    // Revoked invitation on a request event: a normal request that the hosts approve.
    const requestEvent = await event();
    const inv3 = await invites.create(staff, { eventId: requestEvent, email: h.email, maxUses: 1, expiresAt: new Date(Date.now() + 3 * 86400_000), skipApproval: true });
    const r3 = await tap(h, requestEvent, { inviteToken: inv3.token });
    await requests.withdrawOrCancel(h.principal, r3.registration.id, { expectedAdmission: "approved" });
    await invites.revoke(staff, inv3.invite.id);
    expect((await context(h, requestEvent)).registration!.rejoin).toMatchObject({ kind: "cancelled", canRequest: true, outcome: "pending" });
    expect((await tap(h, requestEvent)).registration.admission).toBe("pending");
  });

  it("rejected → one more request unless the hosts blocked it", async () => {
    const g = await guest("rejected@example.test"), b = await guest("blocked@example.test"), eventId = await event();
    const r = await tap(g, eventId);
    await admissions.decide(staff, r.registration.id, "rejected", { reason: "Full room", rejectEmail: false });
    expect((await context(g, eventId)).registration!.rejoin).toMatchObject({ kind: "rejected", canRequest: true, outcome: "pending" });
    expect((await tap(g, eventId)).registration.admission).toBe("pending");
    expect(await history(r.registration.id)).toEqual(["∅→pending", "pending→rejected", "rejected→pending"]);
    await admissions.decide(staff, r.registration.id, "rejected", { reason: "Still full", rejectEmail: false });
    expect((await context(g, eventId)).registration!.rejoin).toMatchObject({ kind: "rejected", canRequest: false, blockedBy: "once" });

    const rb = await tap(b, eventId);
    await admissions.decide(staff, rb.registration.id, "rejected", { reason: "Spam", rejectEmail: false, block: true });
    const blocked = await context(b, eventId);
    expect(blocked.nextAction).toBe("status");
    expect(blocked.registration!.rejoin).toMatchObject({ kind: "rejected", canRequest: false, blockedBy: "blocked" });
    await expect(tap(b, eventId)).rejects.toThrow("context_changed");
  });

  it("cancelled or revoked by the hosts, waitlisted, approved: status only, never a request button", async () => {
    const g = await guest("host@example.test"), w = await guest("wait@example.test"), eventId = await event({}, 1);
    const r = await tap(g, eventId);
    await admissions.decide(staff, r.registration.id, "approved");
    expect((await context(g, eventId)).registration!.rejoin).toMatchObject({ kind: "approved", canRequest: false });
    const rw = await tap(w, eventId);
    expect(rw.registration.admission).toBe("waitlisted");
    expect((await context(w, eventId)).registration!.rejoin).toMatchObject({ kind: "waitlisted", canRequest: false });
    expect((await context(w, eventId)).registration!.withdrawal.allowed).toBe(true);
    await admissions.decide(staff, r.registration.id, "cancelled_by_host", { reason: "Venue change" });
    const hostCtx = await context(g, eventId);
    expect(hostCtx.nextAction).toBe("status");
    expect(hostCtx.registration!.rejoin).toMatchObject({ kind: "cancelled_by_host", canRequest: false });
    await expect(tap(g, eventId)).rejects.toThrow("context_changed");
  });

  it("a full event without a waitlist: the cancelled guest is told it is full (no dead button)", async () => {
    const g = await guest("full1@example.test"), other = await guest("full2@example.test"), eventId = await event({ mode: "open", waitlist: false }, 1);
    const r = await tap(g, eventId);
    await requests.withdrawOrCancel(g.principal, r.registration.id, { expectedAdmission: "approved" });
    expect((await tap(other, eventId)).registration.admission).toBe("approved");
    const ctx = await context(g, eventId);
    expect(ctx.availability).toBe("full");
    expect(ctx.registration!.rejoin).toMatchObject({ kind: "cancelled", canRequest: false, blockedBy: "full" });
    expect(ctx.nextAction).toBe("status");
  });

  it("deleting → Keep my account restores the account, the face check and the place; then the join carries on", async () => {
    const g = await guest("keep@example.test"), eventId = await event(), seatless = await event({ waitlist: true }, 1), other = await guest("seat@example.test");
    const r = await tap(g, eventId);
    await admissions.decide(staff, r.registration.id, "approved");
    const r2 = await tap(g, seatless);
    await admissions.decide(staff, r2.registration.id, "approved");
    await identity.accounts.requestDeletion(g.principal, { graceMs: 7 * 86400_000 });
    await expect(context(g, eventId)).rejects.toThrow();
    expect(await identity.profile.pendingDeletion(g.cookie)).toMatchObject({ accountId: g.principal.accountId });
    expect(await identity.sessions.resolve(g.cookie)).toBeNull();
    // The seat on the 1-place event goes to someone else meanwhile.
    const taken = await tap(other, seatless);
    await admissions.decide(staff, taken.registration.id, "approved");
    // Nothing is erased remotely during the grace period (the worker only picks due deletions).
    await identity.processDeletions();
    expect(fake.count("DELETE", "/v3/session/")).toBe(0);
    await identity.profile.keepAccount(g.cookie);
    expect((await identity.sessions.resolve(g.cookie))?.accountId).toBe(g.principal.accountId);
    expect(await q().query("select id from deletions where account_id=$1", [g.principal.accountId])).toEqual([]);
    expect((await model.onboarding.getOnboarding(g.principal)).step).toBe("complete");
    const ctx = await context(g, eventId);
    expect(ctx.registration).toMatchObject({ admission: "approved" });
    expect(ctx.registration!.rejoin.kind).toBe("approved");
    // The place that went meanwhile comes back on the waitlist, not over capacity.
    expect((await context(g, seatless)).registration!.admission).toBe("waitlisted");
    // The join carries on: a new event is one tap, no onboarding again.
    const next = await event();
    expect((await context(g, next)).nextAction).toBe("submit");
    await expect(identity.profile.keepAccount(g.cookie)).rejects.toThrow("DeletionNotCancellable");
  });

  it("Keep my account never overbooks: it waits for a seat grant in flight on the event, then restores to pending with a note", async () => {
    const a = await guest("race-a@example.test"), b = await guest("race-b@example.test"), eventId = await event({ waitlist: false }, 1);
    const ra = await tap(a, eventId), rb = await tap(b, eventId);
    await admissions.decide(staff, ra.registration.id, "approved");
    await identity.accounts.requestDeletion(a.principal, { graceMs: 7 * 86400_000 });
    // The hosts approve B into the freed seat; that transaction holds the seat-grant locks while "Keep my account" runs.
    const locked = deferred(), release = deferred();
    const grant = withTx(async tx => {
      await lockForSeatGrant(tx, [b.principal.accountId], eventId);
      await tx.query("update registrations set admission='approved' where id=$1", [rb.registration.id]);
      locked.resolve();
      await release.promise;
    }, database.db);
    await locked.promise;
    const kept = identity.profile.keepAccount(a.cookie);
    setTimeout(() => release.resolve(), 300);
    await Promise.all([grant, kept]);
    const rows = await q().query<{ id: string; admission: string; reason: string | null }>("select id,admission,reason from registrations where event_id=$1", [eventId]);
    expect(rows.filter(r => r.admission === "approved").map(r => r.id)).toEqual([rb.registration.id]);
    expect(rows.find(r => r.id === ra.registration.id)).toMatchObject({ admission: "pending", reason: SEAT_TAKEN_NOTE });
  });

  it("Keep my account restores only the invitations the deletion revoked; one the hosts revoked meanwhile stays revoked", async () => {
    const g = await guest("keep-invites@example.test"), kept = await event({ mode: "invite_only" }), pulled = await event({ mode: "invite_only" });
    const invites = new Invites(database.db), expiresAt = new Date(Date.now() + 3 * 86400_000);
    const a = await invites.create(staff, { eventId: kept, email: g.email, maxUses: 1, expiresAt, skipApproval: true });
    const b = await invites.create(staff, { eventId: pulled, email: g.email, maxUses: 1, expiresAt, skipApproval: true });
    await identity.accounts.requestDeletion(g.principal, { graceMs: 7 * 86400_000 });
    await invites.revoke(staff, b.invite.id);
    await identity.profile.keepAccount(g.cookie);
    expect(await q().query("select revoked_at from invites where id=$1", [a.invite.id])).toEqual([{ revoked_at: null }]);
    const [revoked] = await q().query<{ revoked_at: Date | null; revoked_reason: string | null }>("select revoked_at,revoked_reason from invites where id=$1", [b.invite.id]);
    expect(revoked!.revoked_at).not.toBeNull();
    expect(revoked!.revoked_reason).toBe("host");
  });

  it("signed in with the other method (Google after the email code): the same account, still one tap, no duplicate", async () => {
    const g = await guest("both@example.test"), eventId = await event();
    const r = await tap(g, eventId);
    await requests.withdrawOrCancel(g.principal, r.registration.id, { expectedAdmission: "pending" });
    google.email = g.email;
    const begun = await identity.auth.beginOidc("guest", `/e/${eventId}`);
    const viaGoogle = await identity.auth.finishOidc(`https://events.test/api/auth/oidc/callback?state=${new URL(begun.url).searchParams.get("state")}&code=ok`, begun.cookie);
    const principal = viaGoogle.principal as GuestPrincipal;
    expect(principal.accountId).toBe(g.principal.accountId);
    expect(await q().query("select id from accounts where email=$1", [g.email])).toHaveLength(1);
    const ctx = await requests.getRequestContext(principal, eventId);
    expect(ctx.nextAction).toBe("submit");
    expect(ctx.registration!.rejoin).toMatchObject({ kind: "withdrew", canRequest: true });
    const again = await tap({ ...g, principal, cookie: viaGoogle.cookie }, eventId);
    expect(again.registration.id).toBe(r.registration.id);
    expect(again.registration.admission).toBe("pending");
  });

  it("deleted → signing in again creates a fresh account and the flow starts clean", async () => {
    const g = await guest("gone@example.test"), eventId = await event();
    await tap(g, eventId);
    const deletion = await identity.accounts.requestDeletion(g.principal);
    expect((await identity.accounts.finishDeletion(deletion.id)).state).toBe("complete");
    const challenge = await identity.auth.sendOtp(g.email, "127.0.0.1");
    const fresh = await identity.auth.checkOtp(challenge.challengeId, "481903", { otpCookie: challenge.cookie, consent });
    expect(fresh.isNew).toBe(true);
    expect(fresh.principal.accountId).not.toBe(g.principal.accountId);
    const ctx = await requests.getRequestContext(fresh.principal, eventId);
    expect(ctx.registration).toBeNull();
    expect(ctx.nextAction).toBe("profile");
  });
});
