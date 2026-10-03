ALTER TABLE "verification_ops" DROP CONSTRAINT "verification_ops_state";--> statement-breakpoint
ALTER TABLE "verification_ops" ADD COLUMN "replacement_op_id" uuid;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "reconcile_state" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "fetch_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "verification_ops" ADD CONSTRAINT "verification_ops_replacement_op_id_verification_ops_id_fk" FOREIGN KEY ("replacement_op_id") REFERENCES "public"."verification_ops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_ops" ADD CONSTRAINT "verification_ops_state" CHECK ("verification_ops"."state" in ('creating','active','completed','failed','expired','stale'));