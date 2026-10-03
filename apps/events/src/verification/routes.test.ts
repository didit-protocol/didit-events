import type * as ModelRuntime from "@didit-events/core/verification/model-runtime";
import { createModelServices } from "@didit-events/core/verification/model-runtime";
import { FACE_WORKFLOW_ID } from "@didit-events/core/domain/event-model";
import { guestFixture,requestFixture } from "../../../../packages/core/src/testing/model";
import { Requests } from "@didit-events/core/admission/requests";
import { createIdentityServices } from "@didit-events/core/identity";
import { csrfToken } from "../auth/browser";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { testDatabase, resetDatabase, seed } from "@didit-events/core/testing/database";
import { DiditClient, queryable, withTx, signV2, type Db, type Session } from "@didit-events/core";
import { fakeDiditServer } from "@didit-events/core/didit/fake-server";
import { VerificationLifecycle } from "@didit-events/core/verification/index";
import type * as Core from "@didit-events/core";
import type * as Policy from "@didit-events/core/http/policy";

const state = vi.hoisted(() => ({ db: undefined as Db | undefined, service: undefined as VerificationLifecycle | undefined, headers: new Headers(), session: null as Session | null, identity: undefined as ReturnType<typeof createIdentityServices> | undefined, csrf: "", model: undefined as ReturnType<typeof createModelServices> | undefined }));
vi.mock("@didit-events/core/verification/model-runtime", async original => ({...await original<typeof ModelRuntime>(),modelServices:()=>state.model!}));
vi.mock("../auth/runtime", () => ({ get identity() { return state.identity!; } }));
vi.mock("next/headers", () => ({ headers: async () => state.headers, cookies: async () => ({ get: (name: string) => {
  const raw = state.headers.get("cookie")?.split("; ").find(part => part.startsWith(`${name}=`)); return raw ? { value: raw.slice(name.length + 1) } : undefined;
} }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`NEXT_REDIRECT;${url}`); } }));
vi.mock("@didit-events/core", async original => {
  const actual = await original<typeof Core>();
  return { ...actual, get authService(){return state.identity!.auth;}, getVerificationRuntime: () => state.service!, sessionService: { ...actual.sessionService, resolve: async (cookie: string) => state.identity!.sessions.resolve(cookie) } };
});
vi.mock("@didit-events/core/http/policy", async original => {
  const actual = await original<typeof Policy>();
  return { ...actual, webhookAuth: (request: Request, secret: string) => actual.webhookAuth(request, secret, { db: state.db }) };
});
const { POST: webhook } = await import("../../app/api/webhooks/didit/route");
const { POST: renew } = await import("../../app/api/me/verification/renew/route");
const { POST: recover } = await import("../../app/api/admin/verifications/[id]/recover/route");
const { startVerification } = await import("../../app/e/[slug]/data");
const { getInvite, verificationUrlForLink } = await import("../../app/e/[slug]/v/[token]/data");
const { getOutcome } = await import("../../app/e/[slug]/done/data");
const { verifyAction } = await import("../../app/e/[slug]/actions");
const { startFromLinkAction } = await import("../../app/e/[slug]/v/[token]/actions");

let database: Awaited<ReturnType<typeof testDatabase>>, fake: Awaited<ReturnType<typeof fakeDiditServer>>, ids: Record<keyof Awaited<ReturnType<typeof seed>>,string>;
const full = randomUUID(), renewal = randomUUID(), origin = "https://events.example.test";
beforeAll(async () => { database = await testDatabase("pglite"); state.db = database.db; fake = await fakeDiditServer(); }, 60_000);
afterAll(async () => { await fake?.close(); await database?.close(); });
afterEach(() => vi.unstubAllEnvs());
beforeEach(async () => {
  await resetDatabase(database.db); ids = await seed(database.db); fake.decisions.clear(); fake.calls.length = 0;
  state.headers = new Headers(); state.session = null;
  vi.stubEnv("SESSION_SECRET", "verification-test-secret-over-32-characters");
  state.identity = createIdentityServices({ db: database.db, secret: "verification-test-secret-over-32-characters", appUrl: origin });
  vi.stubEnv("APP_URL", origin); vi.stubEnv("DIDIT_WEBHOOK_SECRET", "fixture-secret");
  const workflows = { [full]: { kind: "full" as const, maxPriceUsd: 0.23 }, [renewal]: { kind: "renewal" as const, maxPriceUsd: 0.1 } };
  state.service = new VerificationLifecycle({ db: database.db, client: new DiditClient({ apiKey: "fake", workflows, fetch: fake.fetch }), workflows,
    sessions: { resolve: async (cookie: string) => state.identity!.sessions.resolve(cookie) }, appUrl: origin, appDailyCapUsd: 100, eventDailyCapUsd: 10, totalCapUsd: 100 });
  state.model=createModelServices({...state.service.options,client:state.service.options.client as DiditClient});
});
const q = () => queryable(database.db);
const consent={disclosureVersion:"events-profile-v2",shareProfileWithHosts:true,eventConsentAccepted:true,acceptedChecks:["face"]} as const;
async function prepareRenewal() {
  const guest=await guestFixture(database.db);
  await q().query("update events set starts_at=clock_timestamp()+interval '2 days',ends_at=clock_timestamp()+interval '3 days',status='published' where id=$1",[ids.eventId]);
  const result=await new Requests(database.db).submitRequest(guest,ids.eventId,await requestFixture(database.db,guest,ids.eventId));
  ids.accountId=guest.accountId;ids.registrationId=result.registration.id;
  await q().query("update registrations set admission='approved' where id=$1",[ids.registrationId]);
  await q().query("update accounts set has_face_history=true where id=$1",[ids.accountId]);
  await q().query("update evidence set established_at=clock_timestamp()-interval '181 days',valid_until=clock_timestamp()-interval '1 second' where account_id=$1",[ids.accountId]);
}

async function login() {
  const result = await state.identity!.sessions.rotate({ principal: "guest", accountId: ids.accountId, authenticatedAt: new Date(), authMethod: "email_otp" });
  state.session = result.session;
  state.csrf = csrfToken(result.cookie, "verification-test-secret-over-32-characters");
  state.headers = new Headers({ origin, cookie: `__Host-sid=${result.cookie}; __Host-csrf=${state.csrf}` });
}
const form = () => { const body = new FormData(); body.set("csrf", state.csrf); return body; };
const browserRequest = (path: string, input = {}, csrf = state.csrf) => new Request(origin + path, { method: "POST", headers: { ...Object.fromEntries(state.headers), "x-csrf": csrf, "content-type": "application/json" }, body: JSON.stringify(input) });

it("webhook HTTP acknowledges only persisted authenticated bodies, with no provider I/O", async () => {
  const payload = { event_id: randomUUID(), timestamp: Math.floor(Date.now() / 1000), webhook_type: "status.updated", session_id: randomUUID(), vendor_data: `acct_${ids.accountId}`, workflow_id: full };
  const raw = JSON.stringify(payload), request = () => new Request(origin + "/api/webhooks/didit", { method: "POST", headers: { "content-type": "application/json", "x-timestamp": String(payload.timestamp), "x-signature-v2": signV2(raw, "fixture-secret") }, body: raw });
  expect((await webhook(request())).status).toBe(200); expect((await webhook(request())).status).toBe(200);
  expect(await q().query("select count(*)::int as n from inbox")).toEqual([{ n: 1 }]);
  expect(await q().query("select processed_at from inbox")).toEqual([{ processed_at: null }]);
  const invalid = request(); invalid.headers.set("x-signature-v2", "tampered"); expect((await webhook(invalid)).status).toBe(401);
  expect(fake.calls).toHaveLength(0);
});

it("expired accepted requests enforce CSRF and account binding before one liveness renewal; callback is display-only", async () => {
  await prepareRenewal();
  const link = await state.service!.issueLink(ids.accountId, ids.registrationId);
  expect((await getInvite(ids.eventId, link.token))?.event.slug).toBe(ids.eventId);
  expect((await getInvite(ids.eventId, link.token))?.state).toBe("valid");
  expect(await startVerification(ids.eventId)).toEqual({ signIn: true });
  expect(await getOutcome(ids.eventId, randomUUID())).toBeNull();
  await login();
  await expect(startVerification(ids.eventId, new FormData())).rejects.toThrow("BrowserSessionAndCsrfRequired");
  state.headers.set("origin", "https://attacker.test");
  await expect(verificationUrlForLink(ids.eventId, link.token, form())).rejects.toThrow("BrowserOriginRequired");
  expect(fake.count("POST")).toBe(0); expect(await q().query("select count(*)::int as n from verification_ops")).toEqual([{ n: 0 }]);
  state.headers.set("origin", origin);
  const url = await verificationUrlForLink(ids.eventId, link.token, form());
  expect(url).toEqual({ url: expect.stringMatching(/^https:\/\/verify.didit.me\/session\//) });
  expect(fake.count("POST")).toBe(1);
  const remote = [...fake.decisions.values()][0]!;
  const fetched=fake.calls.filter(call => /\/decision\/$/.test(call.path)).length;
  expect((await getOutcome(ids.eventId, remote.session_id))?.state).toBe("not_finished");
  expect(fake.calls.filter(call => /\/decision\/$/.test(call.path))).toHaveLength(fetched);
  const [anchor]=await q().query<{didit_session_id:string}>("select didit_session_id from verifications where account_id=$1 and didit_session_id<>$2",[ids.accountId,remote.session_id]);
  const approved={...remote,status:"Approved" as const,liveness_checks:[{status:"Approved",matches:[{session_id:anchor!.didit_session_id,similarity_percentage:99,is_blocklisted:false,api_service:null}],warnings:[]}],events:[{event_type:"SESSION_STATUS_CHANGED",feature_step:null,created_at:new Date().toISOString(),details:{current_status:"Approved"}}]};
  fake.decisions.set(remote.session_id,approved);
  await withTx(tx => state.service!.evidence.applyDecision(tx, ids.accountId, approved.session_id), database.db);
  expect((await getOutcome(ids.eventId, approved.session_id))?.state).toBe("approved");
  expect(await startVerification(ids.eventId, form())).toEqual({url:`${origin}/me/events/${ids.eventId}`});
  expect(fake.count("POST","/v3/session/")).toBe(1);
  expect(await q().query("select kind,activation from evidence order by established_at")).toEqual([{kind:"face",activation:"superseded"},{kind:"face",activation:"active"}]);
});

it("renewal and admin recovery endpoints apply C14 and principal policies without trusting the body", async () => {
  await prepareRenewal();
  await login();
  expect((await renew(browserRequest("/api/me/verification/renew", {}, "bad"))).status).toBe(403);
  expect(fake.count("POST")).toBe(0);
  expect((await renew(browserRequest("/api/me/verification/renew", {accountId:randomUUID(),consent}))).status).toBe(422);
  const response = await renew(browserRequest("/api/me/verification/renew", {consent}));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await q().query("select account_id,kind,workflow_id,vendor_data from verification_ops")).toEqual([{ account_id: ids.accountId, kind: "renewal",workflow_id:FACE_WORKFLOW_ID,vendor_data:(await q().query<{email:string}>("select email from accounts where id=$1",[ids.accountId]))[0]!.email }]);
  const [verification] = await q().query<{ id: string }>("select id from verifications limit 1");
  const recovered = await recover(browserRequest(`/api/admin/verifications/${verification!.id}/recover`, { reason: "Pretend admin" }), { params: Promise.resolve({ id: verification!.id }) });
  expect(recovered.status).toBe(403);
  expect(await q().query("select count(*)::int as n from audit")).toEqual([{ n: 0 }]);
  expect(await q().query("select count(*)::int as n from outbox where kind='M-03'")).toEqual([{ n: 0 }]);
  expect(fake.count("POST")).toBe(1);
});

it("both start actions preserve a typed pending result and redirect to retry UI, then to the shared hosted URL", async () => {
  await prepareRenewal();
  await login();
  const service = state.service!, link = await service.issueLink(ids.accountId, ids.registrationId);
  // The lifecycle's real concurrent-owner deadline is covered in the Postgres suite.
  const start = vi.spyOn(service, "startForRegistration").mockResolvedValue({ state: "pending", retryAfterMs: 1000 });
  const body = form(); body.set("slug", ids.eventId); body.set("token", link.token);
  try {
    expect(await verificationUrlForLink(ids.eventId, link.token, body)).toEqual({ state: "pending", retryAfterMs: 1000 });
    await expect(verifyAction(body)).rejects.toThrow(`NEXT_REDIRECT;/e/${ids.eventId}?preparing=`);
    await expect(startFromLinkAction(body)).rejects.toThrow(`NEXT_REDIRECT;/e/${ids.eventId}/v/${link.token}?preparing=`);
    expect(await q().query("select state,attempts from verification_ops")).toEqual([]);
    expect(fake.count("POST")).toBe(0);
  } finally { start.mockRestore(); }
  await expect(startFromLinkAction(body)).rejects.toThrow("NEXT_REDIRECT;https://verify.didit.me/session/");
  const remote = [...fake.decisions.keys()][0]!;
  await expect(verifyAction(body)).rejects.toThrow(`NEXT_REDIRECT;https://verify.didit.me/session/${remote}`);
  expect(await q().query("select state,attempts from verification_ops")).toEqual([{ state: "active", attempts: 1 }]);
  expect(fake.count("POST", "/v3/session/")).toBe(1);
});
