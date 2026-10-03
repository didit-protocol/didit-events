import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrateDatabase } from "./migrations.ts";
import type { Db } from "./index.ts";

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

/** Applies every pending Drizzle migration in packages/core/drizzle to either driver. */
export async function migrate(handle: Db, migrationsFolder: string = MIGRATIONS_DIR): Promise<void> {
  // Migrations need no relational schema. Each driver constructs its own dialect/session on the existing client.
  const database = handle.kind === "pglite" ? drizzlePglite(handle.client) : drizzlePostgres(handle.client);
  await migrateDatabase(database, { migrationsFolder });
}
