ALTER TYPE "public"."scan_result" ADD VALUE 'liveness_failed';--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "provider_status" text DEFAULT 'in_review' NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "activation" text DEFAULT 'pending_continuity' NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "invalidated_reason" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "recovered_by" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "recovery_reason" text;--> statement-breakpoint
-- Preserve existing F1 evidence; uncertain/invalidated legacy rows fail closed.
UPDATE "evidence" SET
  "provider_status" = CASE WHEN "invalidated_at" IS NOT NULL OR "state" = 'invalidated' THEN 'withdrawn' ELSE 'approved' END,
  "activation" = CASE WHEN "superseded_at" IS NOT NULL OR "state" = 'superseded' THEN 'superseded'
    WHEN "invalidated_at" IS NOT NULL OR "state" = 'invalidated' THEN 'revoked'
    WHEN "state" = 'active' THEN 'active' ELSE 'pending_continuity' END,
  "invalidated_reason" = CASE WHEN "invalidated_at" IS NOT NULL OR "state" = 'invalidated' THEN COALESCE("reason", 'legacy_invalidation') ELSE NULL END;--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_one_active_face" ON "evidence" USING btree ("account_id") WHERE "evidence"."kind" = 'face' and "evidence"."activation" = 'active';--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_provider_status" CHECK ("evidence"."provider_status" in ('approved','withdrawn','in_review','declined'));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_activation" CHECK ("evidence"."activation" in ('pending_continuity','active','superseded','revoked'));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_recovery_pair" CHECK (("evidence"."recovered_by" is null and "evidence"."recovery_reason" is null) or ("evidence"."recovered_by" is not null and "evidence"."recovery_reason" is not null and length(btrim("evidence"."recovered_by")) > 0 and length(btrim("evidence"."recovery_reason")) > 0));