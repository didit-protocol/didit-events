/**
 * Applies the Drizzle migrations in /app/migrate/drizzle before the server starts (docker/entrypoint.sh).
 *
 * drizzle-orm and postgres are bundled into the Next.js server chunks, so this script runs from its own
 * production-only bundle of @didit-events/core (`pnpm deploy`, see the Dockerfile). It uses the same migration helper
 * as `pnpm db:migrate` (Node strips the helper's TypeScript types), so SEED_OWNER_EMAIL names the first owner here
 * too. Like `pnpm db:migrate` it stops before touching the database when the instance has no staff domain, owner, face workflow or
 * (with a Resend key) sender and email footer of its own. It adds:
 *   - a session-level advisory lock, so several containers starting together apply the migrations one after the other;
 *   - lock_timeout / statement_timeout, so a migration never sits on a blocking lock for long.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requireInstanceIdentity } from "./src/config.ts";
import { migrateDatabase } from "./src/db/migrations.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}
try {
  requireInstanceIdentity();
} catch (error) {
  console.error("[migrate]", error instanceof Error ? error.message : error);
  process.exit(1);
}

/** Arbitrary constant: the advisory lock that serialises migrations of this app in the database. */
const ADVISORY_LOCK_KEY = 5140323;
const migrationsFolder = new URL("./drizzle", import.meta.url).pathname;

const client = postgres(url, {
  max: 1,
  ssl: /sslmode=require/.test(url) ? "require" : undefined,
  connection: { application_name: "didit-events-migrate", statement_timeout: "600s" },
  onnotice: () => {},
});

try {
  await client`set lock_timeout = '300s'`;
  await client`select pg_advisory_lock(${ADVISORY_LOCK_KEY})`;
  await client`set lock_timeout = '10s'`;
  await migrateDatabase(drizzle(client), { migrationsFolder });
  await client`select pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;
  console.log("[migrate] migrations applied");
} catch (error) {
  console.error("[migrate] failed:", error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
