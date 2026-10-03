ALTER TABLE "invites" ADD COLUMN "message" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "skip_approval" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "application" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "staff_note" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "undo_rejection" jsonb;