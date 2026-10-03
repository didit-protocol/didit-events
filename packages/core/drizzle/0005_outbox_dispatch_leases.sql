ALTER TABLE "outbox" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_lease_pair" CHECK (("outbox"."claim_token" is null) = ("outbox"."locked_until" is null));