import { pathToFileURL } from "node:url";
import { requireInstanceIdentity, seedOwnerEmail } from "../../../packages/core/src/config.ts";
import { createDb,type Db } from "../../../packages/core/src/db/index.ts";
import { migrate } from "../../../packages/core/src/db/migrate.ts";
import { advisoryKey,withTx } from "../../../packages/core/src/db/tx.ts";
import { AI_ERA,AI_ERA_HOSTS } from "../src/public/fixtures.ts";

/** No guest/account seeds in any environment. Existing operator edits remain intact. */
export async function seedEvents(db: Db, env = process.env, now = new Date()) {
  if (env.NODE_ENV === "production" && env.SEED_ALLOW !== "1") throw new Error("Production seed requires SEED_ALLOW=1");
  const owner = seedOwnerEmail(env);
  const tomorrow = new Date(now.getTime() + 86400_000);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(tomorrow);
  const offset = new Intl.DateTimeFormat("en", { timeZone: "Europe/Madrid", timeZoneName: "longOffset" }).formatToParts(new Date(`${date}T12:00:00Z`)).find(p => p.type === "timeZoneName")!.value.replace("GMT", "");
  const starts = new Date(`${date}T18:30:00${offset}`), ends = new Date(`${date}T21:30:00${offset}`);
  const real = AI_ERA;
  return withTx(async tx => {
    if (tx.kind === "postgres") await tx.query("select pg_advisory_xact_lock($1::bigint)", [advisoryKey("job", "i1:seed")]);
    if (env.SEED_OWNER_EMAIL !== undefined) {
      await tx.query("insert into staff(email,role) values ($1,'owner') on conflict(email) do nothing", [owner]);
    } else {
      await tx.query("insert into staff(email,role) values ('events.owner@didit.me','owner'),('events.team@didit.me','admin') on conflict(email) do nothing");
    }
    const rows = [];
    for (const event of [
      { slug: real.slug, name: `${real.title} ${real.accent}`, starts: new Date(real.startsAt), ends: new Date(real.endsAt), capacity: 120,
        description: real.summary, closes: new Date(real.registrationClosesAt!), agenda: real.agenda, speakers: AI_ERA_HOSTS,
        cover: { kind: "theme", theme: real.cover.theme } },
      { slug: "e2e-test-event", name: "E2E Test Event", starts, ends, capacity: 10, description: "Local end-to-end test event.", closes: starts, agenda: [], speakers: [], cover: { kind: "theme", theme: "sky" } },
    ]) {
      const result = await tx.query<{ slug: string }>(`insert into events
        (slug,name,starts_at,ends_at,timezone,venue,address,capacity,status,form,door,description,description_md,agenda,speakers,cover)
        values ($1,$2,$3,$4,'Europe/Madrid',$5,$6,$7,'published',$8::jsonb,'{"kiosk":true,"mode":"supervised","match_threshold":80}'::jsonb,$9,$9,$10::jsonb,$11::jsonb,$12::jsonb)
        on conflict(slug) do nothing returning slug`, [event.slug,event.name,event.starts,event.ends,real.venue.name,real.venue.address,event.capacity,JSON.stringify({version:1,mode:"request",closes_at:event.closes.toISOString(),waitlist:true,fields:{phone_number:"off"},questions:[],consent_text:null}),event.description,JSON.stringify(event.agenda),JSON.stringify(event.speakers),JSON.stringify(event.cover)]);
      rows.push(...result);
    }
    return rows;
  }, db);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW !== "1") throw new Error("Production seed requires SEED_ALLOW=1");
  // Node's loader is used rather than Next internals, keeping the CLI dependency-free.
  try { process.loadEnvFile(new URL("../.env.local", import.meta.url)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW !== "1") throw new Error("Production seed requires SEED_ALLOW=1");
  try { requireInstanceIdentity(); } catch (error) { console.error("[seed]", error instanceof Error ? error.message : error); process.exit(1); }
  const db = createDb();
  try { await migrate(db); const rows = await seedEvents(db); console.log(`[seed] ${rows.length} events created; staff and events ready`); }
  finally { await db.close(); }
}
