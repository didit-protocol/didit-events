import { readMigrationFiles, type MigrationConfig } from "drizzle-orm/migrator";
import type { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { DEFAULT_SEED_OWNER_EMAIL, seedOwnerEmail } from "../config.ts";

type MigrationDatabase = ReturnType<typeof drizzlePglite> | ReturnType<typeof drizzlePostgres>;
// Drizzle's public migrators call this internal method with the owning driver's session.
// Its published PgDialect signature fixes an empty schema, so describe only the shared migration contract here.
type MigrationDialect = {
  migrate(migrations: ReturnType<typeof readMigrationFiles>, session: MigrationDatabase["_"]["session"], config: MigrationConfig): Promise<void>;
};

/** Shared by the CLI and Docker runner. Keep original migration hashes and transaction/skip semantics. */
export async function migrateDatabase(database: MigrationDatabase, config: MigrationConfig): Promise<void> {
  const migrations = readMigrationFiles(config);
  const owner = seedOwnerEmail();
  const seedStatement = `INSERT INTO "staff" ("email", "role") VALUES ('${DEFAULT_SEED_OWNER_EMAIL}', 'owner')`;
  for (const migration of migrations) {
    // Match only the historical bootstrap statement from Drizzle's parsed files, without journal internals.
    // Keep its original hash and Drizzle's transaction/skip semantics.
    migration.sql = migration.sql.map(statement => statement.replace(seedStatement,
      () => `INSERT INTO "staff" ("email", "role") VALUES ('${owner.replaceAll("'", "''")}', 'owner')`));
  }
  // Both installed driver migrators use their database's own dialect and session. Preserve that pair;
  // only expose the internal dialect omitted from Drizzle's declarations, never cast one driver's session to another.
  const { dialect } = database as MigrationDatabase & { dialect: MigrationDialect };
  await dialect.migrate(migrations, database._.session, config);
}
