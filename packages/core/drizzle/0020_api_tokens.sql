CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"staff_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone DEFAULT now() + interval '365 days' NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "api_tokens_name" CHECK (char_length(btrim("api_tokens"."name")) between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_staff_email_staff_email_fk" FOREIGN KEY ("staff_email") REFERENCES "public"."staff"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_tokens_staff_idx" ON "api_tokens" USING btree ("staff_email");