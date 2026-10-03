ALTER TABLE "verifications" ADD COLUMN "accepted_email" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "email_accepted_by" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "email_accepted_at" timestamp with time zone;