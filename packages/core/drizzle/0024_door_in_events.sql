CREATE TABLE "door_pins" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"pin_hash" text NOT NULL,
	"set_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "door_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"kiosk_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" text,
	CONSTRAINT "door_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "event_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "event_members_role" CHECK ("event_members"."role" in ('host','operator')),
	CONSTRAINT "event_members_email_normalized" CHECK ("event_members"."email" = lower(btrim("event_members"."email")) and position('@' in "event_members"."email") > 1)
);
--> statement-breakpoint
DROP TABLE "pairing_codes" CASCADE;--> statement-breakpoint
ALTER TABLE "kiosks" DROP CONSTRAINT "kiosks_token_hash_unique";--> statement-breakpoint
ALTER TABLE "kiosks" DROP CONSTRAINT "kiosks_previous_token_hash_unique";--> statement-breakpoint
ALTER TABLE "checkins" DROP CONSTRAINT "checkins_by_staff_staff_email_fk";
--> statement-breakpoint
ALTER TABLE "checkins" DROP CONSTRAINT "checkins_undone_by_staff_email_fk";
--> statement-breakpoint
ALTER TABLE "invites" DROP CONSTRAINT "invites_created_by_staff_email_fk";
--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "door_pins" ADD CONSTRAINT "door_pins_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "door_sessions" ADD CONSTRAINT "door_sessions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "door_sessions" ADD CONSTRAINT "door_sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "door_sessions" ADD CONSTRAINT "door_sessions_station_fk" FOREIGN KEY ("event_id","kiosk_id") REFERENCES "public"."kiosks"("event_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_members" ADD CONSTRAINT "event_members_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "door_sessions_event_idx" ON "door_sessions" USING btree ("event_id","ended_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_members_active" ON "event_members" USING btree ("event_id","email") WHERE "event_members"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "event_members_email_idx" ON "event_members" USING btree ("email");--> statement-breakpoint
ALTER TABLE "kiosks" DROP COLUMN "token_hash";--> statement-breakpoint
ALTER TABLE "kiosks" DROP COLUMN "token_expires_at";--> statement-breakpoint
ALTER TABLE "kiosks" DROP COLUMN "token_issued_at";--> statement-breakpoint
ALTER TABLE "kiosks" DROP COLUMN "previous_token_hash";--> statement-breakpoint
ALTER TABLE "kiosks" DROP COLUMN "previous_token_expires_at";--> statement-breakpoint
ALTER TABLE "kiosks" DROP COLUMN "rotation_ciphertext";--> statement-breakpoint
ALTER TABLE "kiosks" DROP COLUMN "paired_at";--> statement-breakpoint
ALTER TABLE "kiosks" DROP COLUMN "paused";