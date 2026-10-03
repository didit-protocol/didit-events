ALTER TABLE "evidence" ADD COLUMN "continuity_of" uuid;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_continuity_account_fk" FOREIGN KEY ("account_id","continuity_of") REFERENCES "public"."verifications"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_continuity_not_self" CHECK ("evidence"."continuity_of" <> "evidence"."verification_id");--> statement-breakpoint
-- Repair non-face proofs activated by the old per-face continuity gate. No historical
-- continuity links are inferred; null links deliberately fail closed across sessions.
UPDATE "evidence" AS proof SET "activation" = 'pending_continuity', "state" = 'pending_continuity'
FROM "evidence" AS face
WHERE proof.verification_id = face.verification_id AND proof.account_id = face.account_id
  AND face.kind = 'face' AND face.activation = 'pending_continuity'
  AND proof.kind <> 'face' AND proof.activation = 'active';
