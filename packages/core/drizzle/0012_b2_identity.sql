CREATE TABLE "oidc_transactions" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "otp_deliveries" (
	"email_hash" text PRIMARY KEY NOT NULL,
	"owner" uuid NOT NULL,
	"lease_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "photo" "bytea";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "headline" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "company" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "job_role" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "profile_links" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "marketing_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deletions" ADD COLUMN "original_account_id" uuid;--> statement-breakpoint
ALTER TABLE "deletions" ADD COLUMN "manual_reason" text;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN "binding_hash" text;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN "sends" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN "last_sent_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN "check_token" uuid;
--> statement-breakpoint
UPDATE "deletions" SET "original_account_id"="account_id" WHERE "account_id" IS NOT NULL;
