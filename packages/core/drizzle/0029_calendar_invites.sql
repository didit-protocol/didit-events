CREATE TABLE "calendar_invites" (
	"registration_id" uuid PRIMARY KEY NOT NULL,
	"sequence" integer NOT NULL,
	"method" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_invites_sequence" CHECK ("calendar_invites"."sequence" >= 0),
	CONSTRAINT "calendar_invites_method" CHECK ("calendar_invites"."method" in ('REQUEST','CANCEL'))
);
--> statement-breakpoint
ALTER TABLE "calendar_invites" ADD CONSTRAINT "calendar_invites_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;