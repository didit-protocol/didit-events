import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { lockForCheckin,lockForDecision,queryable,withTx } from "../db/tx.ts";
import { DiditClient } from "../didit/client.ts";
import { fakeDiditServer } from "../didit/fake-server.ts";
import signatureFixture from "../didit/fixtures/webhook.json";
import type { DiditDecision,FaceMatch } from "../didit/types.ts";
import { doorEligibility } from "../domain/door.ts";
import type { DomainEvent,Evidence,GuestPrincipal,Registration,Session,Verification } from "../domain/services.ts";
import { webhookAuth } from "../http/policy.ts";
import { dispatchInbox,InboxRegistry } from "../inbox.ts";
import { JobRegistry } from "../jobs.ts";
import { dispatchOutbox,OutboxRegistry } from "../outbox.ts";
import { reserve } from "../spend.ts";
import { deferred,resetDatabase,seed,testDatabase } from "../testing/database.ts";
import { skipPostgres } from "../testing/postgres.ts";
import { signV2 } from "../webhook/signature.ts";
import { retainVerificationData } from "./reconcile.ts";
import { hashToken,rows,type VerificationOptions } from "./shared.ts";
import { VerificationLifecycle } from "./verification-service.ts";
import { registerVerificationHandlers } from "./workers.ts";

const full = randomUUID(), renewal = randomUUID(), age = randomUUID();
const workflows = { [full]: { kind: "full" as const, maxPriceUsd: 0.23 }, [renewal]: { kind: "renewal" as const, maxPriceUsd: 0.10 }, [age]: { kind: "age" as const, maxPriceUsd: 0.33 } };
const match = (id: string, score = 95): FaceMatch => ({ session_id: id, similarity_percentage: score, is_blocklisted: false, api_service: null, status: "Approved" });
const at = (seconds: number) => new Date(Date.now() + seconds * 1000);
const day = 86400;

for (const kind of ["pglite", ...(!skipPostgres ? ["postgres"] : [])] as Array<"pglite" | "postgres">) describe(`B1 lifecycle (${kind})`, () => {
  let database: Awaited<ReturnType<typeof testDatabase>>;
  let fake: Awaited<ReturnType<typeof fakeDiditServer>>;
  let service: VerificationLifecycle, options: VerificationOptions, ids: Awaited<ReturnType<typeof seed>>;
  let inbox: InboxRegistry, outbox: OutboxRegistry;
  const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const q = () => queryable(database.db);
  const facts = () => rows<Evidence>(q(), "select * from evidence order by kind::text,id");
  const apply = (decision: DiditDecision) => withTx(tx => service.evidence.applyDecision(tx, ids.accountId, decision.session_id), database.db);
  async function guest(fresh = true): Promise<GuestPrincipal> {
    const [session] = await rows<Session>(q(), `insert into sessions(token_hash,principal,auth_method,account_id,authenticated_at,expires_at)
      values($1,'guest','email_otp',$2,$3,clock_timestamp()+interval '1 day') returning *`, [hashToken(randomUUID()), ids.accountId, at(fresh ? -30 : -901)]);
    return { principal: "guest", accountId: ids.accountId, sessionId: session!.id, authenticatedAt: session!.authenticatedAt };
  }
  // Compatibility fixtures model sessions that already had a durable local mapping before v2.
  async function bindLegacy(decision: DiditDecision) {
    await q().query(`insert into verifications(account_id,didit_session_id,workflow_id,vendor_data,created_at)
      values($1,$2,$3,$4,$5) on conflict(didit_session_id) do nothing`,[ids.accountId,decision.session_id,decision.workflow_id,decision.vendor_data,new Date(decision.created_at)]);
  }
  async function signal(decision: DiditDecision, extra: Record<string, unknown> = {}) {
    if (decision.vendor_data === `acct_${ids.accountId}` && decision.workflow_id && workflows[decision.workflow_id]) if(!(await q().query("select id from deletions where didit_session_ids @> $1::jsonb",[JSON.stringify([decision.session_id])])).length)await bindLegacy(decision);
    const payload = { event_id: randomUUID(), webhook_type: "status.updated", timestamp: Math.floor(Date.now() / 1000), session_id: decision.session_id, vendor_data: decision.vendor_data, workflow_id: decision.workflow_id, status: decision.status, ...extra };
    const raw = JSON.stringify(payload);
    const request = () => new Request("https://events.example.test/api/webhooks/didit", { method: "POST", headers: { "content-type": "application/json", "x-signature-v2": signV2(raw, "test-secret"), "x-timestamp": String(payload.timestamp) }, body: raw });
    await webhookAuth(request(), "test-secret", { db: database.db });
    return { request, payload, raw };
  }
  beforeAll(async () => { database = await testDatabase(kind); fake = await fakeDiditServer(); }, 60_000);
  afterAll(async () => { await fake?.close(); await database?.close(); });
  beforeEach(async () => {
    await resetDatabase(database.db);
    await q().query("truncate verification_discovery");
    ids = await seed(database.db);
    await q().query(`update accounts set first_name='Test',full_name='Test Guest',bio='Builder',headline='Founder',company='Example',profile_links='[{"kind":"website","label":"Work","href":"https://example.test/"}]',profile_completed_at=clock_timestamp() where id=$1`,[ids.accountId]);
    fake.decisions.clear(); fake.calls.length = 0; fake.control.before = undefined; fake.control.pageSize = undefined; fake.control.listTransform = undefined; fake.control.dropNextCreate = false; logs.length = 0;
    options = { db: database.db, client: new DiditClient({ apiKey: "fixture-key", workflows, fetch: fake.fetch }), workflows, sessions: { resolve: async cookie => (await rows<Session>(q(), "select * from sessions where id=$1", [cookie]))[0] ?? null },
      appUrl: "https://events.example.test", appDailyCapUsd: 100, eventDailyCapUsd: 20, totalCapUsd: 500, log: (event, fields) => logs.push({ event, fields }) };
    service = new VerificationLifecycle(options);
    inbox = new InboxRegistry(); outbox = new OutboxRegistry();
    registerVerificationHandlers(service, { inbox, outbox, jobs: new JobRegistry() });
  });

  it("verification email retries reuse one hashed link without persisting its plaintext", async () => {
    vi.stubEnv("SESSION_SECRET", "i1-link-secret-at-least-thirty-two-characters");
    try {
      const first = await service.issueLink(ids.accountId, ids.registrationId, "delivery-1");
      const retry = await service.issueLink(ids.accountId, ids.registrationId, "delivery-1");
      expect(retry).toEqual(first);
      expect((await q().query("select * from link_tokens"))).toHaveLength(1);
      expect(JSON.stringify(await q().query("select * from link_tokens"))).not.toContain(first.token);
      await service.revokeLink(ids.accountId, first.id);
      await expect(service.issueLink(ids.accountId, ids.registrationId, "delivery-1")).rejects.toThrow("VerificationIgnored");
      expect((await service.issueLink(ids.accountId, ids.registrationId, "delivery-2")).token).not.toBe(first.token);
    } finally { vi.unstubAllEnvs(); }
  });
  it("verification deletion immediately disables proofs, queues remote erasure and cannot be restored by a late decision", async () => {
    const decision = fake.approved(ids.accountId, full); await apply(decision);
    const principal = await guest(); await service.requestEvidenceDeletion(principal);
    expect((await facts()).every(f => f.activation === "revoked" && f.invalidatedReason === "verification_deleted" && f.value === null)).toBe(true);
    expect(await q().query("select deleting_at,deleted_at from accounts where id=$1", [ids.accountId])).toEqual([{ deleting_at: null, deleted_at: null }]);
    expect(await q().query("select admission from registrations where id=$1", [ids.registrationId])).toEqual([{ admission: "approved" }]);
    expect(await q().query("select revoked_at from sessions where id=$1", [principal.sessionId])).toEqual([{ revoked_at: null }]);
    const [tombstone] = await q().query<{ id: string; account_id: string | null; didit_session_ids: string[] }>("select * from deletions");
    expect(tombstone).toMatchObject({ account_id: null, didit_session_ids: [decision.session_id] });
    await service.requestEvidenceDeletion(principal); expect(await q().query("select id from deletions")).toHaveLength(1);
    await signal(decision); await dispatchInbox(database.db, inbox);
    expect((await facts()).every(f => f.activation === "revoked")).toBe(true);
    const { createIdentityServices } = await import("../identity/index.ts");
    await createIdentityServices({ db: database.db, didit: new DiditClient({ apiKey: "test", fetch: fake.fetch }) }).accounts.finishDeletion(tombstone!.id);
    expect(fake.count("DELETE")).toBe(1);
    expect(await q().query("select state from deletions")).toEqual([{ state: "complete" }]);
    expect(await q().query("select id from accounts where id=$1", [ids.accountId])).toHaveLength(1);
  });

  it("stores before acknowledging, dedupes replay, and processes a committed inbox after a worker crash", async () => {
    const decision = fake.approved(ids.accountId, full);
    const { request } = await signal(decision);
    expect(await webhookAuth(request(), "test-secret", { db: database.db })).toMatchObject({ duplicate: true });
    expect(await q().query("select processed_at,attempts from inbox")).toEqual([{ processed_at: null, attempts: 0 }]);
    expect(await facts()).toEqual([]); expect(fake.count("GET")).toBe(0);
    const restarted = new InboxRegistry(); registerVerificationHandlers(new VerificationLifecycle(options), { inbox: restarted, outbox: new OutboxRegistry(), jobs: new JobRegistry() });
    expect(await dispatchInbox(database.db, restarted)).toBe(true);
    expect((await facts()).map(row => [row.kind, row.activation, row.providerStatus])).toEqual([["face", "active", "approved"], ["identity", "active", "approved"]]);
    expect(await q().query("select processed_at is not null as done,attempts from inbox")).toEqual([{ done: true, attempts: 1 }]);
    expect(fake.count("GET", `/v3/session/${decision.session_id}/decision/`)).toBe(1);
    expect(await q().query("select admission from registrations")).toEqual([{ admission: "approved" }]);
  });

  it("uses the Python float signature fixture and rejects stale, tampered and forged fresh replay without storing", async () => {
    const timestamp = signatureFixture.payload.timestamp;
    const request = (raw = signatureFixture.raw, headerTime = timestamp, signature = signatureFixture.signatureV2) => new Request("https://events.example.test/webhook", { method: "POST", body: raw,
      headers: { "content-type": "application/json", "x-timestamp": String(headerTime), "x-signature-v2": signature } });
    const now = new Date(timestamp * 1000);
    expect(await webhookAuth(request(), signatureFixture.secret, { db: database.db, now })).toMatchObject({ duplicate: false });
    expect(await webhookAuth(request(), signatureFixture.secret, { db: database.db, now })).toMatchObject({ duplicate: true });
    await expect(webhookAuth(request(), signatureFixture.secret, { db: database.db, now: new Date(now.getTime() + 301_000) })).rejects.toThrow("InvalidWebhookSignature");
    await expect(webhookAuth(request(signatureFixture.raw.replace("Approved", "Declined")), signatureFixture.secret, { db: database.db, now })).rejects.toThrow("InvalidWebhookSignature");
    await expect(webhookAuth(request(signatureFixture.raw, timestamp + 1000), signatureFixture.secret, { db: database.db, now: new Date(now.getTime() + 1000_000) })).rejects.toThrow("InvalidWebhookSignature");
    expect(await q().query("select count(*)::int as n from inbox")).toEqual([{ n: 1 }]);
    expect(fake.calls).toHaveLength(0);
  });

  it("rejects cross-policy webhook callers and streamed bodies over 1 MB before persistence", async () => {
    const raw = JSON.stringify({ timestamp: Math.floor(Date.now() / 1000) });
    for (const header of ["cookie", "origin", "authorization", "x-csrf"]) {
      await expect(webhookAuth(new Request("https://events.example.test/webhook", { method: "POST", headers: { [header]: "bad", "content-type": "application/json" }, body: raw }), "secret", { db: database.db })).rejects.toThrow("WebhookCallerRequired");
    }
    await expect(webhookAuth(new Request("https://events.example.test/webhook", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(1024 * 1024 + 1) }), "secret", { db: database.db })).rejects.toThrow("BodyTooLarge");
    expect(await q().query("select count(*)::int as n from inbox")).toEqual([{ n: 0 }]); expect(fake.calls).toHaveLength(0);
  });

  it("out-of-order signals fetch current authority; withdrawal and re-approval preserve exact validity", async () => {
    const decision = fake.approved(ids.accountId, full);
    await signal(decision); await dispatchInbox(database.db, inbox);
    const original = await facts();
    const [originalExpiry] = await q().query("select first_approved_at,evidence_expires_at from verifications where didit_session_id=$1", [decision.session_id]);
    expect((await apply(decision)).changed).toBe(false);
    expect(await facts()).toEqual(original);
    fake.decisions.set(decision.session_id, { ...decision, status: "Declined" });
    await signal(decision); // stale Approved envelope, current Declined authority
    await dispatchInbox(database.db, inbox);
    expect(await q().query("select first_approved_at,evidence_expires_at from verifications where didit_session_id=$1", [decision.session_id])).toEqual([originalExpiry]);
    expect((await facts()).every(row => row.providerStatus === "withdrawn" && row.invalidatedAt && row.activation === "active")).toBe(true);
    fake.decisions.set(decision.session_id, { ...decision, events: [...decision.events!, { ...decision.events![0]!, created_at: at(-1).toISOString() }] });
    await signal({ ...decision, status: "Declined" }); await dispatchInbox(database.db, inbox);
    expect((await facts()).map(row => [row.establishedAt, row.validUntil, row.activation, row.invalidatedAt])).toEqual(original.map(row => [row.establishedAt, row.validUntil, "active", null]));
    expect(await q().query("select first_approved_at,evidence_expires_at from verifications where didit_session_id=$1", [decision.session_id])).toEqual([originalExpiry]);
    expect(fake.count("GET", `/v3/session/${decision.session_id}/decision/`)).toBe(4);
  });

  it("binds approved full/age identities to verified email and questionnaire names; rejects missing approval time", async () => {
    const mismatch = fake.approved(ids.accountId, full, { email_verifications: [{ status: "Approved", email: "someone-else@example.test", verified_at: at(-1).toISOString() }] });
    const result = await apply(mismatch);
    expect(result.verification).toMatchObject({ status: "in_review", providerStatus: "Approved", policyReason: "verified a different email", emailMatches: false });
    expect(await facts()).toEqual([]);
    const missing = fake.approved(ids.accountId, full, { events: [] });
    expect((await apply(missing)).verification.policyReason).toBe("approval timestamp unavailable");
    expect(await facts()).toEqual([]);
    const complete = fake.approved(ids.accountId, age);
    expect((await apply(complete)).evidence.map(row => row.kind).sort()).toEqual(["age", "face", "identity"]);
    expect(fake.count("GET")).toBe(3);
  });

  it("an authoritative age correction changes eligibility without extending the original approval clock", async () => {
    await q().query("update events set checks='{\"version\":1,\"required\":[],\"age_min\":18,\"max_age\":{}}' where id=$1", [ids.eventId]);
    // This registration accepted the age policy; later event edits cannot alter it.
    await q().query("update registrations set policy_version=e.policy_version,form_version=e.form_version from events e where registrations.id=$1 and e.id=registrations.event_id", [ids.registrationId]);
    const decision = fake.approved(ids.accountId, age); const approved = await apply(decision);
    const original = approved.evidence.find(row => row.kind === "age")!;
    expect((await service.evidence.summary(ids.accountId, ids.eventId)).eligibility.eligible).toBe(true);
    fake.decisions.set(decision.session_id, { ...decision, liveness_checks: [{ status: "Approved", age_estimation: 17.9, matches: [], warnings: [] }] });
    const corrected = await apply(decision);
    expect(corrected.changed).toBe(true);
    expect(corrected.evidence.find(row => row.kind === "age")).toMatchObject({ value: 17.9, establishedAt: original.establishedAt, validUntil: original.validUntil, activation: "active" });
    expect((await service.evidence.summary(ids.accountId, ids.eventId)).eligibility).toMatchObject({ eligible: false, missing: ["age"] });
    expect((await apply(decision)).changed).toBe(false);
    expect(fake.count("GET")).toBe(3);
  });

  it.each([89.99, 90])("replacement continuity %s keeps the verification unit together and old re-approvals cannot reactivate", async score => {
    const first = fake.approved(ids.accountId, full); await apply(first);
    const originalExpiry = await q().query("select first_approved_at,evidence_expires_at from verifications where didit_session_id=$1", [first.session_id]);
    const replacement = fake.approved(ids.accountId, age, { liveness_checks: [{ status: "Approved", age_estimation: 27.4, matches: [match(first.session_id, score)], warnings: [] }] });
    const result = await apply(replacement);
    expect(result.evidence.every(row => row.activation === (score >= 90 ? "active" : "pending_continuity"))).toBe(true);
    const previous = (await facts()).filter(row => row.verificationId !== result.verification.id);
    expect(previous.every(row => row.activation === (score >= 90 ? "superseded" : "active"))).toBe(true);
    fake.decisions.set(first.session_id, { ...first, status: "Declined" }); await apply(first);
    fake.decisions.set(first.session_id, first); await apply(first);
    expect((await facts()).filter(row => row.kind === "face" && row.activation === "active")).toHaveLength(1);
    expect((await facts()).filter(row => row.verificationId !== result.verification.id).every(row => row.activation === (score >= 90 ? "superseded" : "active"))).toBe(true);
    expect(await q().query("select first_approved_at,evidence_expires_at from verifications where didit_session_id=$1", [first.session_id])).toEqual(originalExpiry);
    expect(fake.count("GET")).toBe(4);
  });

  it.each([null, [], [{ status: "Approved", sections: [{ items: [
    { value: "first_name", answer: { value: "  " } }, { value: "last_name", answer: { value: "\t" } },
  ] }] }]])("empty questionnaire names fail closed without minting identity or face: %j", async questionnaire_responses => {
    const decision = fake.approved(ids.accountId, full, { questionnaire_responses });
    const applied = await apply(decision);
    expect(applied.verification).toMatchObject({ status: "in_review", policyReason: "identity proof incomplete", qFirstName: null, qLastName: null, evidenceExpiresAt: null });
    expect(await facts()).toEqual([]);
    expect(await q().query("select has_face_history from accounts where id=$1", [ids.accountId])).toEqual([{ has_face_history: false }]);
    expect(fake.count("GET", `/v3/session/${decision.session_id}/decision/`)).toBe(1);
    expect(fake.count("POST")).toBe(0);
  });

  it("requires fresh persisted guest authentication for renewal and never enqueues a renewal email", async () => {
    await apply(fake.approved(ids.accountId, full));
    const stale = await guest(false);
    await expect(service.startLegacyRenewal({ ...stale, authenticatedAt: new Date() })).rejects.toThrow("GuestAuthenticationRequired");
    expect(fake.count("POST")).toBe(0);
    const principal = await guest();
    const result = await service.startLegacyRenewal(principal);
    expect(result.url).toMatch(/^https:\/\/verify.didit.me\/session\//);
    const again = await service.startLegacyRenewal(principal);
    expect(again).toEqual(result); expect(fake.count("POST")).toBe(1);
    expect(await q().query("select kind from outbox where kind in ('M-03','verification.create','verification.attach')")).toEqual([]);
    expect(await q().query("select kind,state,expires_at-created_at <= interval '24 hours 1 second' as bounded from verification_ops")).toEqual([{ kind: "renewal", state: "active", bounded: true }]);
    expect((await facts()).filter(row => row.kind === "face" && row.activation === "active")).toHaveLength(1);
    expect(await q().query("select state,usd_max_micros from spend")).toEqual([{ state: "uncertain", usd_max_micros: kind === "postgres" ? "100000" : 100000 }]);
  });

  it("fresh owner/admin recovery activates a pending unit with an atomic audit; staff/stale/revoked sessions cannot recover", async () => {
    const first = fake.approved(ids.accountId, full); await apply(first);
    const replacement = fake.approved(ids.accountId, age); const pending = await apply(replacement);
    await q().query("insert into staff(email,role) values('admin@didit.me','admin')");
    const [session] = await rows<Session>(q(), "insert into sessions(token_hash,principal,auth_method,staff_email,expires_at) values($1,'staff','oidc_google','admin@didit.me',clock_timestamp()+interval '1 day') returning *", [hashToken(randomUUID())]);
    await q().query("update sessions set authenticated_at=clock_timestamp()-interval '15 minutes' where id=$1", [session!.id]);
    await expect(service.evidence.recover(session!.id, pending.verification.id, "In-person identity confirmation")).rejects.toThrow("FreshAdminAuthenticationRequired");
    await q().query("update sessions set authenticated_at=clock_timestamp() where id=$1", [session!.id]);
    await q().query("update staff set role='staff' where email='admin@didit.me'");
    await expect(service.evidence.recover(session!.id, pending.verification.id, "Checked")).rejects.toThrow("FreshAdminAuthenticationRequired");
    await q().query("update staff set role='admin' where email='admin@didit.me'");
    await expect(service.evidence.recover(session!.id, pending.verification.id, "   ")).rejects.toThrow("FreshAdminAuthenticationRequired");
    vi.stubEnv("STAFF_EMAIL_DOMAIN", "fork.test");
    try {
      await expect(service.evidence.recover(session!.id, pending.verification.id, "Checked after domain change")).rejects.toThrow("FreshAdminAuthenticationRequired");
      expect(await q().query("select id from audit where action='evidence_recovered'")).toEqual([]);
      expect((await facts()).filter(row => row.verificationId === pending.verification.id).every(row => row.activation === "pending_continuity")).toBe(true);
    } finally { vi.unstubAllEnvs(); }
    const recovered = await service.evidence.recover(session!.id, pending.verification.id, "In-person identity confirmation");
    expect(recovered.evidence.every(row => row.activation === "active" && row.recoveredBy === "admin@didit.me" && row.continuityOf === null)).toBe(true);
    expect(await q().query("select actor,action,target from audit")).toEqual([{ actor: "admin@didit.me", action: "evidence_recovered", target: pending.verification.id }]);
    await service.evidence.recover(session!.id, pending.verification.id, "Repeated request");
    expect(await q().query("select count(*)::int as n from audit")).toEqual([{ n: 1 }]);
    await q().query("update sessions set revoked_at=clock_timestamp() where id=$1", [session!.id]);
    await expect(service.evidence.recover(session!.id, pending.verification.id, "Checked")).rejects.toThrow("FreshAdminAuthenticationRequired");
    expect(fake.count("GET")).toBe(4);
  });

  it.each([false, true])("selfie-only renewal continuity match=%s preserves identity and gates the new face", async continuity => {
    const first = fake.approved(ids.accountId, full); const original = await apply(first);
    const principal = await guest(); const started = await service.startLegacyRenewal(principal);
    const remote = [...fake.decisions.values()].find(row => row.workflow_id === renewal)!;
    const decision = fake.approved(ids.accountId, renewal, { session_id: remote.session_id, created_at: remote.created_at,
      questionnaire_responses: null, email_verifications: null,
      liveness_checks: [{ status: "Approved", matches: continuity ? [match(first.session_id, 90)] : [], warnings: [] }],
      events: [{ event_type: "SESSION_STATUS_CHANGED", feature_step: null, created_at: new Date().toISOString(), details: { current_status: "Approved" } }] });
    const result = await apply(decision);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ kind: "face", activation: continuity ? "active" : "pending_continuity", continuityOf: continuity ? original.verification.id : null });
    expect((await facts()).filter(row => row.kind === "identity")).toEqual(original.evidence.filter(row => row.kind === "identity"));
    expect(await q().query("select state from verification_ops where id=$1", [started.opId])).toEqual([{ state: "completed" }]);
    expect(await q().query("select count(*)::int as n from outbox where kind='M-03'")).toEqual([{ n: 0 }]);
    expect(fake.count("POST")).toBe(1); expect(fake.calls.filter(call => /\/decision\/$/.test(call.path))).toHaveLength(2);
  });

  it("a failed inbox transaction leaves no partial evidence and retries the authoritative fetch", async () => {
    const decision = fake.approved(ids.accountId, full); await signal(decision);
    const failing = new InboxRegistry();
    failing.register("status.updated", async (_message, tx) => { await service.evidence.applyDecision(tx, ids.accountId, decision.session_id); throw new Error("SimulatedCrashBeforeCheckpoint"); });
    await dispatchInbox(database.db, failing);
    expect(await facts()).toEqual([]);
    expect(await q().query("select count(*)::int as n from verifications")).toEqual([{ n: 1 }]);
    expect(await q().query("select attempts,processed_at,error from inbox")).toEqual([{ attempts: 1, processed_at: null, error: "processing_failed" }]);
    await q().query("update inbox set next_attempt_at=clock_timestamp()");
    await dispatchInbox(database.db, inbox);
    expect(await facts()).toHaveLength(2); expect(fake.count("GET")).toBe(2);
  });

  it("expired renewal operations cannot activate a late approval even with a matching face", async () => {
    const first = fake.approved(ids.accountId, full); const original = await apply(first);
    const started = await service.startLegacyRenewal(await guest());
    const remote = [...fake.decisions.values()].find(row => row.workflow_id === renewal)!;
    await q().query("update verification_ops set expires_at=clock_timestamp()-interval '1 second' where id=$1", [started.opId]);
    const decision = fake.approved(ids.accountId, renewal, { session_id: remote.session_id, created_at: remote.created_at,
      liveness_checks: [{ status: "Approved", matches: [match(first.session_id)], warnings: [] }],
      events: [{ event_type: "SESSION_STATUS_CHANGED", feature_step: null, created_at: new Date().toISOString(), details: { current_status: "Approved" } }] });
    const result = await apply(decision);
    expect(result.evidence[0]!.activation).toBe("pending_continuity");
    expect(result.verification.policyReason).toBe("renewal operation expired or missing");
    expect((await facts()).find(row => row.kind === "face" && row.activation === "active")?.verificationId).toBe(original.verification.id);
    expect(fake.count("POST")).toBe(1); expect(fake.calls.filter(call => /\/decision\/$/.test(call.path))).toHaveLength(2);
  });

  it("purged face history never makes a replacement initial; expired evidence is not re-minted", async () => {
    const first = fake.approved(ids.accountId, full); await apply(first);
    await q().query("delete from evidence where account_id=$1", [ids.accountId]);
    const next = fake.approved(ids.accountId, renewal, { liveness_checks: [{ status: "Approved", matches: [match(first.session_id)], warnings: [] }] });
    expect((await apply(next)).evidence[0]!.activation).toBe("pending_continuity");
    await q().query("delete from evidence where account_id=$1", [ids.accountId]);
    const old = at(-400 * day).toISOString();
    await q().query("update verifications set first_approved_at=$1,liveness_at=$1,created_at=$1", [new Date(old)]);
    fake.decisions.set(first.session_id, { ...first, created_at: old, events: [{ event_type: "SESSION_STATUS_CHANGED", feature_step: null, created_at: old, details: { current_status: "Approved" } }] });
    const expired = await apply(first);
    expect(expired.evidence).toEqual([]); expect(expired.verification).toMatchObject({ status: "expired", nextFetchAt: null });
    expect(fake.count("GET")).toBe(3);
  });

  it("C4 persists the op first, reserves the event cap, and adopts a completed session after create-response loss", async () => {
    const { opId } = await service.request(ids.accountId, full, ids.registrationId);
    expect(await service.request(ids.accountId, full, ids.registrationId)).toEqual({ opId });
    expect(fake.calls).toHaveLength(0);
    fake.control.dropNextCreate = true;
    await expect(service.createOrAdopt(opId)).rejects.toThrow("DiditUnavailable");
    expect(fake.count("POST")).toBe(1);
    const remote = [...fake.decisions.values()][0]!;
    fake.approved(ids.accountId, full, { session_id: remote.session_id, created_at: remote.created_at, events: [{ event_type: "SESSION_STATUS_CHANGED", feature_step: null, created_at: new Date().toISOString(), details: { current_status: "Approved" } }] });
    fake.control.listTransform = items => items.map(({ session_url: _url, ...item }) => item);
    const restarted = new VerificationLifecycle(options);
    const adopted = await restarted.createOrAdopt(opId);
    expect(adopted.session_id).toBe(remote.session_id); expect(adopted.url).toContain(`/e/${ids.eventId}/done?verificationSessionId=`);
    expect(fake.count("POST")).toBe(1);
    expect(await q().query("select count(*)::int as n from verifications")).toEqual([{ n: 1 }]);
    expect(await q().query("select state from verification_ops")).toEqual([{ state: "completed" }]);
    expect(await q().query("select hosted_url from verifications")).toEqual([{ hosted_url: null }]);
    const [ledger] = await q().query<{ scopes: Array<{ key: string }>; state: string }>("select * from spend");
    expect(ledger!.state).toBe("uncertain"); expect(ledger!.scopes.some(scope => scope.key.startsWith(`spend:event/day:${ids.eventId}:`))).toBe(true);
    await service.attach(opId, ids.registrationId); await service.attach(opId, ids.registrationId);
    expect(await q().query("select count(*)::int as n from outbox where kind='M-03'")).toEqual([{ n: 1 }]);
    expect(await q().query("select attached_at is not null as attached from verification_attachments")).toEqual([{ attached: true }]);
    const postIndex = fake.calls.findIndex(call => call.method === "POST");
    expect(fake.calls.slice(0, postIndex).every(call => call.path === "/v3/sessions/" && call.query.get("vendor_data") === `acct_${ids.accountId}`)).toBe(true);
  });

  it("C4 adopts a session whose Didit created_at is second-precision and slightly behind our clock (no second paid session)", async () => {
    const { opId } = await service.request(ids.accountId, full, ids.registrationId);
    fake.control.dropNextCreate = true;
    await expect(service.createOrAdopt(opId)).rejects.toThrow("DiditUnavailable");
    const remote = [...fake.decisions.values()][0]!;
    const [op] = await q().query<{ created_at: Date }>("select created_at from verification_ops where id=$1", [opId]);
    // Didit reports whole seconds, and its clock runs ~2 s behind ours.
    const skewed = new Date(Math.floor((op!.created_at.getTime() - 2000) / 1000) * 1000).toISOString().replace(".000Z", "Z");
    fake.decisions.set(remote.session_id, { ...remote, created_at: skewed });
    const adopted = await new VerificationLifecycle(options).createOrAdopt(opId);
    expect(adopted.session_id).toBe(remote.session_id);
    expect(fake.count("POST")).toBe(1);
    expect(await q().query("select count(*)::int as n from verifications")).toEqual([{ n: 1 }]);
  });

  for (const source of ["adopted", "reused"]) it.each([true, false])(`${source} session missing its URL: provider URL available=%s`, async available => {
    const { opId } = await service.request(ids.accountId, full, ids.registrationId);
    const remote = source === "reused" ? fake.decisions.get((await service.createOrAdopt(opId)).session_id)! :
      fake.approved(ids.accountId, full, { status: "In Progress", created_at: new Date().toISOString(), events: [] });
    const hostedUrl = `https://verify.didit.me/session/${remote.session_id}?recovered=1`;
    fake.decisions.set(remote.session_id, { ...remote, url: available ? hostedUrl : options.appUrl });
    fake.control.listTransform = items => items.map(({ session_url: _url, ...item }) => item);
    await q().query("update verifications set hosted_url=null");
    const result = await service.createOrAdopt(opId);
    expect(result.url).toMatch(/^https:\/\/verify.didit.me\/session\//);
    const initialPosts = source === "reused" ? 1 : 0;
    expect(fake.count("POST", "/v3/session/")).toBe(initialPosts + (available ? 0 : 1));
    expect(fake.count("GET", `/v3/session/${remote.session_id}/decision/`)).toBe(1);
    if (available) {
      expect(result.url).toBe(hostedUrl);
      expect(await q().query("select state,replacement_op_id from verification_ops")).toEqual([{ state: "active", replacement_op_id: null }]);
    } else {
      const [stale] = await q().query<{ state: string; replacement_op_id: string }>("select state,replacement_op_id from verification_ops where id=$1", [opId]);
      expect(stale!.state).toBe("stale"); expect(stale!.replacement_op_id).toBeTruthy();
      expect(await q().query("select state from verification_ops where id=$1", [stale!.replacement_op_id])).toEqual([{ state: "active" }]);
      expect(await q().query("select registration_id from verification_attachments where op_id=$1", [stale!.replacement_op_id])).toEqual([{ registration_id: ids.registrationId }]);
    }
    expect(await q().query("select hosted_url from verifications where hosted_url is not null")).toEqual([{ hosted_url: result.url }]);
    if(!available)expect(await q().query("select id from verification_ops where state='stale' and didit_session_id is not null")).toHaveLength(1);
    expect(await service.createOrAdopt(opId)).toEqual(result);
    expect(fake.count("POST", "/v3/session/")).toBe(initialPosts + (available ? 0 : 1));
  });

  it("outbox drives create, refresh, attachment and a distinct B5 email step", async () => {
    await service.request(ids.accountId, full, ids.registrationId);
    const deliveries: string[] = []; outbox.register("M-03", async message => { deliveries.push(message.dedupe_key); });
    for (let i = 0; i < 8; i++) {
      if (!await dispatchOutbox(database.db, outbox)) await q().query("update outbox set next_attempt_at=clock_timestamp() where status='pending'");
    }
    expect(fake.count("POST")).toBe(1); expect(deliveries).toHaveLength(1);
    expect(await q().query("select count(*)::int as n from outbox where status='pending'")).toEqual([{ n: 0 }]);
    expect(await q().query("select count(*)::int as n from verifications")).toEqual([{ n: 1 }]);
  });

  it("spend exhaustion and unprovisioned age prices dispatch no paid request", async () => {
    const limited = new VerificationLifecycle({ ...options, eventDailyCapUsd: 0.22 });
    const { opId } = await limited.request(ids.accountId, full, ids.registrationId);
    await expect(limited.createOrAdopt(opId)).rejects.toThrow("budget exceeded");
    const noPrice = new VerificationLifecycle({ ...options, workflows: { ...workflows, [age]: { kind: "age", maxPriceUsd: 0 } } });
    await expect(noPrice.request(ids.accountId, age, ids.registrationId)).rejects.toThrow("WorkflowNotProvisioned");
    expect(fake.count("POST")).toBe(0); expect(await q().query("select count(*)::int as n from spend")).toEqual([{ n: 0 }]);
  });

  it("a supplied reservation cannot bypass the shared app cap with a similar scope name", async () => {
    const { opId } = await service.request(ids.accountId, full, ids.registrationId);
    const reservation = await reserve({ op: "session_full", usdMax: 0.23, scopes: [
      { kind: "app/day", id: "events:shadow", usdCap: 100 }, { kind: "total", id: "events", usdCap: 500 },
      { kind: "event/day", id: ids.eventId, usdCap: 20 },
    ] }, database.db);
    await expect(service.createOrAdopt(opId, reservation)).rejects.toThrow("VerificationReservationScopesRequired");
    expect(fake.count("POST")).toBe(0);
    expect(await q().query("select state,actual_micros::int as cost from spend")).toEqual([{ state: "settled", cost: 0 }]);
  });

  it("tokens have 32 random bytes, only hashes persist, event-end expiry and slug/account/revocation binding", async () => {
    const link = await service.issueLink(ids.accountId, ids.registrationId);
    expect(Buffer.from(link.token, "base64url")).toHaveLength(32);
    expect(await q().query("select hash,expires_at from link_tokens")).toEqual([{ hash: hashToken(link.token), expires_at: link.expiresAt }]);
    expect((await service.resolveLink(ids.eventId, link.token))?.state).toBe("valid");
    expect(await service.resolveLink("another-event", link.token)).toBeNull();
    const outsider = await seed(database.db), principal = await guest();
    await expect(service.startLegacyForRegistration({ ...principal, accountId: outsider.accountId }, ids.eventId, link.token)).rejects.toThrow("GuestAuthenticationRequired");
    await service.revokeLink(ids.accountId, link.id);
    expect((await service.resolveLink(ids.eventId, link.token))?.state).toBe("revoked");
    const expiring = await service.issueLink(ids.accountId, ids.registrationId);
    await q().query("update link_tokens set expires_at=clock_timestamp() where id=$1", [expiring.id]);
    expect((await service.resolveLink(ids.eventId, expiring.token))?.state).toBe("expired");
    expect(fake.calls).toHaveLength(0);
  });

  it("a guest's replacement-link request persists only the hash and a separate B5 delivery request", async () => {
    const result = await service.requestLink(await guest(), ids.eventId);
    const token = new URL(result.url).pathname.split("/").at(-1)!;
    expect((await service.resolveLink(ids.eventId, token))?.state).toBe("valid");
    expect(await q().query("select hash from link_tokens")).toEqual([{ hash: hashToken(token) }]);
    const messages = await q().query("select kind,payload from outbox");
    expect(messages).toEqual([{ kind: "M-03", payload: { registrationId: ids.registrationId } }]);
    expect(JSON.stringify(messages)).not.toContain(token);
    expect(await q().query("select count(*)::int as n from verification_ops")).toEqual([{ n: 0 }]);
    expect(fake.calls).toHaveLength(0);
  });

  it("link review status follows its registration, while eligibility is checked against that event", async () => {
    const other = await seed(database.db);
    await q().query("update registrations set account_id=$2 where id=$1", [other.registrationId, ids.accountId]);
    await q().query("update events set checks='{\"version\":1,\"required\":[],\"age_min\":18,\"max_age\":{}}' where id=$1", [other.eventId]);
    const firstLink = await service.issueLink(ids.accountId, ids.registrationId);
    const otherLink = await service.issueLink(ids.accountId, other.registrationId);
    const firstOp = await service.request(ids.accountId, full, ids.registrationId);
    const firstRemote = await service.createOrAdopt(firstOp.opId);
    const otherOp = await service.request(ids.accountId, age, other.registrationId);
    const otherRemote = await service.createOrAdopt(otherOp.opId);
    const otherDecision = fake.decisions.get(otherRemote.session_id)!;
    fake.decisions.set(otherRemote.session_id, { ...otherDecision, status: "In Review" });
    await apply(otherDecision);
    expect((await service.resolveLink(ids.eventId, firstLink.token))?.state).toBe("valid");
    expect((await service.resolveLink(other.eventId, otherLink.token))?.state).toBe("in_review");
    const firstDecision = fake.approved(ids.accountId, full, { session_id: firstRemote.session_id, created_at: fake.decisions.get(firstRemote.session_id)!.created_at,
      events: [{ event_type: "SESSION_STATUS_CHANGED", feature_step: null, created_at: new Date().toISOString(), details: { current_status: "Approved" } }] });
    await apply(firstDecision);
    expect((await service.resolveLink(ids.eventId, firstLink.token))?.state).toBe("verified");
    expect((await service.resolveLink(other.eventId, otherLink.token))?.state).toBe("verified"); // Accepted baseline policy remains pinned.
    expect((await service.evidence.summary(ids.accountId, other.eventId)).eligibility).toMatchObject({ eligible: true, missing: [] }); // The receipt predates the age policy.
    expect(await q().query("select count(*)::int as n from verification_attachments")).toEqual([{ n: 2 }]);
    expect((await facts()).map(row => row.kind)).toEqual(["face", "identity"]);
    expect(fake.count("POST", "/v3/session/")).toBe(2);
    expect(fake.calls.filter(call => call.path.endsWith("/decision/"))).toHaveLength(2);
  });

  it("return state is account-bound, display-only and cannot approve from query parameters", async () => {
    const decision = fake.approved(ids.accountId, full); await apply(decision);
    const before = await rows<Verification>(q(), "select * from verifications");
    expect((await service.outcome(ids.accountId, ids.eventId, decision.session_id))?.state).toBe("approved");
    expect(await service.outcome(ids.accountId, ids.eventId, randomUUID())).toBeNull();
    const other = await seed(database.db);
    expect(await service.outcome(other.accountId, other.eventId, decision.session_id)).toBeNull();
    expect(await rows<Verification>(q(), "select * from verifications")).toEqual(before); expect(fake.count("GET")).toBe(1);
  });

  it("hourly full discovery paginates with overlap, dedupes churn and catches missed decisions", async () => {
    const sessions = Array.from({ length: 6 }, () => fake.approved(ids.accountId, full));
    for(const session of sessions)await bindLegacy(session);
    fake.control.pageSize = 2;
    let inserted = false;
    fake.control.listTransform = async (items, call) => {
      if (!inserted && Number(call.query.get("offset")) > 0) { inserted = true; const added = fake.approved(ids.accountId, full); sessions.push(added); await bindLegacy(added); }
      return items;
    };
    const result = await service.reconcile();
    expect(result.discovered).toBe(0); expect(result.fetched).toBe(7);
    expect(await q().query("select count(*)::int as n from verifications")).toEqual([{ n: 7 }]);
    expect((await facts()).filter(row => row.kind === "face" && row.activation === "active")).toHaveLength(1);
    expect(fake.calls.filter(call => /\/decision\/$/.test(call.path))).toHaveLength(7);
    const lists = fake.count("GET", "/v3/sessions/"); await service.reconcile(); expect(fake.count("GET", "/v3/sessions/")).toBe(lists);
  });

  it("daily reconciliation withdraws an approval older than 30 days and door eligibility rejects", async () => {
    const old = at(-40 * day).toISOString();
    const decision = fake.approved(ids.accountId, full, { created_at: at(-41 * day).toISOString(), events: [{ event_type: "SESSION_STATUS_CHANGED", feature_step: null, created_at: old, details: { current_status: "Approved" } }] });
    const result = await apply(decision);
    const face = result.evidence.find(row => row.kind === "face")!;
    expect((await service.evidence.summary(ids.accountId, ids.eventId)).eligibility.eligible).toBe(true);
    fake.decisions.set(decision.session_id, { ...decision, status: "Declined" });
    await q().query("update verifications set fetched_at=clock_timestamp()-interval '25 hours',next_fetch_at=null");
    expect((await service.reconcile()).fetched).toBe(1);
    const account = await service.evidence.summary(ids.accountId, ids.eventId);
    const [event] = await rows<DomainEvent>(q(), "select * from events where id=$1", [ids.eventId]);
    const [registration] = await rows<Registration>(q(), "select * from registrations where id=$1", [ids.registrationId]);
    expect(doorEligibility({ account, event: event!, registration: registration!, kiosk: { id: ids.kioskId, eventId: ids.eventId, revokedAt: null }, faceEvidenceId: face.id, now: new Date() })).toEqual({ eligible: false, result: "not_verified" });
    expect(fake.count("GET", `/v3/session/${decision.session_id}/decision/`)).toBe(2);
  });

  it("young pending sessions use 5-minute cadence, older ones hourly, with a durable 30-fetch cap and backlog alert", async () => {
    for (let i = 0; i < 35; i++) await bindLegacy(fake.approved(ids.accountId, full, { status: "In Progress", created_at: at(-2 * 3600).toISOString(), events: [] }));
    const first = await service.reconcile();
    expect(first.fetched).toBe(30); expect(first.discovered).toBe(0); expect(first.backlogSeconds).toBeGreaterThan(3600);
    expect(logs.some(row => row.event === "verification.reconcile_backlog")).toBe(true);
    expect((await service.reconcile()).fetched).toBe(0);
    expect(fake.calls.filter(call => /\/decision\/$/.test(call.path))).toHaveLength(30);
    expect(await q().query("select count(*)::int as n from verifications where next_fetch_at-fetched_at=interval '1 hour'")).toEqual([{ n: 30 }]);
    const young = fake.approved(ids.accountId, full, { status: "In Progress", events: [] }); await apply(young);
    expect(await q().query("select next_fetch_at-fetched_at=interval '5 minutes' as young from verifications where didit_session_id=$1", [young.session_id])).toEqual([{ young: true }]);
  });

  it("tombstoned accounts and foreign workflows are ignored by inbox, discovery and creation", async () => {
    const decision = fake.approved(ids.accountId, full), foreign = fake.approved(ids.accountId, randomUUID());
    await signal(foreign); await dispatchInbox(database.db, inbox);
    await q().query("insert into deletions(email_hash,account_id,didit_session_ids) values($1,$2,$3::jsonb)", [hashToken(`${ids.accountId}@example.test`), ids.accountId, JSON.stringify([decision.session_id])]);
    await signal(decision); await dispatchInbox(database.db, inbox);
    expect(await q().query("select count(*)::int as n from inbox where processed_at is not null")).toEqual([{ n: 2 }]);
    await service.reconcile();
    await expect(service.request(ids.accountId, full, ids.registrationId)).rejects.toThrow("VerificationIgnored");
    expect(await facts()).toEqual([]); expect(await q().query("select count(*)::int as n from verifications")).toEqual([{ n: 0 }]);
    expect(fake.count("POST")).toBe(0); expect(fake.calls.filter(call => /\/decision\/$/.test(call.path))).toHaveLength(0);
  });

  it("30 poison rows back off so the next budget window fetches five legitimate rows, including an old withdrawal", async () => {
    const old = at(-40 * day).toISOString();
    const withdrawn = fake.approved(ids.accountId, full, { created_at: old,
      events: [{ event_type: "SESSION_STATUS_CHANGED", feature_step: null, created_at: old, details: { current_status: "Approved" } }] });
    await apply(withdrawn);
    const poison = Array.from({ length: 30 }, () => fake.approved(ids.accountId, full, { status: "In Progress", created_at: at(-3 * 3600).toISOString(), events: [] }));
    for (const row of poison) await q().query(`insert into verifications(account_id,didit_session_id,workflow_id,vendor_data,created_at,next_fetch_at)
      values($1,$2,$3,$4,$5,$5)`, [ids.accountId, row.session_id, full, row.vendor_data, at(-3 * 3600)]);
    for (let i = 0; i < 4; i++) {
      const row = fake.approved(ids.accountId, full, { status: "In Progress", created_at: at(-2 * 3600).toISOString(), events: [] });
      await q().query(`insert into verifications(account_id,didit_session_id,workflow_id,vendor_data,created_at,next_fetch_at)
        values($1,$2,$3,$4,$5,$5)`, [ids.accountId, row.session_id, full, row.vendor_data, at(-2 * 3600)]);
    }
    // Last good observation is <24h old; discovery makes the changed approval immediately due.
    await q().query("update verifications set fetched_at=clock_timestamp()-interval '23 hours',next_fetch_at=clock_timestamp() where didit_session_id=$1", [withdrawn.session_id]);
    fake.decisions.set(withdrawn.session_id, { ...withdrawn, status: "Declined" });
    fake.control.before = async call => { if (poison.some(row => call.path === `/v3/session/${row.session_id}/decision/`)) throw new Error("PoisonFixture"); };
    expect((await service.reconcile()).fetched).toBe(0);
    expect(await q().query(`select count(*)::int as n from verifications where reconcile_state='retry' and fetch_attempts=1
      and last_error='decision_apply_failed' and next_fetch_at between clock_timestamp()+interval '110 seconds' and clock_timestamp()+interval '121 seconds'`)).toEqual([{ n: 30 }]);
    expect(fake.calls.filter(call => call.path.endsWith("/decision/"))).toHaveLength(31);
    expect((await service.reconcile()).fetched).toBe(0);
    // Advance the rate-limit window and hourly discovery checkpoint, without waiting in real time.
    await q().query("update counters set expires_at=clock_timestamp() where key='b1:reconcile:decisions'");
    await q().query("truncate verification_discovery");
    expect((await service.reconcile()).fetched).toBe(5);
    expect(fake.calls.filter(call => call.path.endsWith("/decision/"))).toHaveLength(36);
    expect((await facts()).every(row => row.providerStatus === "withdrawn" && row.invalidatedAt !== null)).toBe(true);
    expect(await q().query("select status,reconcile_state,fetch_attempts,last_error from verifications where didit_session_id=$1", [withdrawn.session_id])).toEqual([
      { status: "declined", reconcile_state: "ready", fetch_attempts: 0, last_error: null },
    ]);
    expect(fake.count("POST")).toBe(0);
  });

  it("retries exponentially to a six-hour cap, then clears failure state on successful fetch", async () => {
    const remote = fake.approved(ids.accountId, full, { status: "In Progress", created_at: at(-2 * 3600).toISOString(), events: [] });
    await bindLegacy(remote);
    fake.control.before = async call => { if (call.path.endsWith("/decision/")) throw new Error("UnavailableFixture"); };
    await service.reconcile();
    await q().query("update verifications set next_fetch_at=clock_timestamp()");
    await service.reconcile();
    expect(await q().query("select fetch_attempts,next_fetch_at>clock_timestamp()+interval '239 seconds' as backoff from verifications")).toEqual([{ fetch_attempts: 2, backoff: true }]);
    await q().query("update verifications set fetch_attempts=8,next_fetch_at=clock_timestamp()");
    await service.reconcile();
    expect(await q().query("select fetch_attempts,next_fetch_at between clock_timestamp()+interval '359 minutes' and clock_timestamp()+interval '360 minutes' as capped from verifications")).toEqual([{ fetch_attempts: 9, capped: true }]);
    fake.control.before = undefined;
    await q().query("update verifications set next_fetch_at=clock_timestamp()");
    expect((await service.reconcile()).fetched).toBe(1);
    expect(await q().query("select reconcile_state,fetch_attempts,last_error from verifications")).toEqual([{ reconcile_state: "ready", fetch_attempts: 0, last_error: null }]);
    expect(fake.count("GET", `/v3/session/${remote.session_id}/decision/`)).toBe(4);
    expect(fake.count("POST")).toBe(0); expect(await facts()).toEqual([]);
  });

  it.each(["vendor", "workflow", "tombstone"])("permanently ignores a tracked %s mismatch without repeated fetches", async mismatch => {
    const remote = fake.approved(ids.accountId, full, { status: "In Progress", events: [] });
    await q().query("insert into verifications(account_id,didit_session_id,workflow_id,vendor_data,next_fetch_at) values($1,$2,$3,$4,clock_timestamp())", [ids.accountId, remote.session_id, full, remote.vendor_data]);
    if (mismatch === "tombstone") await q().query("insert into deletions(email_hash,account_id,didit_session_ids) values($1,$2,$3::jsonb)", [hashToken(`${ids.accountId}@example.test`), ids.accountId, JSON.stringify([remote.session_id])]);
    else fake.decisions.set(remote.session_id, { ...remote, ...(mismatch === "workflow" ? { workflow_id: age } : { vendor_data: `acct_${randomUUID()}` }) });
    expect((await service.reconcile()).fetched).toBe(0);
    expect(await q().query("select reconcile_state,next_fetch_at,last_error from verifications")).toEqual([{ reconcile_state: "ignored", next_fetch_at: null, last_error: mismatch === "tombstone" ? "tombstoned" : "verification_ignored" }]);
    await q().query("truncate verification_discovery");
    expect((await service.reconcile()).fetched).toBe(0);
    expect(fake.count("GET", `/v3/session/${remote.session_id}/decision/`)).toBe(mismatch === "tombstone" ? 0 : 1);
    expect(fake.count("POST")).toBe(0); expect(await facts()).toEqual([]);
  });

  it("retention clears processed inbox bodies, retains continuity ancestors and never resets face history", async () => {
    const first = fake.approved(ids.accountId, full); const approved = await apply(first);
    await signal(first); await dispatchInbox(database.db, inbox);
    await signal(first); // A permanently failing/unknown handler must not keep its body beyond 14 days.
    const replacement = fake.approved(ids.accountId, full, { liveness_checks: [{ status: "Approved", matches: [match(first.session_id)], warnings: [] }] }); await apply(replacement);
    await q().query("update evidence set established_at=clock_timestamp()-interval '181 days',valid_until=clock_timestamp()-interval '1 day' where kind='face' and verification_id=$1", [approved.verification.id]);
    await q().query("update inbox set verified_at=clock_timestamp()-interval '15 days'");
    await retainVerificationData(service);
    expect(await q().query("select raw,headers from inbox")).toEqual([{ raw: null, headers: null }, { raw: null, headers: null }]);
    expect(await q().query("select count(*)::int as n from inbox where processed_at is not null")).toEqual([{ n: 2 }]);
    expect(logs).toContainEqual({ event: "verification.inbox_retention_expired", fields: { count: 1 } });
    expect(await q().query("select has_face_history from accounts where id=$1", [ids.accountId])).toEqual([{ has_face_history: true }]);
    expect(await q().query("select count(*)::int as n from evidence where kind='face'")).toEqual([{ n: 2 }]);
    expect((await service.evidence.summary(ids.accountId, ids.eventId)).eligibility.eligible).toBe(true);
    expect(fake.count("GET")).toBe(3);
  });

  it("renewal raw decisions expire 30 days after their 180-day proof even after that proof is purged", async () => {
    await apply(fake.approved(ids.accountId, full));
    const decision = fake.approved(ids.accountId, renewal);
    const pending = await apply(decision);
    expect(pending.verification.evidenceExpiresAt!.getTime() - pending.verification.firstApprovedAt!.getTime()).toBe(180 * day * 1000);
    const established = at(-211 * day), expires = at(-31 * day);
    await q().query("update evidence set established_at=$2,valid_until=$3 where verification_id=$1", [pending.verification.id, established, expires]);
    await q().query("update verifications set first_approved_at=$2,liveness_at=$2,evidence_expires_at=$3,hosted_url=$4 where id=$1", [pending.verification.id, established, expires, "https://verify.didit.me/session/EXPIRED"]);
    await retainVerificationData(service);
    expect(await q().query("select decision,hosted_url from verifications where id=$1", [pending.verification.id])).toEqual([{ decision: null, hosted_url: null }]);
    expect(await q().query("select count(*)::int as n from evidence where verification_id=$1", [pending.verification.id])).toEqual([{ n: 0 }]);
    const refreshed = await apply(decision);
    expect(refreshed.verification).toMatchObject({ decision: null, evidenceExpiresAt: expires, nextFetchAt: null });
    expect(refreshed.evidence).toEqual([]); expect(fake.count("GET")).toBe(3);
  });

  if (kind === "postgres") {
    it.each([false, true])("five concurrent starts and the outbox worker share one URL, pending=%s", async pending => {
      const principal = await guest(), link = await service.issueLink(ids.accountId, ids.registrationId);
      await service.request(ids.accountId, full, ids.registrationId);
      const entered = deferred(), release = deferred();
      fake.control.before = async call => { if (call.method === "POST") { entered.resolve(); await release.promise; } };
      const create = vi.spyOn(service, "createOrAdopt");
      const worker = dispatchOutbox(database.db, outbox);
      await entered.promise;
      const starts = Promise.all(Array.from({ length: 5 }, () => service.startLegacyForRegistration(principal, ids.eventId, link.token)));
      try {
        if (pending) {
          expect(await starts).toEqual(Array.from({ length: 5 }, () => ({ state: "pending", retryAfterMs: 1000 })));
          expect(await q().query("select state,attempts from verification_ops")).toEqual([{ state: "creating", attempts: 1 }]);
        } else await expect.poll(() => create.mock.calls.length).toBeGreaterThanOrEqual(6);
      } finally { release.resolve(); }
      expect(await worker).toBe(true);
      const results = pending ? await Promise.all(Array.from({ length: 5 }, () => service.startLegacyForRegistration(principal, ids.eventId, link.token))) : await starts;
      expect(results).toEqual(Array.from({ length: 5 }, () => ({ url: `https://verify.didit.me/session/${[...fake.decisions.keys()][0]}` })));
      expect(await q().query("select state,attempts from verification_ops")).toEqual([{ state: "active", attempts: 1 }]);
      expect(await q().query("select count(*)::int as n from verifications")).toEqual([{ n: 1 }]);
      expect(await q().query("select count(*)::int as n from spend")).toEqual([{ n: 1 }]);
      expect(await q().query("select count(*)::int as n from verification_attachments")).toEqual([{ n: 1 }]);
      expect(fake.count("POST", "/v3/session/")).toBe(1);
      create.mockRestore();
    });

    it("simultaneous requests create one operation and one paid call", async () => {
      const requested = await Promise.all(Array.from({ length: 5 }, () => service.request(ids.accountId, full, ids.registrationId)));
      expect(new Set(requested.map(row => row.opId)).size).toBe(1);
      await Promise.allSettled(requested.map(row => service.createOrAdopt(row.opId)));
      expect(fake.count("POST")).toBe(1);
      expect(await q().query("select count(*)::int as n from verification_ops")).toEqual([{ n: 1 }]);
      expect(await q().query("select count(*)::int as n from spend")).toEqual([{ n: 1 }]);
    });

    it("concurrent replacements re-read the current face under lock; only one matches and activates", async () => {
      const first = fake.approved(ids.accountId, full); await apply(first);
      const a = fake.approved(ids.accountId, full, { liveness_checks: [{ status: "Approved", matches: [match(first.session_id)], warnings: [] }] });
      const b = fake.approved(ids.accountId, age, { liveness_checks: [{ status: "Approved", age_estimation: 28, matches: [match(first.session_id)], warnings: [] }] });
      await Promise.all([apply(a), apply(b)]);
      const current = await facts();
      expect(current.filter(row => row.kind === "face" && row.activation === "active")).toHaveLength(1);
      expect(current.filter(row => row.kind === "face" && row.activation === "pending_continuity")).toHaveLength(1);
      expect(fake.count("GET")).toBe(3);
    });

    it.each(["withdrawal-first", "checkin-first"])("C23 %s preserves the linearization boundary", async order => {
      const decision = fake.approved(ids.accountId, full); const established = await apply(decision);
      const face = established.evidence.find(row => row.kind === "face")!;
      fake.decisions.set(decision.session_id, { ...decision, status: "Declined" });
      const locked = deferred(), release = deferred();
      const checkin = () => withTx(async tx => {
        await lockForCheckin(tx, ids);
        if (order === "checkin-first") { locked.resolve(); await release.promise; }
        const [eligible] = await tx.query("select id from evidence where id=$1 and activation='active' and provider_status='approved' and invalidated_at is null", [face.id]);
        if (!eligible) return false;
        await tx.query("insert into checkins(event_id,registration_id,kiosk_id,face_evidence_id,method) values($1,$2,$3,$4,'face')", [ids.eventId, ids.registrationId, ids.kioskId, face.id]);
        return true;
      }, database.db);
      const withdraw = () => withTx(async tx => {
        await lockForDecision(tx, ids.accountId);
        if (order === "withdrawal-first") { locked.resolve(); await release.promise; }
        return service.evidence.applyDecision(tx, ids.accountId, decision.session_id);
      }, database.db);
      const first = order === "withdrawal-first" ? withdraw() : checkin();
      await locked.promise;
      const second = order === "withdrawal-first" ? checkin() : withdraw();
      release.resolve(); await Promise.all([first, second]);
      expect(await q().query("select count(*)::int as n from checkins")).toEqual([{ n: order === "checkin-first" ? 1 : 0 }]);
      expect((await facts()).every(row => row.providerStatus === "withdrawn")).toBe(true);
      expect(fake.count("GET")).toBe(2);
    });
  }
});
