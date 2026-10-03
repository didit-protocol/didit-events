import { z } from "zod";
export const providerStatusSchema = z.enum(["Not Started", "In Progress", "Approved", "Declined", "In Review", "Expired", "Abandoned", "Kyc Expired", "Resubmitted", "Awaiting User"]);
export type ProviderStatus = z.infer<typeof providerStatusSchema>;
const loose = z.object({}).passthrough();
const warningSchema = z.object({ risk: z.string(), log_type: z.string().optional() }).passthrough();
export const faceMatchSchema = z.object({ session_id: z.string().nullable(), similarity_percentage: z.number().min(0).max(100), is_blocklisted: z.boolean(), api_service: z.string().nullable(), status: z.string().nullable().optional(), source: z.string().optional() }).passthrough();
export type FaceMatch = z.infer<typeof faceMatchSchema>;
export const livenessSchema = z.object({ status: z.string(), method: z.string().optional(), score: z.number().nullable().optional(), age_estimation: z.number().nullable().optional(), node_id: z.string().nullable().optional(), matches: z.array(faceMatchSchema).default([]), warnings: z.array(warningSchema).default([]) }).passthrough();
export const emailVerificationSchema = z.object({ status: z.string(), email: z.string(), verified_at: z.string().nullable().optional(), verification_attempts: z.number().optional() }).passthrough();
export const questionnaireResponseSchema = z.object({ node_id: z.string().nullable().optional(), status: z.string(), sections: z.array(z.object({ items: z.array(z.object({ uuid: z.string().optional(), value: z.string().nullable().optional(), element_type: z.string().optional(), answer: z.object({ value: z.unknown().optional() }).passthrough().nullable().optional() }).passthrough()) }).passthrough()) }).passthrough();
// Used fields only. Extra enrichment/media is deliberately discarded here.
export const phoneVerificationSchema = z.object({ status: z.string(), full_number: z.string().regex(/^\+[1-9][0-9]{6,14}$/).nullable().optional(), verified_at: z.iso.datetime({ offset: true }).nullable().optional() });
export const idVerificationSchema = z.object({ status: z.string(), full_name: z.string().nullable().optional(), date_of_birth: z.iso.date().nullable().optional(), expiration_date: z.iso.date().nullable().optional() });
export const documentFaceMatchSchema = z.object({ status: z.string(), score: z.number().finite().nullable().optional() });
export const decisionSchema = z.object({
  metadata: z.object({ events_op_id: z.string().optional(), events_account_id: z.string().optional(), events_config_hash: z.string().optional() }).passthrough().nullable().optional(),
  phone_verifications: z.array(phoneVerificationSchema).nullable().optional(), id_verifications: z.array(idVerificationSchema).nullable().optional(), face_matches: z.array(documentFaceMatchSchema).nullable().optional(),
  session_id: z.string(), session_kind: z.literal("user").optional(), workflow_id: z.string().nullable(), vendor_data: z.string().nullable(), status: providerStatusSchema, created_at: z.string(),
  questionnaire_responses: z.array(questionnaireResponseSchema).nullable().optional(), email_verifications: z.array(emailVerificationSchema).nullable().optional(), liveness_checks: z.array(livenessSchema).nullable().optional(),
  events: z.array(z.object({ event_type: z.string(), feature_step: z.string().nullable(), created_at: z.string(), sent_at: z.number().optional(), details: z.object({ current_status: z.string().optional(), old_status: z.string().optional() }).passthrough().nullable().optional() }).passthrough()).optional(),
}).passthrough();
export type DiditDecision = z.infer<typeof decisionSchema>;
export const createdSessionSchema = z.object({ session_id: z.string(), status: providerStatusSchema, workflow_id: z.string(), vendor_data: z.string().nullable().optional(), url: z.url(), session_token: z.string().optional() }).passthrough();
export type CreatedSession = z.infer<typeof createdSessionSchema>;
export const sessionListItemSchema = z.object({ session_id: z.string(), status: providerStatusSchema, vendor_data: z.string().nullable(), created_at: z.string(), workflow_id: z.string().nullable().optional() }).passthrough();
export function pageSchema<T extends z.ZodType>(item: T) { return z.object({ count: z.number().int().nonnegative(), next: z.string().nullable(), previous: z.string().nullable().optional(), results: z.array(item) }); }
export interface Page<T> { count: number; next: string | null; previous?: string | null; results: T[] }
export const workflowSchema = z.object({ uuid: z.string(), workflow_id: z.string().optional(), workflow_label: z.string().nullable(), status: z.enum(["draft", "published"]).optional(), version: z.number().int().optional(), is_archived: z.boolean().optional(), min_price: z.number().nonnegative().optional(), max_price: z.number().nonnegative().optional(), features: z.string().optional(), workflow_graph: z.object({ start_node: z.string(), nodes: z.record(z.string(), z.unknown()) }).optional() }).passthrough();
export type Workflow = z.infer<typeof workflowSchema>;
export interface WorkflowFeature { feature: "QUESTIONNAIRE" | "EMAIL_VERIFICATION" | "LIVENESS" | "AGE_ESTIMATION" | "PHONE_VERIFICATION" | "OCR" | "FACE_MATCH"; config?: Record<string, unknown>; label?: string }
export interface WorkflowInput { workflow_label: string; features: WorkflowFeature[]; is_desktop_allowed?: boolean; is_white_label_enabled?: boolean; is_default?: boolean; status?: string; max_retry_attempts?: number; retry_window_days?: number; session_expiration_time?: number; face_liveness_max_attempts?: number; face_match_max_attempts?: number }
export interface QuestionnaireInput { title: string; description?: string; languages: string[]; default_language: string; is_active?: boolean; form_elements: Array<{ id: string; element_type: "short_text"; label: Record<string, string>; is_required: boolean }> }
export const questionnaireSchema = z.object({ questionnaire_id: z.string(), title: z.string() }).passthrough();
export const questionnaireListItemSchema = z.object({ uuid: z.string(), title: z.string() }).passthrough();
export type Questionnaire = z.infer<typeof questionnaireSchema>;
export interface WebhookDestinationInput { label: string; url: string; enabled?: boolean; webhook_version?: "v1" | "v2" | "v3"; subscribed_events?: string[] }
export const webhookDestinationSchema = z.object({ uuid: z.string(), label: z.string(), url: z.string(), enabled: z.boolean(), webhook_version: z.string(), subscribed_events: z.array(z.string()), secret_shared_key: z.string().optional() }).passthrough();
export type WebhookDestination = z.infer<typeof webhookDestinationSchema>;
export interface CreateSessionInput { workflow_id: string; vendor_data: string; callback?: string; callback_method?: "initiator" | "completer" | "both"; metadata?: Record<string, unknown>; language?: string; contact_details?: { email?: string; send_notification_emails?: boolean; email_lang?: string }; expected_details?: { first_name?: string; last_name?: string } }
export interface SessionFilters { limit?: number; offset?: number; workflow_id?: string; vendor_data?: string; status?: ProviderStatus; date_from?: string; date_to?: string; search?: string; session_kind?: "user"; country?: string; document_type?: string; document_name?: string; region?: string; didit_internal_id?: string; session_type?: string; api_service?: string; screened_full_name?: string; warning?: string; status_initialized_as_in_review?: boolean; is_kyc_to_be_reviewed?: boolean; euuid?: string; organization_name?: string }
export const emailSendSchema = z.object({ request_id: z.string(), status: z.enum(["Success", "Retry", "Undeliverable"]), reason: z.string().nullable().optional() }).passthrough();
export const emailCheckSchema = z.discriminatedUnion("status", [
  z.object({ request_id: z.string().min(1), status: z.literal("Approved"), message: z.string().optional(), email: emailVerificationSchema.extend({ status: z.literal("Approved"), verified_at: z.iso.datetime({ offset: true }).optional() }), created_at: z.iso.datetime({ offset: true }).optional() }).passthrough(),
  // Sandbox (and some serializers) omit email.verified_at on an Approved check; the check itself is the proof moment.
  z.object({ request_id: z.string().optional(), status: z.enum(["Declined", "Failed", "Expired or Not Found"]), message: z.string().optional(), email: emailVerificationSchema.nullable().optional() }).passthrough(),
]);
export interface EmailSendInput { email: string; options?: { code_size?: number; alphanumeric_code?: boolean; locale?: string; use_white_label_customization?: boolean }; signals?: { ip?: string; device_id?: string; device_platform?: "web" | "android" | "ios" | "ipados" | "tvos" }; vendor_data?: string; metadata?: Record<string, unknown> }
// Some deployed v3 serializers omit total_matches. The bounded match array is authoritative.
export const faceSearchSchema = z.object({ request_id: z.string(), face_search: z.object({ status: z.enum(["Approved", "Declined"]), total_matches: z.number().int().nonnegative().optional(), matches: z.array(faceMatchSchema).max(5), warnings: z.array(warningSchema).optional() }).passthrough().transform(value => ({...value,total_matches:value.total_matches ?? value.matches.length})) }).passthrough();
export const passiveLivenessSchema = z.object({ request_id: z.string(), liveness: z.object({ status: z.enum(["Approved", "Declined"]), method: z.literal("PASSIVE"), score: z.number().nullable(), warnings: z.array(warningSchema) }).passthrough() }).passthrough();
export const deletionSchema = z.object({ session_id: z.string(), face_retention_outcome: z.enum(["deleted", "none", "ineligible_no_vendor_user", "retained_with_user", "failed_retryable"]), biometric_template_uuid: z.string().nullable().optional() }).passthrough();
/** A 204/404 acknowledges absence but cannot prove the documented biometric erasure contract. */
export type DeleteSessionResult =
  | (z.infer<typeof deletionSchema> & { erasureConfirmed: true })
  | { alreadyDeleted: true; erasureConfirmed: false }
  | { legacyNoContent: true; erasureConfirmed: false };
export { loose as providerObjectSchema };
/** C15/C21: first server approval event, never fetch time. Null means UNKNOWN and must block evidence creation. */
export function establishedAt(decision: DiditDecision): Date | null {
  const dates = (decision.events ?? []).filter(e => e.event_type === "SESSION_STATUS_CHANGED" && e.feature_step === null && e.details?.current_status === "Approved")
    .map(e => new Date(e.created_at)).filter(d => Number.isFinite(d.getTime())).sort((a, b) => a.getTime() - b.getTime());
  return dates[0] ?? null;
}
