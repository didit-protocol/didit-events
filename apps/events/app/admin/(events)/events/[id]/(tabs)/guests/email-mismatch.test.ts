import { bootstrapApiToken } from "@didit-events/core/api-tokens";
import { requireStaffByToken } from "@didit-events/core/identity/tokens";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { auth, databaseSuite } from "../../../../../../../src/testing/b4";
import { queryable, withTx } from "@didit-events/core/db/tx";
import { evidenceService } from "@didit-events/core";
import { getVerificationRuntime } from "@didit-events/core/verification/runtime";
import { fakeDiditServer } from "@didit-events/core/didit/fake-server";
import type { DiditDecision } from "@didit-events/core/didit";
import { resolveEmailMismatchAction } from "./actions";
import { allGuests, getGuestDetail } from "./data";

// Only the framework auth/cache adapters are mocked by databaseSuite; evidence, provider and SQL are real.
const state = databaseSuite({legacy:true}), workflow = randomUUID(), accepted = "ana.other@example.test";
let fake: Awaited<ReturnType<typeof fakeDiditServer>>, decision: DiditDecision, verificationId: string;
const q = () => queryable(state.db);
const apply = () => withTx(tx => evidenceService.applyDecision(tx, state.accountId, decision.session_id), state.db);
const accept = () => resolveEmailMismatchAction(state.eventId, state.registrationId, "accept", undefined, { session: decision.session_id, email: accepted });
const audit = () => q().query("select actor,action,target,data from audit where action='verification.email_accepted'");
beforeAll(async () => {
  fake = await fakeDiditServer();
  for (const [key, value] of Object.entries({ DIDIT_API_KEY: "fixture-key", DIDIT_API_URL: fake.url, DIDIT_WORKFLOW_ID: workflow,
    DIDIT_RENEWAL_WORKFLOW_ID: "", DIDIT_AGE_WORKFLOW_ID: "", APP_URL: "https://events.example.test",
    SESSION_SECRET: "i1-email-fixture-secret-over-thirty-two-characters" })) vi.stubEnv(key, value);
});
afterAll(async () => { await fake?.close(); vi.unstubAllEnvs(); });
beforeEach(async () => {
  fake.decisions.clear(); fake.calls.length = 0;
  const sessionId = randomUUID();
  await q().query(`insert into sessions(id,token_hash,principal,auth_method,staff_email,expires_at)
    values($1,$2,'staff','oidc_google',$3,clock_timestamp()+interval '1 day')`, [sessionId, randomUUID(), auth.staff!.email]);
  auth.staff = { ...auth.staff!, sessionId };
  decision = fake.approved(state.accountId, workflow, {
    email_verifications: [{ status: "Approved", email: accepted, verified_at: new Date(Date.now() - 60_000).toISOString() }],
  });
  verificationId = (await apply()).verification.id;
});

it("accepts from A-16 through the evidence service, persists staff audit, and derives verified without changing admission or account email", async () => {
  expect((await getGuestDetail(state.eventId, state.registrationId))?.mismatch).toEqual({ invited: "ana@example.test", verified: accepted });
  expect((await allGuests(state.eventId))[0]?.status).toBe("in-review");
  expect(await accept()).toEqual({ ok: true });
  const [stored] = await q().query("select status,provider_status,policy_state,policy_reason,email_matches,accepted_email,email_accepted_by,email_accepted_at from verifications where id=$1", [verificationId]);
  expect(stored).toEqual({ status: "approved", provider_status: "Approved", policy_state: null, policy_reason: null,
    email_matches: false, accepted_email: accepted, email_accepted_by: auth.staff!.email, email_accepted_at: expect.any(Date) });
  expect(await q().query("select email from accounts where id=$1", [state.accountId])).toEqual([{ email: "ana@example.test" }]);
  expect(await q().query("select admission from registrations where id=$1", [state.registrationId])).toEqual([{ admission: "approved" }]);
  const evidence = await q().query("select * from evidence where verification_id=$1 order by kind", [verificationId]);
  expect(evidence).toHaveLength(2);
  expect(evidence.every(row => row.activation === "active" && row.provider_status === "approved")).toBe(true);
  expect(evidence.find(row => row.kind === "identity")?.value).toMatchObject({ email: accepted });
  expect(await audit()).toEqual([{ actor: auth.staff!.email, action: "verification.email_accepted", target: verificationId,
    data: { registrationId: state.registrationId, verifiedEmail: accepted, reason: "Verified email mismatch accepted by staff" } }]);
  expect((await allGuests(state.eventId))[0]?.status).toBe("verified");
  expect((await getGuestDetail(state.eventId, state.registrationId))?.mismatch).toBeUndefined();
  // Retry + later authoritative fetch preserve the decision and the original evidence validity.
  expect(await accept()).toEqual({ ok: true });
  await q().query("update verifications set next_fetch_at=clock_timestamp() where id=$1", [verificationId]);
  await getVerificationRuntime().reconcile();
  expect(await audit()).toHaveLength(1);
  expect(await q().query("select * from evidence where verification_id=$1 order by kind", [verificationId])).toEqual(evidence);
  expect((await allGuests(state.eventId))[0]?.status).toBe("verified");
  expect(fake.count("GET", `/v3/session/${decision.session_id}/decision/`)).toBe(4);
});

it.each(["missing liveness", "face continuity"])("acceptance still enforces %s", async requirement => {
  if (requirement === "missing liveness") {
    decision = { ...decision, liveness_checks: [] }; fake.decisions.set(decision.session_id, decision);

  } else {
    await q().query("update accounts set has_face_history=true where id=$1", [state.accountId]);
  }
  expect(await accept()).toEqual({ ok: true });
  expect(await audit()).toHaveLength(1);
  expect((await getGuestDetail(state.eventId, state.registrationId))?.mismatch).toBeUndefined();
  expect((await allGuests(state.eventId))[0]?.status).not.toBe("verified");
  expect((await evidenceService.summary(state.accountId, state.eventId)).eligibility.eligible).toBe(false);
});

it("serializes simultaneous accepts into one audit and one set of evidence", async () => {
  expect(await Promise.all([accept(), accept()])).toEqual([{ ok: true }, { ok: true }]);
  expect(await audit()).toHaveLength(1);
  expect(await q().query("select id from evidence")).toHaveLength(2);
  expect((await allGuests(state.eventId))[0]?.status).toBe("verified");
});

it("cannot apply one event's drawer action to another event", async () => {
  expect(await resolveEmailMismatchAction(state.otherId, state.registrationId, "accept")).toEqual({ error: "conflict" });
  expect(await audit()).toEqual([]);
  expect(await q().query("select id from evidence")).toEqual([]);
});

it("requires the exact email and session displayed in the drawer", async () => {
  for (const reviewed of [undefined, { session: randomUUID(), email: accepted }, { session: decision.session_id, email: "stale@example.test" }]) {
    expect(await resolveEmailMismatchAction(state.eventId, state.registrationId, "accept", undefined, reviewed)).toEqual({ error: "conflict" });
  }
  expect(await audit()).toEqual([]); expect(await q().query("select id from evidence")).toEqual([]);
});

it.each(["email changed", "approval withdrawn"])("rolls back stale acceptance when the provider reports %s", async change => {
  fake.decisions.set(decision.session_id, change === "email changed" ? { ...decision, email_verifications: decision.email_verifications!.map(email => ({ ...email, email: "changed@example.test" })) } : { ...decision, status: "Declined" });
  expect(await accept()).toEqual({ error: "conflict" });
  expect(await audit()).toEqual([]);
  expect(await q().query("select accepted_email,email_accepted_by,email_accepted_at from verifications")).toEqual([{ accepted_email: null, email_accepted_by: null, email_accepted_at: null }]);
  expect(await q().query("select id from evidence")).toEqual([]);
});

it.each(["staff disabled", "session revoked"])("rechecks %s in the evidence transaction", async change => {
  if (change === "staff disabled") await q().query("update staff set disabled_at=clock_timestamp() where email=$1", [auth.staff!.email]);
  else await q().query("update sessions set revoked_at=clock_timestamp() where id=$1", [auth.staff!.sessionId]);
  await expect(accept()).rejects.toThrow("StaffAuthenticationRequired");
  expect(await audit()).toEqual([]); expect(await q().query("select id from evidence")).toEqual([]);
});

it("does not carry an acceptance to a changed email or override a later withdrawal", async () => {
  expect(await accept()).toEqual({ ok: true });
  fake.decisions.set(decision.session_id, { ...decision, status: "Declined" });
  await apply();
  expect((await evidenceService.summary(state.accountId, state.eventId)).eligibility.eligible).toBe(false);
  fake.decisions.set(decision.session_id, { ...decision, email_verifications: decision.email_verifications!.map(email => ({ ...email, email: "changed@example.test" })) });
  await apply();
  expect((await getGuestDetail(state.eventId, state.registrationId))?.mismatch?.verified).toBe("changed@example.test");
  expect((await allGuests(state.eventId))[0]?.status).toBe("in-review");
  expect(await audit()).toHaveLength(1);
});

it("email acceptance cannot keep expired face evidence eligible", async () => {
  expect(await accept()).toEqual({ok:true});
  await q().query("update evidence set valid_until=clock_timestamp()-interval '1 second' where kind='face'");
  expect((await evidenceService.summary(state.accountId,state.eventId)).eligibility.eligible).toBe(false);
});
it("later policy edits do not change the accepted policy of a legacy guest", async () => {
  await q().query(`update events set checks='{"version":1,"required":[],"max_age":{},"age_min":21}' where id=$1`,[state.eventId]);
  expect(await accept()).toEqual({ok:true});
  expect((await evidenceService.summary(state.accountId,state.eventId)).eligibility.eligible).toBe(true);
});

it("accepts evidence review by token principal and audits the staff email while rejecting a revoked token", async () => {
  const issued=await bootstrapApiToken(auth.staff!.email,"evidence",state.db),actor=await requireStaffByToken(issued.token,undefined,state.db);
  expect(actor.sessionId).toBe("");
  expect(await evidenceService.acceptVerifiedEmail(actor,state.registrationId,verificationId,accepted)).toBe(true);
  expect(await audit()).toEqual([expect.objectContaining({actor:actor.email})]);
  await q().query("update api_tokens set revoked_at=clock_timestamp() where id=$1",[actor.apiTokenId]);
  await expect(evidenceService.acceptVerifiedEmail(actor,state.registrationId,verificationId,accepted)).rejects.toThrow("StaffAuthenticationRequired");
  expect(await audit()).toHaveLength(1);
});
