import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DiditClient, DiditAuthError, DiditCredits, DiditNoFace, DiditUnavailable, DiditValidation } from "./client.ts";
import { decisionSchema, emailCheckSchema, establishedAt } from "./types.ts";
import { reserve } from "../spend.ts";
import type { Db } from "../db/index.ts";
import { queryable } from "../db/tx.ts";
import { testDatabase, resetDatabase } from "../testing/database.ts";
import created from "./fixtures/session-create.json";
import decision from "./fixtures/decision.json";
import sessions from "./fixtures/sessions-list.json";
import workflow from "./fixtures/workflow.json";
import workflows from "./fixtures/workflows-list.json";
import questionnaire from "./fixtures/questionnaire.json";
import questionnaires from "./fixtures/questionnaires-list.json";
import destination from "./fixtures/webhook-destination.json";
import destinations from "./fixtures/webhook-destinations.json";
import deletion from "./fixtures/session-delete.json";
import emailSend from "./fixtures/email-send.json";
import emailCheck from "./fixtures/email-check.json";
import faces from "./fixtures/face-search.json";
import passive from "./fixtures/passive-liveness.json";
let db: Db, close: () => Promise<void>;
beforeAll(async () => { ({ db, close } = await testDatabase("pglite")); }, 60_000);
beforeEach(() => resetDatabase(db)); afterAll(async () => { await close?.(); });
const scopes = [{ kind: "app/day" as const, id: "test", usdCap: 10 }, { kind: "total" as const, id: "test", usdCap: 10 }];
const mock = (body: unknown, status = 200) => vi.fn<typeof fetch>().mockImplementation(async () => new Response(status === 204 ? null : JSON.stringify(body), { status }));
const client = (fetcher: typeof fetch) => new DiditClient({ apiKey: "TEST-KEY", fetch: fetcher, workflows: { [created.workflow_id]: { kind: "full", maxPriceUsd: 0.23 } } });
describe("typed provider endpoints against synthetic source fixtures", () => {
  it("accepts an Approved email check without email.verified_at (Didit sandbox shape, 2026-10-01)", () => {
    const sandbox = { request_id: "6fb27077-9270-4fd5-9d40-cff0a91026dc", status: "Approved", message: "The verification code is correct.", email: { status: "Approved", email: "guest@example.com", is_breached: false, is_disposable: false, is_undeliverable: false }, vendor_data: null, metadata: null, created_at: "2026-09-30T22:19:52.207906+00:00" };
    const parsed = emailCheckSchema.parse(sandbox);
    expect(parsed.status).toBe("Approved");
  });
  it("accepts deployed face-search responses without total_matches while still validating every match",async()=>{
    const {total_matches:_count,...withoutCount}=faces.face_search;
    const response={...faces,face_search:{...withoutCount,matches:[]}};
    const reservation=()=>reserve({op:"face_search",usdMax:.05,scopes},db);
    const api=client(mock(response));
    expect((await api.faceSearch(new Blob([new Uint8Array([255,216,255])]),await reservation())).face_search.total_matches).toBe(0);
    const invalid=client(mock({...response,face_search:{...withoutCount,matches:[{session_id:"untrusted",similarity_percentage:"99"}]}}));
    await expect(invalid.faceSearch(new Blob(),await reservation())).rejects.toThrow(DiditUnavailable);
  });
  it("uses the official URL for a blank setting and permits only non-production loopback fakes", async () => {
    try {
      vi.stubEnv("DIDIT_API_URL", "");
      const fetcher = mock(sessions);
      await client(fetcher).listSessions();
      expect(String(fetcher.mock.lastCall![0])).toBe("https://verification.didit.me/v3/sessions/");
      const options = { apiKey: "test", fetch: fetcher, baseUrl: "http://127.0.0.1:8123/v3/" };
      await new DiditClient(options).listSessions();
      expect(String(fetcher.mock.lastCall![0])).toBe("http://127.0.0.1:8123/v3/sessions/");
      for (const baseUrl of ["https://example.test/v3/", "http://192.168.0.1/v3/", "http://key@localhost/v3/", "http://localhost/v3/?x=1", "http://localhost/v3/#x"]) {
        expect(() => new DiditClient({ ...options, baseUrl })).toThrow(DiditValidation);
      }
      vi.stubEnv("NODE_ENV", "production");
      expect(() => new DiditClient(options)).toThrow(DiditValidation);
    } finally { vi.unstubAllEnvs(); }
  });
  it("session create/get/list/delete uses confirmed paths and include=events; reservation is single-use", async () => {
    const fetcher = mock(created), api = client(fetcher), reservation = await reserve({ op: "session_full", usdMax: 0.23, scopes }, db);
    await api.createSession({ workflow_id: created.workflow_id, vendor_data: created.vendor_data }, reservation);
    await expect(api.createSession({ workflow_id: created.workflow_id, vendor_data: created.vendor_data }, reservation)).rejects.toThrow("ReservationAlreadyUsed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: "POST", redirect: "error", headers: { "x-api-key": "TEST-KEY" } });
    fetcher.mockImplementation(async () => Response.json(decision)); await api.getSession(created.session_id);
    expect(fetcher.mock.lastCall![0]).toBe(`https://verification.didit.me/v3/session/${created.session_id}/decision/?include=events`);
    fetcher.mockImplementation(async () => Response.json(sessions)); await api.listSessions({ vendor_data: "acct_test", workflow_id: created.workflow_id, offset: 50 });
    expect(String(fetcher.mock.lastCall![0])).toContain("vendor_data=acct_test"); expect(String(fetcher.mock.lastCall![0])).toContain("offset=50");
    fetcher.mockImplementation(async () => Response.json(deletion)); await api.deleteSession(created.session_id, "erase");
    expect(fetcher.mock.lastCall![0]).toBe(`https://verification.didit.me/v3/session/${created.session_id}/delete/`);
    expect(JSON.parse(String(fetcher.mock.lastCall![1]!.body))).toMatchObject({ deletion_instruction: "privacy_erasure", retain_face_embeddings: false });
    fetcher.mockResolvedValue(new Response(null, { status: 404 })); expect(await api.deleteSession(created.session_id)).toEqual({ alreadyDeleted: true, erasureConfirmed: false });
    fetcher.mockResolvedValue(new Response(null, { status: 204 })); expect(await api.deleteSession(created.session_id)).toEqual({ legacyNoContent: true, erasureConfirmed: false });
  });
  it("confirms erasure only for the requested session with no retained template", async () => {
    expect(await client(mock(deletion)).deleteSession(created.session_id)).toMatchObject({ erasureConfirmed: true });
    for (const response of [
      { ...deletion, session_id: "another-session" },
      { ...deletion, face_retention_outcome: "retained_with_user" },
      { ...deletion, face_retention_outcome: "failed_retryable" },
      { ...deletion, biometric_template_uuid: "remaining-template" },
    ]) await expect(client(mock(response)).deleteSession(created.session_id)).rejects.toBeInstanceOf(DiditUnavailable);
  });
  it("management endpoints validate pages versus webhook arrays and expose CRUD methods", async () => {
    const fetcher = mock(workflows), api = client(fetcher);
    expect((await api.listWorkflows()).results).toHaveLength(1);
    fetcher.mockImplementation(async () => Response.json(workflow));
    await api.getWorkflow(workflow.uuid); await api.createWorkflow({ workflow_label: "Renewal", features: [{ feature: "LIVENESS" }] }); await api.patchWorkflow(workflow.uuid, { is_desktop_allowed: true });
    expect(fetcher.mock.lastCall![1]!.method).toBe("PATCH");
    fetcher.mockImplementation(async () => Response.json(questionnaires)); await api.listQuestionnaires();
    fetcher.mockImplementation(async () => Response.json(questionnaire)); await api.getQuestionnaire(questionnaire.questionnaire_id); await api.createQuestionnaire({ title: "Guest", languages: ["en"], default_language: "en", form_elements: [] }); await api.patchQuestionnaire(questionnaire.questionnaire_id, { title: "Guest" });
    fetcher.mockResolvedValue(new Response(null, { status: 204 })); await api.deleteQuestionnaire(questionnaire.questionnaire_id);
    fetcher.mockImplementation(async () => Response.json(destinations)); expect(await api.listWebhookDestinations()).toHaveLength(1);
    fetcher.mockImplementation(async () => Response.json(destination)); await api.getWebhookDestination(destination.uuid); await api.createWebhookDestination({ label: "Events", url: destination.url }); await api.patchWebhookDestination(destination.uuid, { enabled: false });
    fetcher.mockResolvedValue(new Response(null, { status: 204 })); await api.deleteWebhookDestination(destination.uuid);
    expect(String(fetcher.mock.lastCall![0])).toContain("webhook/destinations/");
  });
  it("OTP send requires spend, check sends email/code and does not enable paid enrichment", async () => {
    const fetcher = mock(emailSend), api = client(fetcher);
    const reservation = await reserve({ op: "email_send", usdMax: 0.03, scopes }, db);
    expect((await api.sendEmailOtp({ email: "alex@example.test" }, reservation)).status).toBe("Success");
    fetcher.mockImplementation(async () => Response.json(emailCheck)); expect((await api.checkEmailOtp("alex@example.test", "123456")).status).toBe("Approved");
    expect(JSON.parse(String(fetcher.mock.lastCall![1]!.body))).toEqual({ email: "alex@example.test", code: "123456", enable_social: false, enable_enrichment: false });
  });
  it("sign-in codes go through otpApiKey when set (staging: sandbox faces, production codes); everything else keeps apiKey", async () => {
    const fetcher = mock(emailSend), api = new DiditClient({ apiKey: "SANDBOX-KEY", otpApiKey: "OTP-KEY", fetch: fetcher as unknown as typeof fetch });
    const reservation = await reserve({ op: "email_send", usdMax: 0.03, scopes }, db);
    await api.sendEmailOtp({ email: "alex@example.test" }, reservation);
    expect(fetcher.mock.lastCall![1]).toMatchObject({ headers: { "x-api-key": "OTP-KEY" } });
    fetcher.mockImplementation(async () => Response.json(emailCheck)); await api.checkEmailOtp("alex@example.test", "123456");
    expect(fetcher.mock.lastCall![1]).toMatchObject({ headers: { "x-api-key": "OTP-KEY" } });
    fetcher.mockImplementation(async () => new Response(null, { status: 204 })); await api.deleteWebhookDestination("abc");
    expect(fetcher.mock.lastCall![1]).toMatchObject({ headers: { "x-api-key": "SANDBOX-KEY" } });
  });
  it.each(["Failed", "Expired or Not Found", "Declined"])("OTP HTTP 200 %s stays a failure result, including null email", async status => {
    const api = client(mock({ request_id: "ephemeral-failure-id", status, email: null }));
    expect((await api.checkEmailOtp("alex@example.test", "wrong")).status).toBe(status);
  });
  it("biometric calls use multipart and disable persistence; wrong reservation prevents network call", async () => {
    const fetcher = mock(faces), api = client(fetcher), image = new Blob(["synthetic"], { type: "image/jpeg" });
    const faceSpend = await reserve({ op: "face_search", usdMax: 0.05, scopes }, db);
    await expect(api.passiveLiveness(image, faceSpend)).rejects.toThrow("InvalidSpendReservation"); expect(fetcher).not.toHaveBeenCalled();
    await api.faceSearch(image, faceSpend);
    expect((fetcher.mock.lastCall![1]!.body as FormData).get("save_api_request")).toBe("false");
    expect(fetcher.mock.lastCall![1]!.headers).not.toHaveProperty("content-type");
    fetcher.mockImplementation(async () => Response.json(passive));
    await api.passiveLiveness(image, await reserve({ op: "passive_liveness", usdMax: 0.05, scopes }, db));
  });
  it.each([[403, { detail: "denied" }, DiditAuthError], [401, { detail: "invalid key" }, DiditAuthError], [403, { error: "You don't have enough credits" }, DiditCredits], [400, { detail: "not enough credits" }, DiditCredits], [400, { field: "invalid" }, DiditValidation], [503, { detail: "PRIVATE" }, DiditUnavailable]] as const)("maps %s safely", async (status, body, expected) => {
    await expect(client(mock(body, status)).listSessions()).rejects.toBeInstanceOf(expected);
    try { await client(mock(body, status)).listSessions(); } catch (error) { expect(String(error)).not.toContain("PRIVATE"); }
  });
  it("maps no-face separately and timeouts remain reserved/uncertain", async () => {
    const image = new Blob(["synthetic"]), reservation = await reserve({ op: "face_search", usdMax: 0.05, scopes }, db);
    await expect(client(mock({ detail: "No face detected" }, 400)).faceSearch(image, reservation)).rejects.toBeInstanceOf(DiditNoFace);
    const fetcher: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => { init!.signal!.addEventListener("abort", () => reject(new Error("timeout"))); });
    const api = new DiditClient({ apiKey: "key", fetch: fetcher, faceTimeoutMs: 10 });
    const timeoutReservation = await reserve({ op: "face_search", usdMax: 0.05, scopes }, db);
    await expect(api.faceSearch(image, timeoutReservation)).rejects.toMatchObject({ uncertain: true });
    expect((await queryable(db).query<{ state: string }>("select state from spend where id=$1", [timeoutReservation.id]))[0]!.state).toBe("reserved");
  });
  it("fails closed on unknown responses, workflows, paths and missing approval timestamp", async () => {
    await expect(client(mock({ unexpected: true })).listSessions()).rejects.toBeInstanceOf(DiditUnavailable);
    await expect(client(mock({ request_id: "id", status: "Approved", email: null })).checkEmailOtp("alex@example.test", "123456")).rejects.toBeInstanceOf(DiditUnavailable);
    expect(() => client(mock({})).getDecision("../../evil")).toThrow(DiditValidation);
    const parsed = decisionSchema.parse(decision); expect(establishedAt(parsed)?.toISOString()).toBe("2026-09-29T10:03:00.000Z");
    expect(establishedAt({ ...parsed, events: undefined })).toBeNull();
    expect(establishedAt({ ...parsed, events: parsed.events?.map(e => ({ ...e, feature_step: "LIVENESS" })) })).toBeNull();
  });
});
