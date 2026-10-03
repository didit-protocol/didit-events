-- v1.3.7: "Is this you?" LinkedIn / X suggestions on the profile step, cached 24 h per account and hashed (name, company).

CREATE TABLE "social_suggestions" (
	"account_id" uuid NOT NULL,
	"query_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_suggestions_account_id_query_hash_pk" PRIMARY KEY("account_id","query_hash")
);
--> statement-breakpoint
ALTER TABLE "social_suggestions" ADD CONSTRAINT "social_suggestions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;