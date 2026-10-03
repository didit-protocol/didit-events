import { beforeAll } from "vitest";

const missing = !process.env.TEST_DATABASE_URL;
export const skipPostgres = missing && !process.env.CI;
if (skipPostgres) console.warn("WARNING: Postgres suites skipped: TEST_DATABASE_URL is absent. PGlite cannot prove distributed locking.");

// Imported at file scope by every Postgres suite, including mixed-driver suites.
beforeAll(() => {
  if (process.env.CI && missing) throw new Error("CI requires TEST_DATABASE_URL for real Postgres suites");
});
