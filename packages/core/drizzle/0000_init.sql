CREATE TABLE "health" (
	"id" serial PRIMARY KEY NOT NULL,
	"note" text DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
