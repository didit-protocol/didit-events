import { z } from "zod";
import { claimReservation,MAX_PRICE_USD,type BillableOp,type SpendReservation } from "../spend.ts";
import { createdSessionSchema,decisionSchema,deletionSchema,emailCheckSchema,emailSendSchema,faceSearchSchema,pageSchema,passiveLivenessSchema,questionnaireListItemSchema,questionnaireSchema,sessionListItemSchema,webhookDestinationSchema,workflowSchema,type CreateSessionInput,type DeleteSessionResult,type EmailSendInput,type QuestionnaireInput,type SessionFilters,type WebhookDestinationInput,type WorkflowInput } from "./types.ts";
export class DiditError extends Error { readonly status: number; readonly uncertain: boolean; constructor(name: string, status: number, uncertain = false) { super(name); this.name = name; this.status = status; this.uncertain = uncertain; } }
export class DiditAuthError extends DiditError { constructor() { super("DiditAuthError", 403); } }
export class DiditCredits extends DiditError { constructor() { super("DiditCredits", 403); } }
export class DiditValidation extends DiditError { constructor() { super("DiditValidation", 400); } }
export class DiditNoFace extends DiditError { constructor() { super("DiditNoFace", 400); } }
export class DiditUnavailable extends DiditError { constructor() { super("DiditUnavailable", 503, true); } }
export class DiditNotFound extends DiditError { constructor() { super("DiditNotFound", 404); } }
export interface DiditClientOptions {
  apiKey: string;
  /**
   * Key of the app that sends and checks sign-in codes, when it differs from `apiKey`. Staging verifies faces on the
   * Didit sandbox, whose email check approves any code under a new request id (sign-in can never match), so it sends
   * codes through the production app instead. Unset = `apiKey`.
   */
  otpApiKey?: string;
  fetch?: typeof fetch;
  /** Optional loopback provider for local integration; production always uses Didit. */
  baseUrl?: string;
  timeoutMs?: number;
  faceTimeoutMs?: number;
  /** Coordinator-provisioned workflow IDs and their actual maximum prices. Required for session creation. */
  workflows?: Readonly<Record<string, { kind: "full" | "renewal" | "age" | "extras"; maxPriceUsd: number }>>;
}
const BASE = "https://verification.didit.me/v3/";
const segment = (id: string): string => { if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new DiditValidation(); return encodeURIComponent(id); };
function search(filters: object): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined) query.set(key, String(value));
  return query.size ? `?${query}` : "";
}
export class DiditClient {
  private options: DiditClientOptions;
  private base: string;
  constructor(options: DiditClientOptions) {
    if (!options.apiKey) throw new DiditAuthError();
    this.options = options;
    const base = new URL(options.baseUrl || process.env.DIDIT_API_URL || BASE);
    if (base.href !== BASE && (process.env.NODE_ENV === "production" || base.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) throw new DiditValidation();
    if (base.username || base.password || base.search || base.hash || !base.pathname.endsWith("/")) throw new DiditValidation();
    this.base = base.href;
  }
  private async request<T>(method: string, path: string, schema: z.ZodType<T>, body?: object | FormData, timeoutMs = this.options.timeoutMs ?? 10_000, deletion = false): Promise<T> {
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(this.base + path, { method, headers: { "x-api-key": this.options.apiKey, ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs), redirect: "error", cache: "no-store" });
    } catch { throw new DiditUnavailable(); }
    if (deletion && response.status === 404) return { alreadyDeleted: true, erasureConfirmed: false } as T;
    if (response.status === 204) {
      if (deletion) return { legacyNoContent: true, erasureConfirmed: false } as T;
      const empty = schema.safeParse(undefined);
      if (method === "DELETE" && empty.success) return empty.data;
      throw new DiditUnavailable();
    }
    let json: unknown;
    try { json = await response.json(); } catch {
      if ([401, 403].includes(response.status)) throw new DiditAuthError();
      if (response.status === 400) throw new DiditValidation();
      throw new DiditUnavailable();
    }
    if (!response.ok) {
      const detail = json && typeof json === "object" ? JSON.stringify(json).slice(0, 4000).toLowerCase() : "";
      if ([400, 403].includes(response.status) && /not enough credits|insufficient.*(credit|balance)|enough credits/.test(detail)) throw new DiditCredits();
      if ([401, 403].includes(response.status)) throw new DiditAuthError();
      if (response.status === 400 && path === "face-search/" && /no face/.test(detail)) throw new DiditNoFace();
      if (response.status === 400) throw new DiditValidation();
      if (response.status === 404) throw new DiditNotFound();
      throw new DiditUnavailable();
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      // Field paths only (never values): a provider contract drift must be diagnosable from logs.
      console.error(JSON.stringify({ event: "didit.response_schema_mismatch", fields: { path, issues: parsed.error.issues.slice(0, 5).map(i => `${i.path.join(".")}:${i.code}`) } }));
      throw new DiditUnavailable();
    }
    return parsed.data;
  }
  registerVerifiedWorkflow(id: string, maxPriceUsd: number, kind: "renewal" | "extras") {
    if (!Number.isFinite(maxPriceUsd) || maxPriceUsd <= 0) throw new DiditValidation();
    this.options = { ...this.options, workflows: { ...this.options.workflows, [id]: { kind, maxPriceUsd } } };
  }
  async createSession(input: CreateSessionInput, reservation: SpendReservation) {
    const workflow = this.options.workflows?.[input.workflow_id];
    if (!workflow || !Number.isFinite(workflow.maxPriceUsd) || workflow.maxPriceUsd <= 0) throw new DiditValidation();
    const op: BillableOp = `session_${workflow.kind}`;
    await claimReservation(reservation, op, Math.max(workflow.maxPriceUsd, ["age", "extras"].includes(workflow.kind) ? 0 : MAX_PRICE_USD[op as "session_full" | "session_renewal"]));
    return this.request("POST", "session/", createdSessionSchema, input);
  }
  getSession(id: string) { return this.getDecision(id); }
  getDecision(id: string) { return this.request("GET", `session/${segment(id)}/decision/?include=events`, decisionSchema); }
  listSessions(filters: SessionFilters = {}) { return this.request("GET", `sessions/${search(filters)}`, pageSchema(sessionListItemSchema)); }
  /** Unknown deletion semantics preserve the tombstone for B2 manual/provider confirmation. */
  async deleteSession(id: string, instructionId?: string): Promise<DeleteSessionResult> {
    const result = await this.request("DELETE", `session/${segment(id)}/delete/`, deletionSchema, { deletion_instruction: "privacy_erasure", retain_face_embeddings: false, instruction_id: instructionId }, undefined, true);
    // The transport also returns explicit acknowledgments for legacy 204 and absent 404 responses.
    if ("alreadyDeleted" in result || "legacyNoContent" in result) return result as DeleteSessionResult;
    if (result.session_id !== id || result.face_retention_outcome === "retained_with_user" || result.face_retention_outcome === "failed_retryable" || result.biometric_template_uuid) throw new DiditUnavailable();
    return { ...result, erasureConfirmed: true };
  }
  listWorkflows(page: { limit?: number; offset?: number } = {}) { return this.request("GET", `workflows/${search(page)}`, pageSchema(workflowSchema)); }
  getWorkflow(id: string) { return this.request("GET", `workflows/${segment(id)}/`, workflowSchema); }
  createWorkflow(input: WorkflowInput) { return this.request("POST", "workflows/", workflowSchema, input); }
  patchWorkflow(id: string, input: Partial<WorkflowInput>) { return this.request("PATCH", `workflows/${segment(id)}/`, workflowSchema, input); }
  listQuestionnaires(page: { limit?: number; offset?: number } = {}) { return this.request("GET", `questionnaires/${search(page)}`, pageSchema(questionnaireListItemSchema)); }
  getQuestionnaire(id: string) { return this.request("GET", `questionnaires/${segment(id)}/`, questionnaireSchema); }
  createQuestionnaire(input: QuestionnaireInput) { return this.request("POST", "questionnaires/", questionnaireSchema, input); }
  patchQuestionnaire(id: string, input: Partial<QuestionnaireInput>) { return this.request("PATCH", `questionnaires/${segment(id)}/`, questionnaireSchema, input); }
  deleteQuestionnaire(id: string) { return this.request("DELETE", `questionnaires/${segment(id)}/`, z.void()); }
  listWebhookDestinations() { return this.request("GET", "webhook/destinations/", z.array(webhookDestinationSchema)); }
  getWebhookDestination(id: string) { return this.request("GET", `webhook/destinations/${segment(id)}/`, webhookDestinationSchema); }
  createWebhookDestination(input: WebhookDestinationInput) { return this.request("POST", "webhook/destinations/", webhookDestinationSchema, input); }
  patchWebhookDestination(id: string, input: Partial<WebhookDestinationInput>) { return this.request("PATCH", `webhook/destinations/${segment(id)}/`, webhookDestinationSchema, input); }
  deleteWebhookDestination(id: string) { return this.request("DELETE", `webhook/destinations/${segment(id)}/`, z.void()); }
  /** The client for sign-in codes: this one, or the same options with the OTP app's key. */
  private otp(): DiditClient { const key = this.options.otpApiKey; return key && key !== this.options.apiKey ? new DiditClient({ ...this.options, apiKey: key, otpApiKey: undefined }) : this; }
  async sendEmailOtp(input: EmailSendInput, reservation: SpendReservation) { await claimReservation(reservation, "email_send", MAX_PRICE_USD.email_send); return this.otp().request("POST", "email/send/", emailSendSchema, input); }
  checkEmailOtp(email: string, code: string) { return this.otp().request("POST", "email/check/", emailCheckSchema, { email, code, enable_social: false, enable_enrichment: false }); }
  /**
   * 1:N face search. `save` persists the call as an API session in the Didit console (and enrolls the probe in the app's
   * face index; Didit excludes those enrollments from future searches); `vendorData`/`metadata` tag that session.
   */
  async faceSearch(image: Blob, reservation: SpendReservation, options: { save?: boolean; vendorData?: string; metadata?: Record<string, unknown> } = {}) {
    const body = new FormData(); body.set("user_image", image, "frame.jpg"); body.set("save_api_request", options.save ? "true" : "false"); body.set("search_type", "most_similar");
    if (options.save && options.vendorData) body.set("vendor_data", options.vendorData);
    if (options.save && options.metadata) body.set("metadata", JSON.stringify(options.metadata));
    await claimReservation(reservation, "face_search", MAX_PRICE_USD.face_search);
    return this.request("POST", "face-search/", faceSearchSchema, body, this.options.faceTimeoutMs ?? 6000);
  }
  async passiveLiveness(image: Blob, reservation: SpendReservation) {
    const body = new FormData(); body.set("user_image", image, "frame.jpg"); body.set("save_api_request", "false");
    await claimReservation(reservation, "passive_liveness", MAX_PRICE_USD.passive_liveness);
    return this.request("POST", "passive-liveness/", passiveLivenessSchema, body);
  }
}
