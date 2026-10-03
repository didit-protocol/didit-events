import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export { schema };

export type Db =
  | { kind: "postgres"; client: ReturnType<typeof postgres>; db: ReturnType<typeof drizzlePostgres<typeof schema>>; createDedicatedClient: () => ReturnType<typeof postgres>; close: () => Promise<void> }
  | { kind: "pglite"; client: PGlite; db: ReturnType<typeof drizzlePglite<typeof schema>>; close: () => Promise<void> };

/**
 * Default PGlite directory: <repo>/apps/events/.data/pglite. The repo root is found by walking up from the cwd to
 * pnpm-workspace.yaml (import.meta.url is useless once Next.js bundles this file); outside a checkout it falls back
 * to <cwd>/.data/pglite.
 */
export function defaultPgliteDir(cwd: string = process.cwd()): string {
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return join(dir, "apps", "events", ".data", "pglite");
    if (dirname(dir) === dir) return join(cwd, ".data", "pglite");
  }
}

export interface DbOptions {
  /** Postgres connection string. Defaults to process.env.DATABASE_URL. */
  url?: string;
  /** PGlite data directory used when no URL is set. Defaults to PGLITE_DIR or defaultPgliteDir(). */
  pgliteDir?: string;
}

export function createDb(options: DbOptions = {}): Db {
  const url = options.url ?? process.env.DATABASE_URL;
  if (url) {
    const connect = (max: number) => postgres(url, {
      max,
      ssl: /sslmode=require|amazonaws\.com/.test(url) ? "require" : undefined,
      onnotice: () => {},
    });
    const client = connect(5);
    return { kind: "postgres", client, db: drizzlePostgres(client, { schema }), createDedicatedClient: () => connect(1), close: () => client.end() };
  }
  const dir = options.pgliteDir || process.env.PGLITE_DIR || defaultPgliteDir();
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  return { kind: "pglite", client, db: drizzlePglite(client, { schema }), close: () => client.close() };
}

const globalForDb = globalThis as typeof globalThis & { __diditEventsDb?: Db };

/** Process-wide database handle (cached across Next.js hot reloads). */
export function getDb(): Db {
  globalForDb.__diditEventsDb ??= createDb();
  return globalForDb.__diditEventsDb;
}
