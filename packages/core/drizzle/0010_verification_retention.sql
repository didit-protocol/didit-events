ALTER TABLE "verifications" ADD COLUMN "evidence_expires_at" timestamp with time zone;
--> statement-breakpoint
UPDATE verifications v SET evidence_expires_at=(SELECT max(valid_until) FROM evidence e WHERE e.verification_id=v.id);
