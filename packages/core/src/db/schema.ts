import { sql } from "drizzle-orm";
import { bigint,boolean,check,customType,doublePrecision,foreignKey,index,integer,jsonb,pgEnum,pgTable,primaryKey,serial,text,timestamp,unique,uniqueIndex,uuid,type AnyPgColumn,type PgTableExtraConfigValue } from "drizzle-orm/pg-core";
import type { Application,ConsentReceipt,EventChecks,EventCover,EventDoor,EventEmails,EventForm,Profile,ProofCheck,RequestReceipt } from "../domain/event-model.ts";
import type { MaxAge,Requirements } from "../domain/requirements.ts";

const id = () => uuid("id").primaryKey().defaultRandom();
const time = (name: string) => timestamp(name, { withTimezone: true });
const created = () => time("created_at").notNull().defaultNow();
const updated = () => time("updated_at").notNull().defaultNow();
const bytea = customType<{ data: Uint8Array }>({ dataType: () => "bytea" });
export const admissionEnum = pgEnum("admission", ["pending", "approved", "waitlisted", "rejected", "cancelled_by_guest", "cancelled_by_host", "revoked"]);
export const eventStatusEnum = pgEnum("event_status", ["draft", "published", "live", "ended", "cancelled"]);
export const verificationStatusEnum = pgEnum("verification_status", ["created", "started", "approved", "in_review", "declined", "abandoned", "expired", "superseded"]);
export const evidenceKindEnum = pgEnum("evidence_kind", ["identity", "face", "age"]);
export const evidenceStateEnum = pgEnum("evidence_state", ["active", "pending_continuity", "superseded", "invalidated"]);
export const scanResultEnum = pgEnum("scan_result", ["welcomed", "welcome_back", "unknown", "ambiguous", "not_on_list", "not_admitted", "not_verified", "no_face", "inconclusive", "paused", "budget_exhausted", "error", "liveness_failed"]);
export const principalEnum = pgEnum("principal", ["staff", "guest"]);
export const authMethodEnum = pgEnum("auth_method", ["oidc_google", "email_otp"]);
export const staffRoleEnum = pgEnum("staff_role", ["owner", "admin", "staff"]);
export const health = pgTable("health", { id: serial("id").primaryKey(), note: text("note").notNull().default("ok"), createdAt: created() });
export const accounts = pgTable("accounts", {
  fullName: text("full_name"), emailVerifiedAt: time("email_verified_at"),
  emailProofMethod: text("email_proof_method", { enum: ["didit_otp", "didit_google", "legacy_verified"] }), emailProofRef: text("email_proof_ref"),
  profileVersion: integer("profile_version").notNull().default(1), profileCompletedAt: time("profile_completed_at"), onboardedAt: time("onboarded_at"),
  profileLinksLegacy: jsonb("profile_links_legacy").$type<unknown>(),
  id: id(), email: text("email").notNull().unique(), firstName: text("first_name"), lastName: text("last_name"), photoUrl: text("photo_url"),
  createdAt: created(), updatedAt: updated(), deletingAt: time("deleting_at"), deletedAt: time("deleted_at"),
  photo: bytea("photo"), headline: text("headline"), bio: text("bio"), company: text("company"), jobRole: text("job_role"),
  profileLinks: jsonb("profile_links").$type<Profile["links"]>().notNull().default([]), marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
  /** B5: lifecycle reminder emails (M-05, M-11, M-12, M-14). Service notices about a held place are not gated. */
  emailReminders: boolean("email_reminders").notNull().default(true),
  hasFaceHistory: boolean("has_face_history").notNull().default(false),
}, (t): PgTableExtraConfigValue[] => [
  check("accounts_profile_version", sql`${t.profileVersion}>0`),
  check("accounts_email_proof", sql`(${t.emailVerifiedAt} is null and ${t.emailProofMethod} is null and ${t.emailProofRef} is null) or (${t.emailVerifiedAt} is not null and ${t.emailProofMethod} is not null and ${t.emailProofMethod} in ('didit_otp','didit_google','legacy_verified') and ${t.emailProofRef} is not null and char_length(btrim(${t.emailProofRef})) between 1 and 500)`),
  check("accounts_profile_links_v2", sql`profile_links_v2_ok(${t.profileLinks}) is true`),
  check("accounts_profile_completed_v2", sql`${t.profileCompletedAt} is null or profile_complete_v2_ok(${t.fullName},${t.headline},${t.company},${t.jobRole},${t.bio},${t.profileLinks}) is true`),
  check("accounts_onboarded_v2", sql`${t.onboardedAt} is null or (${t.emailVerifiedAt} is not null and ${t.profileCompletedAt} is not null and ${t.emailVerifiedAt}<=${t.onboardedAt} and ${t.profileCompletedAt}<=${t.onboardedAt})`),
  index("accounts_onboarding_idx").on(t.id).where(sql`${t.onboardedAt} is null and ${t.deletingAt} is null and ${t.deletedAt} is null`),
check("accounts_email_normalized", sql`${t.email} = lower(btrim(${t.email}))`)]);
export const accountIdentities = pgTable("account_identities", {
  id: id(), accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }), issuer: text("issuer").notNull(), subject: text("subject").notNull(), createdAt: created(),
}, (t): PgTableExtraConfigValue[] => [unique("identity_issuer_subject").on(t.issuer, t.subject), index("identities_account_idx").on(t.accountId)]);
export const staff = pgTable("staff", {
  email: text("email").primaryKey(), role: staffRoleEnum("role").notNull().default("staff"), invitedBy: text("invited_by").references((): AnyPgColumn => staff.email, { onDelete: "set null" }), disabledAt: time("disabled_at"), createdAt: created(),
}, (t): PgTableExtraConfigValue[] => [check("staff_email_normalized", sql`${t.email} = lower(btrim(${t.email}))`)]);
export const verifications = pgTable("verifications", {
  id: id(), accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }), diditSessionId: uuid("didit_session_id").notNull().unique(), workflowId: uuid("workflow_id").notNull(), vendorData: text("vendor_data").notNull(),
  status: verificationStatusEnum("status").notNull().default("created"), providerStatus: text("provider_status"), policyState: text("policy_state"), policyReason: text("policy_reason"),
  qFirstName: text("q_first_name"), qLastName: text("q_last_name"), verifiedEmail: text("verified_email"), emailMatches: boolean("email_matches"), livenessAt: time("liveness_at"), ageEstimate: doublePrecision("age_estimate"),
  acceptedEmail: text("accepted_email"), emailAcceptedBy: text("email_accepted_by"), emailAcceptedAt: time("email_accepted_at"),
  decision: jsonb("decision").$type<Record<string, unknown>>(), createdAt: created(), decidedAt: time("decided_at"), fetchedAt: time("fetched_at"), nextFetchAt: time("next_fetch_at"),
  firstApprovedAt: time("first_approved_at"), hostedUrl: text("hosted_url"), evidenceExpiresAt: time("evidence_expires_at"),
  reconcileState: text("reconcile_state", { enum: ["ready", "retry", "ignored"] }).notNull().default("ready"),
  fetchAttempts: integer("fetch_attempts").notNull().default(0), lastError: text("last_error"),
}, (t): PgTableExtraConfigValue[] => [unique("verifications_account_id_id").on(t.accountId, t.id), index("verifications_account_idx").on(t.accountId), index("verifications_reconcile_idx").on(t.nextFetchAt, t.fetchedAt)]);
export const evidence = pgTable("evidence", {
  source: text("source", { enum: ["legacy", "liveness", "phone", "document", "age_estimation"] }).notNull().default("legacy"),
  binding: text("binding", { enum: ["legacy_chain", "account", "face_chain"] }).notNull().default("legacy_chain"), subjectFaceId: uuid("subject_face_id"),
  id: id(), accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }), verificationId: uuid("verification_id").notNull(), kind: text("kind", { enum: ["identity", "face", "age", "phone", "document"] }).notNull(), value: jsonb("value").$type<number | Record<string, unknown>>(),
  establishedAt: time("established_at").notNull(), validUntil: time("valid_until").notNull(), invalidatedAt: time("invalidated_at"), supersededAt: time("superseded_at"), state: evidenceStateEnum("state").notNull().default("active"), reason: text("reason"), createdAt: created(), updatedAt: updated(),
  providerStatus: text("provider_status", { enum: ["approved", "withdrawn", "in_review", "declined"] }).notNull().default("in_review"),
  activation: text("activation", { enum: ["pending_continuity", "active", "superseded", "revoked"] }).notNull().default("pending_continuity"),
  invalidatedReason: text("invalidated_reason"), recoveredBy: text("recovered_by"), recoveryReason: text("recovery_reason"),
  continuityOf: uuid("continuity_of"),
}, (t): PgTableExtraConfigValue[] => [
  check("evidence_kind_v2", sql`${t.kind} in ('identity','face','age','phone','document')`),
  check("evidence_source_v2", sql`${t.source} in ('legacy','liveness','phone','document','age_estimation')`),
  check("evidence_binding_v2", sql`(${t.binding}='legacy_chain' and ${t.kind} in ('identity','face','age') and ${t.subjectFaceId} is null) or (${t.binding}='account' and ${t.kind}='phone' and ${t.subjectFaceId} is null and ${t.continuityOf} is null) or (${t.binding}='face_chain' and ${t.kind} in ('document','age') and ${t.subjectFaceId} is not null)`),
  check("evidence_value_v2", sql`evidence_value_v2_ok(${t.kind},${t.source},${t.value}) is true`),
  unique("evidence_account_id_id").on(t.accountId,t.id),
  foreignKey({ name: "evidence_subject_face_fk", columns: [t.accountId,t.subjectFaceId], foreignColumns: [evidence.accountId,evidence.id] }),
  index("evidence_subject_face_idx").on(t.accountId,t.subjectFaceId).where(sql`${t.subjectFaceId} is not null`),

  check("evidence_provider_status", sql`${t.providerStatus} in ('approved','withdrawn','in_review','declined')`),
  check("evidence_activation", sql`${t.activation} in ('pending_continuity','active','superseded','revoked')`),
  check("evidence_recovery_pair", sql`(${t.recoveredBy} is null and ${t.recoveryReason} is null) or (${t.recoveredBy} is not null and ${t.recoveryReason} is not null and length(btrim(${t.recoveredBy})) > 0 and length(btrim(${t.recoveryReason})) > 0)`),
  uniqueIndex("evidence_one_active_face").on(t.accountId).where(sql`${t.kind} = 'face' and ${t.activation} = 'active'`),
  unique("evidence_verification_kind").on(t.verificationId, t.kind),
  foreignKey({ name: "evidence_account_verification_fk", columns: [t.accountId, t.verificationId], foreignColumns: [verifications.accountId, verifications.id] }).onDelete("cascade"),
  foreignKey({ name: "evidence_continuity_account_fk", columns: [t.accountId, t.continuityOf], foreignColumns: [verifications.accountId, verifications.id] }),
  check("evidence_continuity_not_self", sql`${t.continuityOf} <> ${t.verificationId}`),
  uniqueIndex("evidence_one_current_face").on(t.accountId).where(sql`${t.kind} = 'face' and ${t.state} = 'active' and ${t.invalidatedAt} is null and ${t.supersededAt} is null`),
  index("evidence_account_kind_idx").on(t.accountId, t.kind), index("evidence_retention_idx").on(t.validUntil),
  check("evidence_validity", sql`${t.validUntil} > ${t.establishedAt}`),
  check("evidence_age_value", sql`${t.kind} <> 'age' or (${t.value} is not null and jsonb_typeof(${t.value}) = 'number')`),
]);
export const verificationOps = pgTable("verification_ops", {
  purpose: text("purpose", { enum: ["legacy", "onboarding", "face_renewal", "re_enrolment", "event_checks"] }).notNull().default("legacy"),
  workflowKey: text("workflow_key"), diditSessionId: uuid("didit_session_id"), vendorData: text("vendor_data").notNull(), emailAtCreation: text("email_at_creation").notNull(),
  expectedChecks: text("expected_checks").array().$type<ProofCheck[]>().notNull().default([]),
  originEventId: uuid("origin_event_id").references((): AnyPgColumn => events.id, { onDelete: "set null" }), originPolicyVersion: integer("origin_policy_version"),
  originDraftId: uuid("origin_draft_id").references((): AnyPgColumn => registrationDrafts.id, { onDelete: "set null" }),
  subjectFaceId: uuid("subject_face_id"), consent: jsonb("consent").$type<ConsentReceipt>(),
  id: id(), accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }), workflowId: uuid("workflow_id").notNull(), verificationId: uuid("verification_id").references(() => verifications.id, { onDelete: "set null" }),
  state: text("state", { enum: ["creating", "active", "completed", "failed", "expired", "stale"] }).notNull().default("creating"), kind: text("kind", { enum: ["full", "renewal", "age", "extras"] }).notNull(), createdAt: created(), expiresAt: time("expires_at").notNull(), attempts: integer("attempts").notNull().default(0),
  replacementOpId: uuid("replacement_op_id").references((): AnyPgColumn => verificationOps.id),
}, (t): PgTableExtraConfigValue[] => [
  uniqueIndex("verification_ops_session_v2").on(t.diditSessionId).where(sql`${t.diditSessionId} is not null`),
  uniqueIndex("verification_ops_face_v2").on(t.accountId).where(sql`${t.state} in ('creating','active') and ${t.purpose} in ('onboarding','face_renewal','re_enrolment')`),
  foreignKey({ name: "verification_ops_account_verification_v2", columns: [t.accountId,t.verificationId], foreignColumns: [verifications.accountId,verifications.id] }),
  foreignKey({ name: "verification_ops_workflow_v2", columns: [t.workflowKey], foreignColumns: [diditWorkflows.key] }),
  foreignKey({ name: "verification_ops_subject_v2", columns: [t.accountId,t.subjectFaceId], foreignColumns: [evidence.accountId,evidence.id] }),
  foreignKey({ name: "verification_ops_origin_policy_v2", columns: [t.originEventId,t.originPolicyVersion], foreignColumns: [eventPolicies.eventId,eventPolicies.version] }),
  foreignKey({ name: "verification_ops_origin_draft_v2", columns: [t.accountId,t.originDraftId], foreignColumns: [registrationDrafts.accountId,registrationDrafts.id] }),
  check("verification_ops_purpose_v2", sql`${t.purpose} in ('legacy','onboarding','face_renewal','re_enrolment','event_checks')`),
  check("verification_ops_vendor_v2", sql`char_length(${t.vendorData}) between 1 and 254 and ${t.emailAtCreation}=lower(btrim(${t.emailAtCreation})) and char_length(${t.emailAtCreation}) between 3 and 254`),
  check("verification_ops_checks_v2", sql`proof_checks_v2_ok(to_jsonb(${t.expectedChecks})) is true`),
  check("verification_ops_consent_v2", sql`${t.purpose}='legacy' or (${t.workflowKey} is not null and consent_receipt_v1_ok(${t.consent}) is true)`),
  // The face workflow id is per Didit application (sandbox, prod, prod-v2): the app pins it via DIDIT_RENEWAL_WORKFLOW_ID, not the schema.
  check("verification_ops_face_plan_v3", sql`${t.purpose} not in ('onboarding','face_renewal','re_enrolment') or (${t.expectedChecks}=array['face']::text[] and ${t.vendorData}=${t.emailAtCreation})`),
  check("verification_ops_extras_v2", sql`${t.purpose}<>'event_checks' or not ('face'=any(${t.expectedChecks}))`),
  index("verification_ops_origin_idx").on(t.originEventId,t.originPolicyVersion), index("verification_ops_account_created_idx").on(t.accountId,t.createdAt),
uniqueIndex("verification_ops_active").on(t.accountId, t.workflowId).where(sql`${t.state} in ('creating','active')`), check("verification_ops_state", sql`${t.state} in ('creating','active','completed','failed','expired','stale')`), check("verification_ops_kind", sql`${t.kind} in ('full','renewal','age','extras')`), index("verification_ops_due_idx").on(t.state, t.expiresAt)]);
export const events = pgTable("events", {
  checks: jsonb("checks").$type<EventChecks>().notNull().default({ version: 1, required: [], max_age: {} }),
  door: jsonb("door").$type<EventDoor>().notNull().default({ kiosk: false }),
  form: jsonb("form").$type<EventForm>().notNull().default({ version: 1, mode: "request", closes_at: null, waitlist: true, fields: { phone_number: "off" }, questions: [], consent_text: null }),
  emails: jsonb("emails").$type<EventEmails>().notNull().default({ version: 1, templates: {} }), descriptionMd: text("description_md").notNull().default(""),
  policyVersion: integer("policy_version").notNull().default(1), formVersion: integer("form_version").notNull().default(1),
  editVersion: integer("edit_version").notNull().default(1),
  id: id(), slug: text("slug").notNull().unique(), name: text("name").notNull(), description: text("description").notNull().default(""), agenda: jsonb("agenda").notNull().default([]), speakers: jsonb("speakers").notNull().default([]),
  startsAt: time("starts_at").notNull(), endsAt: time("ends_at").notNull(), timezone: text("timezone").notNull().default("Europe/Madrid"), venue: text("venue"), address: text("address"), capacity: integer("capacity").notNull(),
  status: eventStatusEnum("status").notNull().default("draft"), registrationMode: text("registration_mode", { enum: ["request", "invite_only", "open"] }).notNull().default("request"), registrationClosesAt: time("registration_closes_at"),
  requirements: jsonb("requirements").$type<Requirements>().notNull().default({ identity: true, email: true, liveness: true }), maxAge: jsonb("max_age").$type<MaxAge>().notNull().default({}), ageMin: integer("age_min"),
  matchThreshold: integer("match_threshold").notNull().default(80), doorMode: text("door_mode", { enum: ["supervised", "strict"] }).notNull().default("supervised"), cover: jsonb("cover").$type<EventCover>().notNull().default({ kind: "theme", theme: "aqua" }), welcomeOptions: jsonb("welcome_options"),
  /** B5: optional per-event copy for lifecycle emails (teaser, directions, recap, recording/photo links). */
  emailContent: jsonb("email_content").$type<Record<string, unknown>>().notNull().default({}), createdAt: created(), updatedAt: updated(),
  /** 0018: the Google Maps place picked in A-03 (all null for manual addresses and older events). */
  placeId: text("place_id"), lat: doublePrecision("lat"), lng: doublePrecision("lng"), mapsUrl: text("maps_url"),
}, (t): PgTableExtraConfigValue[] => [
  check("events_checks_v2", sql`event_checks_v1_ok(${t.checks}) is true`),
  check("events_door_v2", sql`event_door_v1_ok(${t.door}) is true`),
  check("events_form_v2", sql`event_form_v1_ok(${t.form}) is true`),
  check("events_emails_v2", sql`event_emails_v1_ok(${t.emails}) is true`),
  check("events_cover_v2", sql`event_cover_v1_ok(${t.cover}) is true`),
  check("events_description_v2", sql`char_length(${t.description})<=600 and char_length(${t.descriptionMd})<=20000`),
  check("events_versions_v2", sql`${t.editVersion}>0 and ${t.policyVersion}>0 and ${t.formVersion}>0`),
  foreignKey({ name: "events_policy_fk", columns: [t.id,t.policyVersion,t.formVersion], foreignColumns: [eventPolicies.eventId,eventPolicies.version,eventPolicies.formVersion] }),
check("events_place_coords", sql`(${t.lat} is null) = (${t.lng} is null) and (${t.lat} is null or (${t.lat} between -90 and 90 and ${t.lng} between -180 and 180))`), check("events_maps_url", sql`${t.mapsUrl} is null or ${t.mapsUrl} like 'https://%'`), check("events_capacity", sql`${t.capacity} > 0`), check("events_threshold", sql`${t.matchThreshold} between 50 and 99`), check("events_dates", sql`${t.endsAt} > ${t.startsAt}`), check("events_age_min", sql`${t.ageMin} between 1 and 100`), check("events_mode", sql`${t.registrationMode} in ('request','invite_only','open')`), check("events_door_mode", sql`${t.doorMode} in ('supervised','strict')`), check("events_requirements_object", sql`jsonb_typeof(${t.requirements}) = 'object' and jsonb_typeof(${t.maxAge}) = 'object'`),
  check("events_requirements_keys", sql`(${t.requirements} - array['identity','email','liveness','age_min']) = '{}'::jsonb and (${t.maxAge} - array['identity','face','age']) = '{}'::jsonb`),
  check("events_requirements_types", sql`(not (${t.requirements} ? 'identity') or jsonb_typeof(${t.requirements}->'identity') = 'boolean') and (not (${t.requirements} ? 'email') or jsonb_typeof(${t.requirements}->'email') = 'boolean') and (not (${t.requirements} ? 'liveness') or jsonb_typeof(${t.requirements}->'liveness') = 'boolean') and (not (${t.requirements} ? 'age_min') or (jsonb_typeof(${t.requirements}->'age_min') = 'number' and (${t.requirements}->>'age_min')::numeric between 1 and 100 and mod((${t.requirements}->>'age_min')::numeric,1)=0))`),
  check("events_age_consistent", sql`${t.ageMin} is null or not (${t.requirements} ? 'age_min') or ${t.ageMin} = (${t.requirements}->>'age_min')::numeric`),
  ...([['identity', 31536000], ['face', 15552000], ['age', 31536000]] as const).map(([kind, ttl]) => check(`events_max_age_${kind}`, sql`not (${t.maxAge} ? ${sql.raw(`'${kind}'`)}) or (jsonb_typeof(${t.maxAge}->${sql.raw(`'${kind}'`)}) = 'number' and (${t.maxAge}->>${sql.raw(`'${kind}'`)})::numeric > 0 and (${t.maxAge}->>${sql.raw(`'${kind}'`)})::numeric <= ${sql.raw(String(ttl))} and mod((${t.maxAge}->>${sql.raw(`'${kind}'`)})::numeric,1)=0)`)),
  index("events_status_starts_idx").on(t.status, t.startsAt)]);
export const eventAssets = pgTable("event_assets", {
  eventId: uuid("event_id").notNull().references((): AnyPgColumn => events.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("cover"), version: uuid("version").notNull().defaultRandom(),
  bytes: bytea("bytes").notNull(), contentType: text("content_type").notNull(),
  width: integer("width").notNull(), height: integer("height").notNull(),
  sha256: text("sha256").notNull(), createdAt: created(),
}, (t): PgTableExtraConfigValue[] => [
  primaryKey({ columns: [t.eventId, t.version] }),
  check("event_assets_kind", sql`${t.kind}='cover'`),
  check("event_assets_type", sql`${t.contentType} in ('image/jpeg','image/png','image/webp')`),
  check("event_assets_size", sql`octet_length(${t.bytes}) between 1 and 2097152`),
  check("event_assets_dimensions", sql`${t.width} between 1 and 4096 and ${t.height} between 1 and 4096 and ${t.width}::bigint*${t.height}::bigint<=12000000`),
  check("event_assets_hash", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
]);
export const registrations = pgTable("registrations", {
  policyVersion: integer("policy_version").notNull(), formVersion: integer("form_version").notNull(),
  requestCompletedAt: time("request_completed_at"), profileVersionAtRequest: integer("profile_version_at_request"), requestReceipt: jsonb("request_receipt").$type<RequestReceipt>(),
  legacyImported: boolean("legacy_imported").notNull().default(false), applicationV2: jsonb("application_v2").$type<Application>().default({ fields: {}, answers: {} }),
  applicationPurgedAt: time("application_purged_at"), blocked: boolean("blocked").notNull().default(false),
  application: jsonb("application").$type<Record<string, string>>().notNull().default({}), staffNote: text("staff_note"), undoRejection: jsonb("undo_rejection").$type<{ from: string; appliedAt: string; until: string; historyId: string; blocked?: string | null }>(),
  id: id(), eventId: uuid("event_id").notNull().references((): AnyPgColumn => events.id, { onDelete: "cascade" }), accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }), admission: admissionEnum("admission").notNull().default("pending"), reason: text("reason"), internalReason: text("internal_reason"), lateCancellation: boolean("late_cancellation").notNull().default(false), overCapacity: boolean("over_capacity").notNull().default(false), reapplicationCount: integer("reapplication_count").notNull().default(0), appliedAt: time("applied_at").notNull().defaultNow(), createdAt: created(), updatedAt: updated(),
}, (t): PgTableExtraConfigValue[] => [
  foreignKey({ name: "registrations_policy_fk", columns: [t.eventId,t.policyVersion,t.formVersion], foreignColumns: [eventPolicies.eventId,eventPolicies.version,eventPolicies.formVersion] }),
  check("registrations_payload_v2", sql`(${t.applicationPurgedAt} is null and application_v2_ok(${t.applicationV2}) is true and ((${t.requestReceipt} is null and ${t.legacyImported} and ${t.requestCompletedAt} is null and ${t.profileVersionAtRequest} is null) or (request_receipt_v1_ok(${t.requestReceipt}) is true and ${t.requestCompletedAt} is not null and ${t.profileVersionAtRequest} is not null and ${t.profileVersionAtRequest}>0 and (${t.requestReceipt}->>'profileVersion')::integer=${t.profileVersionAtRequest} and (${t.requestReceipt}->>'evaluatedAt')::timestamptz=${t.requestCompletedAt}))) or (${t.applicationPurgedAt} is not null and ${t.applicationV2} is null and ${t.requestReceipt} is null and ${t.staffNote} is null)`),
  index("registrations_policy_idx").on(t.eventId,t.policyVersion,t.admission),
unique("registrations_event_account").on(t.eventId, t.accountId), unique("registrations_event_id_id").on(t.eventId, t.id), index("registrations_account_idx").on(t.accountId), index("registrations_waitlist_idx").on(t.eventId, t.admission, t.appliedAt), check("registrations_reapplication_count", sql`${t.reapplicationCount} between 0 and 1`)]);
export const admissionHistory = pgTable("admission_history", {
  id: id(), registrationId: uuid("registration_id").notNull().references(() => registrations.id, { onDelete: "cascade" }), from: admissionEnum("from"), to: admissionEnum("to").notNull(), actor: text("actor").notNull(), reason: text("reason"), overCapacity: boolean("over_capacity").notNull().default(false), createdAt: created(),
}, (t): PgTableExtraConfigValue[] => [index("admission_history_registration_idx").on(t.registrationId, t.createdAt)]);
/** v5 calendar invites: the iCalendar SEQUENCE per registration (UID `<registrationId>@events.didit.me`) and the last METHOD sent. */
export const calendarInvites = pgTable("calendar_invites", {
  registrationId: uuid("registration_id").primaryKey().references(() => registrations.id, { onDelete: "cascade" }), sequence: integer("sequence").notNull(), method: text("method", { enum: ["REQUEST", "CANCEL"] }).notNull(), updatedAt: updated(),
}, (t): PgTableExtraConfigValue[] => [check("calendar_invites_sequence", sql`${t.sequence} >= 0`), check("calendar_invites_method", sql`${t.method} in ('REQUEST','CANCEL')`)]);
export const invites = pgTable("invites", {
  message: text("message").notNull().default(""), skipApproval: boolean("skip_approval").notNull().default(true),
  id: id(), eventId: uuid("event_id").notNull().references((): AnyPgColumn => events.id, { onDelete: "cascade" }), email: text("email"), tokenHash: text("token_hash").notNull().unique(), expiresAt: time("expires_at").notNull(), maxUses: integer("max_uses").notNull().default(1), uses: integer("uses").notNull().default(0), createdBy: text("created_by"), revokedAt: time("revoked_at"),
  /** v5: who revoked it ('host', 'event_cancelled', 'account_deletion'); "Keep my account" only undoes 'account_deletion'. */
  revokedReason: text("revoked_reason"), createdAt: created(),
}, (t): PgTableExtraConfigValue[] => [check("invites_uses", sql`${t.maxUses} > 0 and ${t.uses} between 0 and ${t.maxUses}`), check("invites_email_normalized", sql`${t.email} = lower(btrim(${t.email}))`), index("invites_event_idx").on(t.eventId)]);
export const inviteRedemptions = pgTable("invite_redemptions", {
  id: id(), inviteId: uuid("invite_id").notNull().references(() => invites.id, { onDelete: "cascade" }), accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }), registrationId: uuid("registration_id").notNull().references(() => registrations.id, { onDelete: "cascade" }), createdAt: created(),
}, (t): PgTableExtraConfigValue[] => [unique("invite_redemptions_invite_account").on(t.inviteId, t.accountId), index("invite_redemptions_account_idx").on(t.accountId)]);
export const linkTokens = pgTable("link_tokens", {
  id: id(), hash: text("hash").notNull().unique(), scope: text("scope").notNull().default("verification"), registrationId: uuid("registration_id").notNull().references(() => registrations.id, { onDelete: "cascade" }), expiresAt: time("expires_at").notNull(), revokedAt: time("revoked_at"), createdAt: created(),
}, (t): PgTableExtraConfigValue[] => [check("link_tokens_scope", sql`${t.scope} = 'verification'`), index("link_tokens_registration_idx").on(t.registrationId)]);
/** C9 attachment is an operation receipt, never an eligibility override on registrations. */
export const verificationAttachments = pgTable("verification_attachments", {
  opId: uuid("op_id").notNull().references(() => verificationOps.id, { onDelete: "cascade" }),
  registrationId: uuid("registration_id").notNull().references(() => registrations.id, { onDelete: "cascade" }),
  attachedAt: time("attached_at"), createdAt: created(),
}, (t): PgTableExtraConfigValue[] => [unique("verification_attachment_op_registration").on(t.opId, t.registrationId)]);
export const verificationDiscovery = pgTable("verification_discovery", {
  workflowId: uuid("workflow_id").primaryKey(), completedAt: time("completed_at").notNull(),
});
/**
 * 0024: a door station ("Main door") of one event. Door sessions scan from a station; scans and face check-ins keep
 * pointing at it, so the check-in log names the door. (Pre-0024 rows were paired Didit Access devices; their device
 * credentials were dropped with the localhost kiosk.)
 */
export const kiosks = pgTable("kiosks", {
  id: id(), eventId: uuid("event_id").notNull().references((): AnyPgColumn => events.id, { onDelete: "cascade" }), name: text("name").notNull(), lastSeenAt: time("last_seen_at"), revokedAt: time("revoked_at"), createdAt: created(), updatedAt: updated(),
}, (t): PgTableExtraConfigValue[] => [unique("kiosks_event_id_id").on(t.eventId, t.id), index("kiosks_event_idx").on(t.eventId)]);
/** 0024: per-event team. Any account email can be a host or operator of one event; staff reach every event. */
export const eventMembers = pgTable("event_members", {
  id: id(), eventId: uuid("event_id").notNull().references((): AnyPgColumn => events.id, { onDelete: "cascade" }), email: text("email").notNull(), role: text("role", { enum: ["host", "operator"] }).notNull(),
  invitedBy: text("invited_by").notNull(), createdAt: created(), updatedAt: updated(), revokedAt: time("revoked_at"),
}, (t): PgTableExtraConfigValue[] => [check("event_members_role", sql`${t.role} in ('host','operator')`), check("event_members_email_normalized", sql`${t.email} = lower(btrim(${t.email})) and position('@' in ${t.email}) > 1`),
  uniqueIndex("event_members_active").on(t.eventId, t.email).where(sql`${t.revokedAt} is null`), index("event_members_email_idx").on(t.email)]);
/** 0024: a browser locked to one event's Door. The cookie authenticates door requests only; the starter's access is rechecked on every request. */
export const doorSessions = pgTable("door_sessions", {
  id: id(), eventId: uuid("event_id").notNull().references((): AnyPgColumn => events.id, { onDelete: "cascade" }), kioskId: uuid("kiosk_id").notNull(),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }), email: text("email").notNull(), tokenHash: text("token_hash").notNull().unique(),
  createdAt: created(), lastSeenAt: time("last_seen_at").notNull().defaultNow(), expiresAt: time("expires_at").notNull(), endedAt: time("ended_at"), endedBy: text("ended_by"),
}, (t): PgTableExtraConfigValue[] => [foreignKey({ name: "door_sessions_station_fk", columns: [t.eventId, t.kioskId], foreignColumns: [kiosks.eventId, kiosks.id] }).onDelete("cascade"), index("door_sessions_event_idx").on(t.eventId, t.endedAt)]);
/** 0024: the staff-set PIN that ends door mode on a device without signing in (scrypt hash, never the PIN). */
export const doorPins = pgTable("door_pins", {
  eventId: uuid("event_id").primaryKey().references((): AnyPgColumn => events.id, { onDelete: "cascade" }), pinHash: text("pin_hash").notNull(), setBy: text("set_by").notNull(), updatedAt: updated(),
});
export const checkins = pgTable("checkins", {
  id: id(), eventId: uuid("event_id").notNull().references((): AnyPgColumn => events.id, { onDelete: "cascade" }), registrationId: uuid("registration_id").notNull(), kioskId: uuid("kiosk_id"), faceEvidenceId: uuid("face_evidence_id").references(() => evidence.id, { onDelete: "set null" }), method: text("method", { enum: ["face", "manual"] }).notNull(), similarity: doublePrecision("similarity"), byStaff: text("by_staff"), checkedInAt: time("checked_in_at").notNull().defaultNow(), undoneAt: time("undone_at"), undoneBy: text("undone_by"), updatedAt: updated(),
}, (t): PgTableExtraConfigValue[] => [foreignKey({ name: "checkins_event_registration_fk", columns: [t.eventId, t.registrationId], foreignColumns: [registrations.eventId, registrations.id] }).onDelete("cascade"), foreignKey({ name: "checkins_event_kiosk_fk", columns: [t.eventId, t.kioskId], foreignColumns: [kiosks.eventId, kiosks.id] }), uniqueIndex("checkins_active_registration").on(t.registrationId).where(sql`${t.undoneAt} is null`), check("checkins_method", sql`${t.method} in ('face','manual')`), check("checkins_similarity", sql`${t.similarity} between 0 and 100`), index("checkins_event_idx").on(t.eventId, t.checkedInAt), index("checkins_snapshot_idx").on(t.eventId, t.updatedAt)]);
export const scans = pgTable("scans", {
  id: id(), eventId: uuid("event_id").notNull().references((): AnyPgColumn => events.id, { onDelete: "cascade" }), kioskId: uuid("kiosk_id").notNull(), registrationId: uuid("registration_id"), result: scanResultEnum("result").notNull(), test: boolean("test").notNull().default(false), candidates: jsonb("candidates").$type<Array<{ sessionId: string; score: number }>>().notNull().default([]), latencyMs: integer("latency_ms").notNull(), createdAt: created(), updatedAt: updated(),
}, (t): PgTableExtraConfigValue[] => [foreignKey({ columns: [t.eventId, t.kioskId], foreignColumns: [kiosks.eventId, kiosks.id] }), foreignKey({ columns: [t.eventId, t.registrationId], foreignColumns: [registrations.eventId, registrations.id] }), check("scans_latency", sql`${t.latencyMs} >= 0`), index("scans_snapshot_idx").on(t.eventId, t.updatedAt), index("scans_retention_idx").on(t.createdAt)]);
export const otpChallenges = pgTable("otp_challenges", {
  id: id(), email: text("email").notNull(), purpose: text("purpose").notNull().default("login"), diditRequestId: uuid("didit_request_id").notNull().unique(), expiresAt: time("expires_at").notNull(), attempts: integer("attempts").notNull().default(0), redeemedAt: time("redeemed_at"), ip: text("ip").notNull(), createdAt: created(),
  synthetic: boolean("synthetic").notNull().default(false), bindingHash: text("binding_hash"), sends: integer("sends").notNull().default(1), lastSentAt: time("last_sent_at").notNull().defaultNow(), checkToken: uuid("check_token"),
}, (t): PgTableExtraConfigValue[] => [check("otp_purpose", sql`${t.purpose} in ('login','staff_login')`), check("otp_attempts", sql`${t.attempts} between 0 and 3`), index("otp_email_idx").on(t.email, t.expiresAt)]);
export const oidcTransactions = pgTable("oidc_transactions", {
  stateHash: text("state_hash").primaryKey(), expiresAt: time("expires_at").notNull(), consumedAt: time("consumed_at"),
});
export const otpDeliveries = pgTable("otp_deliveries", {
  emailHash: text("email_hash").primaryKey(), owner: uuid("owner").notNull(), leaseUntil: time("lease_until").notNull(),
});
export const sessions = pgTable("sessions", {
  id: id(), tokenHash: text("token_hash").notNull().unique(), principal: principalEnum("principal").notNull(), authMethod: authMethodEnum("auth_method").notNull(), accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }), staffEmail: text("staff_email").references(() => staff.email, { onDelete: "cascade" }), rotatedAt: time("rotated_at"), deliveredAt: time("delivered_at"), csrfToken: text("csrf_token"), rotatedFrom: uuid("rotated_from").references((): AnyPgColumn => sessions.id, { onDelete: "set null" }), revokedAt: time("revoked_at"), lastSeenAt: time("last_seen_at").notNull().defaultNow(), authenticatedAt: time("authenticated_at").notNull().defaultNow(), expiresAt: time("expires_at").notNull(), createdAt: created(),
}, (t): PgTableExtraConfigValue[] => [index("sessions_rotated_from_idx").on(t.rotatedFrom), check("sessions_principal_binding", sql`(${t.principal} = 'guest' and ${t.accountId} is not null and ${t.staffEmail} is null) or (${t.principal} = 'staff' and ${t.staffEmail} is not null and ${t.accountId} is null and ${t.authMethod} in ('oidc_google','email_otp'))`), index("sessions_account_idx").on(t.accountId), index("sessions_staff_idx").on(t.staffEmail)]);
export const inbox = pgTable("inbox", {
  id: id(), eventId: text("event_id").notNull().unique(), raw: text("raw"), headers: jsonb("headers").$type<Record<string, string>>(), verifiedAt: time("verified_at").notNull().defaultNow(), attempts: integer("attempts").notNull().default(0), processedAt: time("processed_at"), nextAttemptAt: time("next_attempt_at").notNull().defaultNow(), error: text("error"), createdAt: created(),
}, (t): PgTableExtraConfigValue[] => [index("inbox_due_idx").on(t.nextAttemptAt).where(sql`${t.processedAt} is null`), check("inbox_attempts", sql`${t.attempts} >= 0`)]);
export const outbox = pgTable("outbox", {
  id: id(), kind: text("kind").notNull(), dedupeKey: text("dedupe_key").notNull().unique(), payload: jsonb("payload").$type<Record<string, unknown>>(), status: text("status", { enum: ["pending", "sent", "failed"] }).notNull().default("pending"), attempts: integer("attempts").notNull().default(0), nextAttemptAt: time("next_attempt_at").notNull().defaultNow(), claimToken: uuid("claim_token"), lockedUntil: time("locked_until"), providerId: text("provider_id"), sentAt: time("sent_at"), error: text("error"), createdAt: created(),
  /** B5 delivery receipts (Resend webhook): sent | delivery_delayed | delivered | bounced | complained. */
  deliveryStatus: text("delivery_status"), deliveryAt: time("delivery_at"), failedAt: time("failed_at"),
}, (t): PgTableExtraConfigValue[] => [index("outbox_due_idx").on(t.nextAttemptAt).where(sql`${t.status} = 'pending'`), check("outbox_status", sql`${t.status} in ('pending','sent','failed')`), index("outbox_provider_idx").on(t.providerId), check("outbox_delivery_status", sql`${t.deliveryStatus} is null or ${t.deliveryStatus} in ('sent','delivery_delayed','delivered','bounced','complained')`), check("outbox_attempts", sql`${t.attempts} >= 0`), check("outbox_lease_pair", sql`(${t.claimToken} is null) = (${t.lockedUntil} is null)`)]);
export const jobs = pgTable("jobs", {
  name: text("name").primaryKey(), intervalSec: integer("interval_sec").notNull(), nextRunAt: time("next_run_at").notNull().defaultNow(), attempts: integer("attempts").notNull().default(0), payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}), lastRunAt: time("last_run_at"), error: text("error"),
}, (t): PgTableExtraConfigValue[] => [check("jobs_interval", sql`${t.intervalSec} > 0`), index("jobs_due_idx").on(t.nextRunAt)]);
export const counters = pgTable("counters", { key: text("key").primaryKey(), value: bigint("value", { mode: "number" }).notNull().default(0), expiresAt: time("expires_at").notNull() }, (t): PgTableExtraConfigValue[] => [check("counters_nonnegative", sql`${t.value} >= 0`), index("counters_expiry_idx").on(t.expiresAt)]);
export const spend = pgTable("spend", {
  id: id(), op: text("op").notNull(), usdMaxMicros: bigint("usd_max_micros", { mode: "number" }).notNull(), actualMicros: bigint("actual_micros", { mode: "number" }), scopes: jsonb("scopes").$type<Array<{ key: string; limitMicros: number }>>().notNull(), state: text("state", { enum: ["reserved", "uncertain", "settled"] }).notNull().default("reserved"), dispatchedAt: time("dispatched_at"), settledAt: time("settled_at"), createdAt: created(),
}, (t): PgTableExtraConfigValue[] => [check("spend_amounts", sql`${t.usdMaxMicros} > 0 and (${t.actualMicros} is null or ${t.actualMicros} between 0 and ${t.usdMaxMicros})`), check("spend_state", sql`${t.state} in ('reserved','uncertain','settled')`), index("spend_reconcile_idx").on(t.state, t.createdAt)]);
/** v5: what a deletion in its grace period changed, so "Keep my account" puts it back exactly. */
export interface DeletionRestore {
  evidence: { id: string; state: string; activation: string; invalidatedAt: string | null; invalidatedReason: string | null }[];
  registrations: { id: string; admission: string; reason: string | null; lateCancellation: boolean }[];
  invites: string[];
}
export const deletions = pgTable("deletions", {
  originalAccountId: uuid("original_account_id"), manualReason: text("manual_reason"),
  /** v5 grace period: the deletion runs after this instant; until then the requesting session may keep the account. */
  graceUntil: time("grace_until"), sessionId: uuid("session_id"), restore: jsonb("restore").$type<DeletionRestore>(),
  id: id(), emailHash: text("email_hash").unique(), accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }), diditSessionIds: jsonb("didit_session_ids").$type<string[]>().notNull(), state: text("state", { enum: ["pending", "remote_pending", "manual", "complete"] }).notNull().default("pending"), attempts: integer("attempts").notNull().default(0), nextAttemptAt: time("next_attempt_at").notNull().defaultNow(), manualCompletedAt: time("manual_completed_at"), completedAt: time("completed_at"), createdAt: created(),
}, (t): PgTableExtraConfigValue[] => [index("deletions_sessions_idx").using("gin", t.diditSessionIds), check("deletions_state", sql`${t.state} in ('pending','remote_pending','manual','complete')`), index("deletions_due_idx").on(t.state, t.nextAttemptAt)]);
export const audit = pgTable("audit", {
  id: id(), actor: text("actor").notNull(), action: text("action").notNull(), target: text("target").notNull(), eventId: uuid("event_id").references((): AnyPgColumn => events.id, { onDelete: "cascade" }), data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}), createdAt: created(), updatedAt: updated(),
}, (t): PgTableExtraConfigValue[] => [index("audit_event_snapshot_idx").on(t.eventId, t.updatedAt), index("audit_target_idx").on(t.target)]);

/** 0018: the public calendar header (P-03), edited in /admin/calendar. One row per calendar; today only 'default'. No row = the built-in copy and assets. */
export const calendarProfiles = pgTable("calendar_profiles", {
  key: text("key").primaryKey(), name: text("name").notNull(), tagline: text("tagline").notNull().default(""), description: text("description").notNull().default(""),
  cover: bytea("cover"), coverType: text("cover_type"), coverVersion: integer("cover_version").notNull().default(0),
  logo: bytea("logo"), logoType: text("logo_type"), logoVersion: integer("logo_version").notNull().default(0),
  websiteUrl: text("website_url"), xUrl: text("x_url"), linkedinUrl: text("linkedin_url"),
  updatedAt: updated(), updatedBy: text("updated_by"),
}, (t): PgTableExtraConfigValue[] => [
  check("calendar_profiles_key", sql`${t.key} = 'default'`),
  check("calendar_profiles_text", sql`char_length(${t.name}) between 1 and 80 and char_length(${t.tagline}) <= 120 and char_length(${t.description}) <= 600`),
  check("calendar_profiles_cover", sql`(${t.cover} is null) = (${t.coverType} is null) and (${t.coverType} is null or ${t.coverType} in ('image/jpeg','image/png','image/webp')) and ${t.coverVersion} >= 0`),
  check("calendar_profiles_logo", sql`(${t.logo} is null) = (${t.logoType} is null) and (${t.logoType} is null or ${t.logoType} in ('image/jpeg','image/png','image/webp')) and ${t.logoVersion} >= 0`),
  check("calendar_profiles_links", sql`(${t.websiteUrl} is null or ${t.websiteUrl} like 'https://%') and (${t.xUrl} is null or ${t.xUrl} like 'https://%') and (${t.linkedinUrl} is null or ${t.linkedinUrl} like 'https://%')`),
]);

export const eventPolicies = pgTable("event_policies", {
  eventId: uuid("event_id").notNull().references((): AnyPgColumn => events.id, { onDelete: "cascade" }),
  version: integer("version").notNull(), formVersion: integer("form_version").notNull(),
  checks: jsonb("checks").$type<EventChecks>().notNull(),
  form: jsonb("form").$type<EventForm>().notNull(), createdAt: created(),
}, (t): PgTableExtraConfigValue[] => [
  primaryKey({ columns: [t.eventId, t.version] }),
  unique("event_policies_form_binding").on(t.eventId, t.version, t.formVersion),
  check("event_policies_versions", sql`${t.version}>0 and ${t.formVersion}>0`),
  check("event_policies_checks", sql`event_checks_v1_ok(${t.checks}) is true`),
  check("event_policies_form", sql`event_form_v1_ok(${t.form}) is true`),
]);

export const registrationDrafts = pgTable("registration_drafts", {
  id: id(), accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references((): AnyPgColumn => events.id, { onDelete: "cascade" }),
  policyVersion: integer("policy_version").notNull(), formVersion: integer("form_version").notNull(),
  version: integer("version").notNull().default(1),
  application: jsonb("application").$type<Application>().notNull().default({ fields: {}, answers: {} }),
  consent: jsonb("consent").$type<ConsentReceipt>(),
  inviteId: uuid("invite_id").references(() => invites.id, { onDelete: "set null" }),
  submittedRegistrationId: uuid("submitted_registration_id").references((): AnyPgColumn => registrations.id, { onDelete: "set null" }),
  createdAt: created(), updatedAt: updated(), expiresAt: time("expires_at").notNull(),
}, (t): PgTableExtraConfigValue[] => [
  unique("registration_drafts_account_event").on(t.accountId, t.eventId),
  unique("registration_drafts_account_id").on(t.accountId, t.id),
  foreignKey({ name: "registration_drafts_policy_fk", columns: [t.eventId, t.policyVersion, t.formVersion],
    foreignColumns: [eventPolicies.eventId, eventPolicies.version, eventPolicies.formVersion] }),
  check("registration_drafts_version", sql`${t.version}>0`),
  check("registration_drafts_expiry", sql`${t.expiresAt}>${t.createdAt}`),
  check("registration_drafts_application", sql`application_v2_ok(${t.application}) is true`),
  check("registration_drafts_consent", sql`${t.consent} is null or consent_receipt_v1_ok(${t.consent}) is true`),
  index("registration_drafts_expiry_idx").on(t.expiresAt),
]);

export const diditWorkflows = pgTable("didit_workflows", {
  key: text("key").primaryKey(), featureKey: text("feature_key").notNull(),
  configHash: text("config_hash").notNull(), desiredConfig: jsonb("desired_config").notNull(),
  workflowId: uuid("workflow_id"), providerVersionId: uuid("provider_version_id"),
  label: text("label").notNull(),
  state: text("state", { enum: ["provisioning", "ready", "failed", "uncertain"] }).notNull(),
  minPriceMicros: bigint("min_price_micros", { mode: "number" }),
  maxPriceMicros: bigint("max_price_micros", { mode: "number" }),
  leaseToken: uuid("lease_token"), leaseUntil: time("lease_until"),
  lastErrorCode: text("last_error_code"), verifiedAt: time("verified_at"), createdAt: created(),
}, (t): PgTableExtraConfigValue[] => [
  unique("didit_workflows_config").on(t.featureKey, t.configHash),
  uniqueIndex("didit_workflows_provider_version").on(t.workflowId, t.providerVersionId)
    .where(sql`${t.workflowId} is not null`),
  check("didit_workflows_hash", sql`${t.configHash} ~ '^[0-9a-f]{64}$'`),
  check("didit_workflows_state", sql`${t.state} in ('provisioning','ready','failed','uncertain')`),
  check("didit_workflows_lease", sql`(${t.leaseToken} is null)=(${t.leaseUntil} is null)`),
  check("didit_workflows_price", sql`(${t.minPriceMicros} is null and ${t.maxPriceMicros} is null) or
    (${t.minPriceMicros} is not null and ${t.maxPriceMicros} is not null and
     ${t.minPriceMicros}>=0 and ${t.maxPriceMicros}>0 and ${t.minPriceMicros}<=${t.maxPriceMicros})`),
  check("didit_workflows_ready", sql`${t.state}<>'ready' or
    (${t.workflowId} is not null and ${t.providerVersionId} is not null and
     ${t.minPriceMicros} is not null and ${t.maxPriceMicros} is not null and ${t.verifiedAt} is not null)`),
  check("didit_workflows_config_object", sql`jsonb_typeof(${t.desiredConfig})='object'`),
  index("didit_workflows_lease_idx").on(t.state, t.leaseUntil),
]);


export const registrationSubmissions = pgTable("registration_submissions", {
  id: uuid("id").primaryKey(),
  registrationId: uuid("registration_id").notNull().references(() => registrations.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references((): AnyPgColumn => events.id, { onDelete: "cascade" }),
  policyVersion: integer("policy_version").notNull(), formVersion: integer("form_version").notNull(),
  application: jsonb("application").$type<Application>(),
  receipt: jsonb("receipt").$type<RequestReceipt>(),
  inputHash: text("input_hash").notNull(), payloadPurgedAt: time("payload_purged_at"), createdAt: created(),
}, (t): PgTableExtraConfigValue[] => [
  foreignKey({ name: "registration_submissions_policy_fk", columns: [t.eventId, t.policyVersion, t.formVersion],
    foreignColumns: [eventPolicies.eventId, eventPolicies.version, eventPolicies.formVersion] }),
  check("registration_submissions_payload", sql`(${t.payloadPurgedAt} is null and
    application_v2_ok(${t.application}) is true and request_receipt_v1_ok(${t.receipt}) is true) or
    (${t.payloadPurgedAt} is not null and ${t.application} is null and ${t.receipt} is null)`),
  check("registration_submissions_hash", sql`${t.inputHash} ~ '^[0-9a-f]{64}$'`),
  index("registration_submissions_registration_idx").on(t.registrationId, t.createdAt),
]);
/** Staff personal access tokens. Only a SHA-256 digest is retained. */
export const apiTokens = pgTable("api_tokens", {
  id: id(), name: text("name").notNull(), tokenHash: text("token_hash").notNull().unique(),
  staffEmail: text("staff_email").notNull().references(() => staff.email, { onDelete: "cascade" }),
  createdAt: created(), lastUsedAt: time("last_used_at"),
  expiresAt: time("expires_at").notNull().default(sql`now() + interval '365 days'`), revokedAt: time("revoked_at"),
}, t => [index("api_tokens_staff_idx").on(t.staffEmail), check("api_tokens_name", sql`char_length(btrim(${t.name})) between 1 and 100`)]);
/** "Is this you?" profile suggestions (public LinkedIn / X URLs), 24 h per account and hashed (name, company). */
export const socialSuggestions = pgTable("social_suggestions", {
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }), queryHash: text("query_hash").notNull(),
  result: jsonb("result").$type<{ linkedin: { url: string; label: string }[]; x: { url: string; label: string }[] }>().notNull(), expiresAt: time("expires_at").notNull(), createdAt: created(),
}, t => [primaryKey({ columns: [t.accountId, t.queryHash] })]);
