import { afterEach, expect, it, vi } from "vitest";
import { EventTeam } from "../access/team.ts";
import { bootstrapApiToken } from "../api-tokens.ts";
import { queryable } from "../db/tx.ts";
import { isStaffEmail, staffEmailSql } from "../staff-email.ts";
import { testDatabase } from "../testing/database.ts";
import { createIdentityServices } from "./index.ts";
import { requireStaffByToken } from "./tokens.ts";

afterEach(() => vi.unstubAllEnvs());

for (const kind of ["pglite", ...(process.env.TEST_DATABASE_URL ? ["postgres"] : [])] as const) {
  it(`enforces configured domains for sessions, invites, tokens and event teams (${kind})`, async () => {
    vi.stubEnv("STAFF_EMAIL_DOMAIN", "fork.test,second.test");
    vi.stubEnv("SEED_OWNER_EMAIL", "owner@fork.test");
    vi.stubEnv("DEV_AUTH", "1"); vi.stubEnv("APP_URL", "http://localhost:3000");
    const database = await testDatabase(kind as "pglite" | "postgres");
    try {
      const q = queryable(database.db);
      const identity = createIdentityServices({ db: database.db, secret: "fixture-secret-over-thirty-two-characters" });
      const { cookie } = await identity.devStaffLogin("OWNER@FORK.TEST");
      const actor = await identity.auth.requireStaff(cookie);
      expect(actor).toMatchObject({ email: "owner@fork.test", role: "owner" });
      await identity.auth.inviteStaff(actor, "teammate@second.test", "staff");
      await expect(identity.auth.inviteStaff(actor, "teammate@didit.me", "staff")).rejects.toMatchObject({ code: "InvalidStaff" });
      const invited = await identity.devStaffLogin("teammate@second.test");
      expect(await identity.auth.requireStaff(invited.cookie)).toMatchObject({ email: "teammate@second.test" });
      await q.query("insert into staff(email,role) values('outsider@didit.me','owner')");
      await expect(identity.devStaffLogin("outsider@didit.me")).rejects.toMatchObject({ code: "StaffForbidden" });
      await expect(identity.auth.inviteStaff(actor, actor.email, "admin")).rejects.toMatchObject({ code: "FinalOwner" });
      const { token } = await bootstrapApiToken("owner@fork.test", "fork-mcp", database.db);
      expect(await requireStaffByToken(token, undefined, database.db)).toMatchObject({ email: "owner@fork.test", role: "owner" });
      await expect(bootstrapApiToken("outsider@didit.me", "rejected", database.db)).rejects.toMatchObject({ code: "StaffForbidden" });
      const [event] = await q.query<{ id: string }>("insert into events(slug,name,starts_at,ends_at,capacity) values('fork','Fork event',clock_timestamp(),clock_timestamp()+interval '1 hour',10) returning id");
      const team = new EventTeam(database.db);
      await expect(team.add(actor, event!.id, "teammate@second.test", "host")).rejects.toMatchObject({ code: "AlreadyStaff" });
      await q.query("insert into event_members(event_id,email,role,invited_by) values($1,'teammate@second.test','host',$2),($1,'outsider@didit.me','host',$2)", [event!.id, actor.email]);
      const members = await team.list(actor, event!.id);
      expect(members.find(member => member.email === "teammate@second.test")?.isStaff).toBe(true);
      expect(members.find(member => member.email === "outsider@didit.me")?.isStaff).toBe(false);
      for (const email of ["owner@fork.test", " STAFF@SECOND.TEST ", "owner@didit.me", "owner@sub.fork.test", "owner@@fork.test", "@fork.test", "owner@fork.test.evil"]) {
        const [row] = await q.query<{ allowed: boolean }>(`select ${staffEmailSql("email")} as allowed from (select $1::text as email) candidate`, [email]);
        expect(row?.allowed, email).toBe(isStaffEmail(email));
      }
      // Staff keep their shorter idle deadline under a custom domain.
      await q.query("update sessions set last_seen_at=clock_timestamp()-interval '31 days' where id=$1", [actor.sessionId]);
      expect(await identity.sessions.resolve(cookie)).toBeNull();
      vi.stubEnv("STAFF_EMAIL_DOMAIN", "second.test");
      await expect(requireStaffByToken(token, undefined, database.db)).rejects.toMatchObject({ code: "StaffForbidden" });
    } finally { await database.close(); }
  });
}
