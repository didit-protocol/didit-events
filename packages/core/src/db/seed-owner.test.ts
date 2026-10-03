import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testDatabase } from "../testing/database.ts";
import { migrate, MIGRATIONS_DIR } from "./migrate.ts";
import { queryable } from "./tx.ts";

afterEach(() => vi.unstubAllEnvs());

for (const kind of ["pglite", ...(process.env.TEST_DATABASE_URL ? ["postgres"] : [])] as const) {
  describe(`seed owner ${kind}`, () => {
    it.each([undefined, " Owner@Fork.Test ", "o'connor@fork.test", "owner$&@fork.test"])("seeds %j once while preserving original migration hashes", async configured => {
      vi.stubEnv("STAFF_EMAIL_DOMAIN", configured === undefined ? undefined : "fork.test");
      vi.stubEnv("SEED_OWNER_EMAIL", configured);
      const database = await testDatabase(kind as "pglite" | "postgres");
      try {
        const q = queryable(database.db), expected = configured?.trim().toLowerCase() ?? "events.owner@didit.me";
        expect(await q.query("select email,role from staff")).toEqual([{ email: expected, role: "owner" }]);
        const original = readMigrationFiles({ migrationsFolder: MIGRATIONS_DIR });
        expect((await q.query<{ hash: string }>("select hash from drizzle.__drizzle_migrations order by created_at")).map(row => row.hash)).toEqual(original.map(migration => migration.hash));
        // Later deployments cannot change the existing owner's policy or add another owner via this setting.
        await q.query("update staff set role='admin',disabled_at=clock_timestamp() where email=$1", [expected]);
        vi.stubEnv("STAFF_EMAIL_DOMAIN", "fork.test");
        vi.stubEnv("SEED_OWNER_EMAIL", "another@fork.test");
        await migrate(database.db);
        vi.stubEnv("SEED_OWNER_EMAIL", undefined);
        vi.stubEnv("STAFF_EMAIL_DOMAIN", undefined);
        await migrate(database.db);
        expect(await q.query("select email,role,disabled_at is not null as disabled from staff")).toEqual([{ email: expected, role: "admin", disabled: true }]);
      } finally { await database.close(); }
    });
  });
}
