import { requireInstanceIdentity } from "../config.ts";
import { createDb } from "./index.ts";
import { migrate } from "./migrate.ts";

// The same local env file Next.js reads; exported shell variables take precedence.
try { process.loadEnvFile(new URL("../../../../apps/events/.env.local", import.meta.url)); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

try { requireInstanceIdentity(); } catch (error) { console.error("[migrate]", error instanceof Error ? error.message : error); process.exit(1); }

const handle = createDb();
try {
  await migrate(handle);
  console.log(`[migrate] migrations applied (${handle.kind})`);
} catch (error) {
  console.error("[migrate] failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
