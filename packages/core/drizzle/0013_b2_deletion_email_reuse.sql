ALTER TABLE "deletions" ALTER COLUMN "email_hash" DROP NOT NULL;
--> statement-breakpoint
UPDATE "deletions" SET "email_hash"=NULL WHERE "state"='complete';
