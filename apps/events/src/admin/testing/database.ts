import type { Db } from "@didit-events/core/db";
import { queryable } from "@didit-events/core/db/tx";
import { seed, testDatabase } from "@didit-events/core/testing/database";

/** Real event metadata for fixture-backed UI suites; the shared event module is never mocked. */
export async function adminTestDatabase(slugs: string[], kind: "pglite" | "postgres" = "pglite") {
  const { db, close } = await testDatabase(kind);
  const globalDb = globalThis as typeof globalThis & { __diditEventsDb?: Db };
  const previous = globalDb.__diditEventsDb;
  globalDb.__diditEventsDb = db;
  const ids = new Map<string, string>();
  for (const slug of slugs) {
    const { eventId } = await seed(db);
    await queryable(db).query("update events set slug=$2, name=$2, timezone='Europe/Madrid' where id=$1", [eventId, slug]);
    ids.set(slug, eventId);
  }
  return { db, ids, close: async () => { globalDb.__diditEventsDb = previous; await close(); } };
}
