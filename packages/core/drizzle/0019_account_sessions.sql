ALTER TABLE "sessions" ADD COLUMN "rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "csrf_token" text;--> statement-breakpoint
CREATE INDEX "sessions_rotated_from_idx" ON "sessions" USING btree ("rotated_from");