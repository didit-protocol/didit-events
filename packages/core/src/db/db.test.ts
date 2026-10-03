import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, getDb } from "./index.ts";
import { migrate } from "./migrate.ts";
import { health } from "./schema.ts";

type DbGlobal = typeof globalThis & { __diditEventsDb?: { close: () => Promise<void> } };

const tmpRoot = resolve(import.meta.dirname, "../../../../.vitest-tmp");
mkdirSync(tmpRoot, { recursive: true });
const dir = mkdtempSync(join(tmpRoot, "pglite-"));

describe("PGlite database", () => {
  const savedUrl = process.env.DATABASE_URL;
  const savedDir = process.env.PGLITE_DIR;

  afterAll(async () => {
    const g = globalThis as DbGlobal;
    await g.__diditEventsDb?.close();
    delete g.__diditEventsDb;
    if (savedUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedUrl;
    if (savedDir === undefined) delete process.env.PGLITE_DIR;
    else process.env.PGLITE_DIR = savedDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it("getDb() falls back to PGlite, migrates, and answers select 1", async () => {
    delete process.env.DATABASE_URL;
    process.env.PGLITE_DIR = dir;
    const handle = getDb();
    if (handle.kind !== "pglite") throw new Error(`expected pglite, got ${handle.kind}`);
    await migrate(handle);
    await migrate(handle); // idempotent
    const result = await handle.db.execute(sql`select 1 as one`);
    expect(result.rows).toEqual([{ one: 1 }]);
    const [row] = await handle.db.insert(health).values({}).returning();
    expect(row?.note).toBe("ok");
  });

  it("persists to disk across handles", async () => {
    const g = globalThis as DbGlobal;
    await g.__diditEventsDb?.close();
    delete g.__diditEventsDb;
    const reopened = createDb({ pgliteDir: dir });
    if (reopened.kind !== "pglite") throw new Error("expected pglite");
    const rows = await reopened.db.select().from(health);
    expect(rows).toHaveLength(1);
    await reopened.close();
  });

  it("treats blank optional PGlite configuration as unset", async () => {
    process.env.PGLITE_DIR = dir;
    const reopened = createDb({ pgliteDir: "" });
    expect(reopened.kind).toBe("pglite");
    expect(await reopened.db.select().from(health)).toHaveLength(1);
    await reopened.close();
  });
});
