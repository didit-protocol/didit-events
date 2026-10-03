import { sql } from "drizzle-orm";
import { getDb } from "@didit-events/core/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const { db } = getDb();
    await db.execute(sql`select 1`);
    return new Response("ok", { headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch (error) {
    console.error("[healthz] database check failed:", error instanceof Error ? error.message : error);
    return new Response("db unavailable", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
