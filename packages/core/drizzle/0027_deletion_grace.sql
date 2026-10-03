ALTER TABLE "deletions" ADD COLUMN "grace_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deletions" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "deletions" ADD COLUMN "restore" jsonb;