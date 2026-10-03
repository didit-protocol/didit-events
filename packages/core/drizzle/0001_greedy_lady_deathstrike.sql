CREATE TYPE "public"."admission" AS ENUM('pending', 'approved', 'waitlisted', 'rejected', 'cancelled_by_guest', 'cancelled_by_host', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."auth_method" AS ENUM('oidc_google', 'email_otp');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'published', 'live', 'ended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."evidence_kind" AS ENUM('identity', 'face', 'age');--> statement-breakpoint
CREATE TYPE "public"."evidence_state" AS ENUM('active', 'pending_continuity', 'superseded', 'invalidated');--> statement-breakpoint
CREATE TYPE "public"."principal" AS ENUM('staff', 'guest');--> statement-breakpoint
CREATE TYPE "public"."scan_result" AS ENUM('welcomed', 'welcome_back', 'unknown', 'ambiguous', 'not_on_list', 'not_admitted', 'not_verified', 'no_face', 'inconclusive', 'paused', 'budget_exhausted', 'error');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('owner', 'admin', 'staff');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('created', 'started', 'approved', 'in_review', 'declined', 'abandoned', 'expired', 'superseded');--> statement-breakpoint
CREATE TABLE "account_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_issuer_subject" UNIQUE("issuer","subject")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"photo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleting_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "accounts_email_unique" UNIQUE("email"),
	CONSTRAINT "accounts_email_normalized" CHECK ("accounts"."email" = lower(btrim("accounts"."email")))
);
--> statement-breakpoint
CREATE TABLE "admission_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"from" "admission",
	"to" "admission" NOT NULL,
	"actor" text NOT NULL,
	"reason" text,
	"over_capacity" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"event_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"kiosk_id" uuid,
	"face_evidence_id" uuid,
	"method" text NOT NULL,
	"similarity" integer,
	"by_staff" text,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" text,
	CONSTRAINT "checkins_method" CHECK ("checkins"."method" in ('face','manual')),
	CONSTRAINT "checkins_similarity" CHECK ("checkins"."similarity" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"key" text PRIMARY KEY NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "counters_nonnegative" CHECK ("counters"."value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_hash" text NOT NULL,
	"account_id" uuid,
	"didit_session_ids" jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"manual_completed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deletions_email_hash_unique" UNIQUE("email_hash"),
	CONSTRAINT "deletions_state" CHECK ("deletions"."state" in ('pending','remote_pending','manual','complete'))
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"agenda" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"speakers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" text DEFAULT 'Europe/Madrid' NOT NULL,
	"venue" text,
	"address" text,
	"capacity" integer NOT NULL,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"registration_mode" text DEFAULT 'request' NOT NULL,
	"registration_closes_at" timestamp with time zone,
	"requirements" jsonb DEFAULT '{"identity":true,"email":true,"liveness":true}'::jsonb NOT NULL,
	"max_age" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"age_min" integer,
	"match_threshold" integer DEFAULT 80 NOT NULL,
	"door_mode" text DEFAULT 'supervised' NOT NULL,
	"cover" jsonb,
	"welcome_options" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug"),
	CONSTRAINT "events_capacity" CHECK ("events"."capacity" > 0),
	CONSTRAINT "events_threshold" CHECK ("events"."match_threshold" between 60 and 99),
	CONSTRAINT "events_dates" CHECK ("events"."ends_at" > "events"."starts_at"),
	CONSTRAINT "events_age_min" CHECK ("events"."age_min" between 1 and 100),
	CONSTRAINT "events_mode" CHECK ("events"."registration_mode" in ('request','invite_only','open')),
	CONSTRAINT "events_door_mode" CHECK ("events"."door_mode" in ('supervised','strict')),
	CONSTRAINT "events_requirements_object" CHECK (jsonb_typeof("events"."requirements") = 'object' and jsonb_typeof("events"."max_age") = 'object')
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"verification_id" uuid NOT NULL,
	"kind" "evidence_kind" NOT NULL,
	"value" jsonb,
	"established_at" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"invalidated_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"state" "evidence_state" DEFAULT 'active' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_verification_kind" UNIQUE("verification_id","kind"),
	CONSTRAINT "evidence_validity" CHECK ("evidence"."valid_until" > "evidence"."established_at"),
	CONSTRAINT "evidence_age_value" CHECK ("evidence"."kind" <> 'age' or ("evidence"."value" is not null and jsonb_typeof("evidence"."value") = 'number'))
);
--> statement-breakpoint
CREATE TABLE "inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"raw" text,
	"headers" jsonb,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "inbox_attempts" CHECK ("inbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invite_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_redemptions_invite_account" UNIQUE("invite_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"email" text,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invites_uses" CHECK ("invites"."max_uses" > 0 and "invites"."uses" between 0 and "invites"."max_uses"),
	CONSTRAINT "invites_email_normalized" CHECK ("invites"."email" = lower(btrim("invites"."email")))
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"name" text PRIMARY KEY NOT NULL,
	"interval_sec" integer NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "jobs_interval" CHECK ("jobs"."interval_sec" > 0)
);
--> statement-breakpoint
CREATE TABLE "kiosks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text,
	"token_expires_at" timestamp with time zone,
	"token_issued_at" timestamp with time zone,
	"previous_token_hash" text,
	"previous_token_expires_at" timestamp with time zone,
	"rotation_ciphertext" text,
	"paired_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"paused" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kiosks_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "kiosks_previous_token_hash_unique" UNIQUE("previous_token_hash"),
	CONSTRAINT "kiosks_event_id_id" UNIQUE("event_id","id")
);
--> statement-breakpoint
CREATE TABLE "link_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hash" text NOT NULL,
	"scope" text DEFAULT 'verification' NOT NULL,
	"registration_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "link_tokens_hash_unique" UNIQUE("hash"),
	CONSTRAINT "link_tokens_scope" CHECK ("link_tokens"."scope" = 'verification')
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"purpose" text DEFAULT 'login' NOT NULL,
	"didit_request_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"redeemed_at" timestamp with time zone,
	"ip" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_challenges_didit_request_id_unique" UNIQUE("didit_request_id"),
	CONSTRAINT "otp_purpose" CHECK ("otp_challenges"."purpose" = 'login'),
	CONSTRAINT "otp_attempts" CHECK ("otp_challenges"."attempts" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_id" text,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "outbox_status" CHECK ("outbox"."status" in ('pending','sent')),
	CONSTRAINT "outbox_attempts" CHECK ("outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"kiosk_id" uuid NOT NULL,
	"hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pairing_codes_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"admission" "admission" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"internal_reason" text,
	"late_cancellation" boolean DEFAULT false NOT NULL,
	"over_capacity" boolean DEFAULT false NOT NULL,
	"reapplication_count" integer DEFAULT 0 NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registrations_event_account" UNIQUE("event_id","account_id"),
	CONSTRAINT "registrations_event_id_id" UNIQUE("event_id","id"),
	CONSTRAINT "registrations_reapplication_count" CHECK ("registrations"."reapplication_count" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"kiosk_id" uuid NOT NULL,
	"registration_id" uuid,
	"result" "scan_result" NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scans_latency" CHECK ("scans"."latency_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"principal" "principal" NOT NULL,
	"auth_method" "auth_method" NOT NULL,
	"account_id" uuid,
	"staff_email" text,
	"rotated_from" uuid,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"authenticated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sessions_principal_binding" CHECK (("sessions"."principal" = 'guest' and "sessions"."account_id" is not null and "sessions"."staff_email" is null) or ("sessions"."principal" = 'staff' and "sessions"."staff_email" is not null and "sessions"."account_id" is null and "sessions"."auth_method" = 'oidc_google'))
);
--> statement-breakpoint
CREATE TABLE "spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"op" text NOT NULL,
	"usd_max_micros" bigint NOT NULL,
	"actual_micros" bigint,
	"scopes" jsonb NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"dispatched_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spend_amounts" CHECK ("spend"."usd_max_micros" > 0 and ("spend"."actual_micros" is null or "spend"."actual_micros" between 0 and "spend"."usd_max_micros")),
	CONSTRAINT "spend_state" CHECK ("spend"."state" in ('reserved','uncertain','settled'))
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"email" text PRIMARY KEY NOT NULL,
	"role" "staff_role" DEFAULT 'staff' NOT NULL,
	"invited_by" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_email_normalized" CHECK ("staff"."email" = lower(btrim("staff"."email")))
);
--> statement-breakpoint
CREATE TABLE "verification_ops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"verification_id" uuid,
	"state" text DEFAULT 'creating' NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "verification_ops_state" CHECK ("verification_ops"."state" in ('creating','active','completed','failed','expired')),
	CONSTRAINT "verification_ops_kind" CHECK ("verification_ops"."kind" in ('full','renewal','age'))
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"didit_session_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"vendor_data" text NOT NULL,
	"status" "verification_status" DEFAULT 'created' NOT NULL,
	"provider_status" text,
	"policy_state" text,
	"policy_reason" text,
	"q_first_name" text,
	"q_last_name" text,
	"verified_email" text,
	"email_matches" boolean,
	"liveness_at" timestamp with time zone,
	"age_estimate" integer,
	"decision" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"fetched_at" timestamp with time zone,
	"next_fetch_at" timestamp with time zone,
	CONSTRAINT "verifications_didit_session_id_unique" UNIQUE("didit_session_id"),
	CONSTRAINT "verifications_account_id_id" UNIQUE("account_id","id")
);
--> statement-breakpoint
ALTER TABLE "account_identities" ADD CONSTRAINT "account_identities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_history" ADD CONSTRAINT "admission_history_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit" ADD CONSTRAINT "audit_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_face_evidence_id_evidence_id_fk" FOREIGN KEY ("face_evidence_id") REFERENCES "public"."evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_by_staff_staff_email_fk" FOREIGN KEY ("by_staff") REFERENCES "public"."staff"("email") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_undone_by_staff_email_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."staff"("email") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_event_registration_fk" FOREIGN KEY ("event_id","registration_id") REFERENCES "public"."registrations"("event_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_event_kiosk_fk" FOREIGN KEY ("event_id","kiosk_id") REFERENCES "public"."kiosks"("event_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletions" ADD CONSTRAINT "deletions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_account_verification_fk" FOREIGN KEY ("account_id","verification_id") REFERENCES "public"."verifications"("account_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_staff_email_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("email") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosks" ADD CONSTRAINT "kiosks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_tokens" ADD CONSTRAINT "link_tokens_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_event_id_kiosk_id_kiosks_event_id_id_fk" FOREIGN KEY ("event_id","kiosk_id") REFERENCES "public"."kiosks"("event_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_event_id_kiosk_id_kiosks_event_id_id_fk" FOREIGN KEY ("event_id","kiosk_id") REFERENCES "public"."kiosks"("event_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_event_id_registration_id_registrations_event_id_id_fk" FOREIGN KEY ("event_id","registration_id") REFERENCES "public"."registrations"("event_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_staff_email_staff_email_fk" FOREIGN KEY ("staff_email") REFERENCES "public"."staff"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_rotated_from_sessions_id_fk" FOREIGN KEY ("rotated_from") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_invited_by_staff_email_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."staff"("email") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_ops" ADD CONSTRAINT "verification_ops_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_ops" ADD CONSTRAINT "verification_ops_verification_id_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."verifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identities_account_idx" ON "account_identities" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "admission_history_registration_idx" ON "admission_history" USING btree ("registration_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_event_snapshot_idx" ON "audit" USING btree ("event_id","updated_at");--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit" USING btree ("target");--> statement-breakpoint
CREATE UNIQUE INDEX "checkins_active_registration" ON "checkins" USING btree ("registration_id") WHERE "checkins"."undone_at" is null;--> statement-breakpoint
CREATE INDEX "checkins_event_idx" ON "checkins" USING btree ("event_id","checked_in_at");--> statement-breakpoint
CREATE INDEX "counters_expiry_idx" ON "counters" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "deletions_sessions_idx" ON "deletions" USING gin ("didit_session_ids");--> statement-breakpoint
CREATE INDEX "deletions_due_idx" ON "deletions" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "events_status_starts_idx" ON "events" USING btree ("status","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_one_current_face" ON "evidence" USING btree ("account_id") WHERE "evidence"."kind" = 'face' and "evidence"."state" = 'active' and "evidence"."invalidated_at" is null and "evidence"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "evidence_account_kind_idx" ON "evidence" USING btree ("account_id","kind");--> statement-breakpoint
CREATE INDEX "evidence_retention_idx" ON "evidence" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX "inbox_due_idx" ON "inbox" USING btree ("next_attempt_at") WHERE "inbox"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "invite_redemptions_account_idx" ON "invite_redemptions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "invites_event_idx" ON "invites" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "kiosks_event_idx" ON "kiosks" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "link_tokens_registration_idx" ON "link_tokens" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "otp_email_idx" ON "otp_challenges" USING btree ("email","expires_at");--> statement-breakpoint
CREATE INDEX "outbox_due_idx" ON "outbox" USING btree ("next_attempt_at") WHERE "outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "pairing_codes_active_idx" ON "pairing_codes" USING btree ("event_id","expires_at") WHERE "pairing_codes"."used_at" is null;--> statement-breakpoint
CREATE INDEX "registrations_account_idx" ON "registrations" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "registrations_waitlist_idx" ON "registrations" USING btree ("event_id","admission","applied_at");--> statement-breakpoint
CREATE INDEX "scans_snapshot_idx" ON "scans" USING btree ("event_id","updated_at");--> statement-breakpoint
CREATE INDEX "scans_retention_idx" ON "scans" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sessions_account_idx" ON "sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "sessions_staff_idx" ON "sessions" USING btree ("staff_email");--> statement-breakpoint
CREATE INDEX "spend_reconcile_idx" ON "spend" USING btree ("state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_ops_active" ON "verification_ops" USING btree ("account_id","workflow_id") WHERE "verification_ops"."state" in ('creating','active');--> statement-breakpoint
CREATE INDEX "verification_ops_due_idx" ON "verification_ops" USING btree ("state","expires_at");--> statement-breakpoint
CREATE INDEX "verifications_account_idx" ON "verifications" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "verifications_reconcile_idx" ON "verifications" USING btree ("next_fetch_at","fetched_at");