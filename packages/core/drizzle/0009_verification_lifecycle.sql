CREATE TABLE "verification_attachments" (
	"op_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"attached_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_attachment_op_registration" UNIQUE("op_id","registration_id")
);
--> statement-breakpoint
CREATE TABLE "verification_discovery" (
	"workflow_id" uuid PRIMARY KEY NOT NULL,
	"completed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "has_face_history" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "first_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "hosted_url" text;--> statement-breakpoint
ALTER TABLE "verification_attachments" ADD CONSTRAINT "verification_attachments_op_id_verification_ops_id_fk" FOREIGN KEY ("op_id") REFERENCES "public"."verification_ops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_attachments" ADD CONSTRAINT "verification_attachments_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
UPDATE accounts SET has_face_history=true WHERE EXISTS (SELECT 1 FROM evidence WHERE evidence.account_id=accounts.id AND kind='face') OR EXISTS (SELECT 1 FROM verifications WHERE verifications.account_id=accounts.id AND liveness_at IS NOT NULL);
--> statement-breakpoint
UPDATE verifications v SET first_approved_at=coalesce((SELECT min(established_at) FROM evidence e WHERE e.verification_id=v.id),v.liveness_at);
