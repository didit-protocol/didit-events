ALTER TABLE "checkins" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "checkins_snapshot_idx" ON "checkins" USING btree ("event_id","updated_at");
--> statement-breakpoint
-- Plan section 2: initial owner. Existing staff policy is never overwritten.
INSERT INTO "staff" ("email", "role") VALUES ('events.owner@didit.me', 'owner')
ON CONFLICT ("email") DO NOTHING;
