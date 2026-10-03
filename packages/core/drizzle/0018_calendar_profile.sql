CREATE TABLE "calendar_profiles" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cover" "bytea",
	"cover_type" text,
	"cover_version" integer DEFAULT 0 NOT NULL,
	"logo" "bytea",
	"logo_type" text,
	"logo_version" integer DEFAULT 0 NOT NULL,
	"website_url" text,
	"x_url" text,
	"linkedin_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "calendar_profiles_key" CHECK ("calendar_profiles"."key" = 'default'),
	CONSTRAINT "calendar_profiles_text" CHECK (char_length("calendar_profiles"."name") between 1 and 80 and char_length("calendar_profiles"."tagline") <= 120 and char_length("calendar_profiles"."description") <= 600),
	CONSTRAINT "calendar_profiles_cover" CHECK (("calendar_profiles"."cover" is null) = ("calendar_profiles"."cover_type" is null) and ("calendar_profiles"."cover_type" is null or "calendar_profiles"."cover_type" in ('image/jpeg','image/png','image/webp')) and "calendar_profiles"."cover_version" >= 0),
	CONSTRAINT "calendar_profiles_logo" CHECK (("calendar_profiles"."logo" is null) = ("calendar_profiles"."logo_type" is null) and ("calendar_profiles"."logo_type" is null or "calendar_profiles"."logo_type" in ('image/jpeg','image/png','image/webp')) and "calendar_profiles"."logo_version" >= 0),
	CONSTRAINT "calendar_profiles_links" CHECK (("calendar_profiles"."website_url" is null or "calendar_profiles"."website_url" like 'https://%') and ("calendar_profiles"."x_url" is null or "calendar_profiles"."x_url" like 'https://%') and ("calendar_profiles"."linkedin_url" is null or "calendar_profiles"."linkedin_url" like 'https://%'))
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "place_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "maps_url" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_place_coords" CHECK (("events"."lat" is null) = ("events"."lng" is null) and ("events"."lat" is null or ("events"."lat" between -90 and 90 and "events"."lng" between -180 and 180)));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_maps_url" CHECK ("events"."maps_url" is null or "events"."maps_url" like 'https://%');