ALTER TABLE "outbox" DROP CONSTRAINT "outbox_status";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "email_reminders" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "email_content" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "delivery_status" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "delivery_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "failed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "outbox_provider_idx" ON "outbox" USING btree ("provider_id");--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_delivery_status" CHECK ("outbox"."delivery_status" is null or "outbox"."delivery_status" in ('sent','delivery_delayed','delivered','bounced','complained'));--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_status" CHECK ("outbox"."status" in ('pending','sent','failed'));