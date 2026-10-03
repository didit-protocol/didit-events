// v6 profile reminder (M-29): the job picks live, verified, incomplete accounts 48 h to 7 days after sign-up, once
// ever, never staff-only ones, at most a batch per run; the send re-reads the profile and the reminder preference.
import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
import type { Db } from "../db/index.ts";
import { queryable } from "../db/tx.ts";
import { dispatchJobs,JobRegistry } from "../jobs.ts";
import { dispatchOutbox,OutboxRegistry } from "../outbox.ts";
import { resetDatabase,testDatabase } from "../testing/database.ts";
import { skipPostgres } from "../testing/postgres.ts";
import { startFakeResend,type FakeResend } from "./fake-resend.ts";
import { registerNotifications,scheduleLifecycleJobs,type EmailConfig } from "./index.ts";
import { PROFILE_REMINDER_JOB,profileGaps,profileReminderKey,scheduleProfileReminders } from "./profile-reminder.ts";

const HOUR = 3600_000, DAY = 24 * HOUR, BASE = "https://events.example.test";
const LINKS = '[{"kind":"linkedin","label":"LinkedIn","href":"https://www.linkedin.com/in/ana"}]';
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

for (const kind of ["pglite", "postgres"] as const) {
  describe.skipIf(kind === "postgres" && skipPostgres)(`${kind} profile reminder M-29`, () => {
    let db: Db, close: () => Promise<void>, resend: FakeResend, registry: OutboxRegistry, config: EmailConfig;
    const now = new Date();
    const q = () => queryable(db);
    beforeAll(async () => { ({ db, close } = await testDatabase(kind)); resend = await startFakeResend(); }, 60_000);
    beforeEach(async () => {
      await resetDatabase(db); resend.reset();
      config = { now: () => now, baseUrl: BASE, resend: { apiKey: "re_test", apiUrl: resend.url }, db };
      registry = new OutboxRegistry();
      registerNotifications(config, { outbox: registry, jobs: new JobRegistry(), now: () => now });
    });
    afterAll(async () => { await resend?.close(); await close?.(); });

    /** A guest account created `ago` ms before now: verified, reminders on, profile empty unless `complete`. */
    async function account(ago: number, opts: { complete?: boolean; verified?: boolean; reminders?: boolean; deleting?: boolean; deleted?: boolean; email?: string; firstName?: string | null } = {}): Promise<string> {
      const id = randomUUID(), email = opts.email ?? `${id}@example.test`;
      await q().query("insert into accounts (id,email,first_name,email_reminders,created_at,deleting_at,deleted_at) values ($1,$2,$3,$4,$5,$6,$7)",
        [id, email, opts.firstName === undefined ? "Ana" : opts.firstName, opts.reminders ?? true, new Date(now.getTime() - ago), opts.deleting ? now : null, opts.deleted ? now : null]);
      if (opts.verified ?? true) await q().query("update accounts set email_verified_at=$2,email_proof_method='legacy_verified',email_proof_ref='fixture' where id=$1", [id, new Date(now.getTime() - ago)]);
      if (opts.complete) await complete(id);
      return id;
    }
    const complete = (id: string) => q().query(`update accounts set photo=$2,headline='Builder',company='Acme',job_role='Founder',profile_links=$3::jsonb where id=$1`, [id, PHOTO, LINKS]);
    const queued = async () => (await q().query<{ dedupe_key: string }>("select dedupe_key from outbox where kind='email:M-29' order by dedupe_key")).map(r => r.dedupe_key);
    const drain = async () => { while (await dispatchOutbox(db, registry)) { /* until idle */ } };
    const sent = () => resend.calls.map(c => c.body as { to: string[]; subject: string; html: string; text: string; tags: { value: string }[] });

    it("picks verified incomplete accounts between 48 h and 7 days old; skips complete, deleted, unverified, opted-out and staff (even staff who registered as guests)", async () => {
      const due = await account(48 * HOUR + 60_000), old = await account(7 * DAY - HOUR);
      await account(48 * HOUR - 60_000); // too new
      await account(7 * DAY + 60_000); // past the 7-day cap
      await account(3 * DAY, { complete: true });
      await account(3 * DAY, { deleting: true }); await account(3 * DAY, { deleted: true });
      await account(3 * DAY, { verified: false });
      await account(3 * DAY, { reminders: false });
      await q().query("insert into staff(email,role) values('ops@didit.me','staff'),('guest-staff@didit.me','staff')");
      await account(3 * DAY, { email: "ops@didit.me" }); // staff-only: never registered for an event
      const guestStaff = await account(3 * DAY, { email: "guest-staff@didit.me" });
      const [ev] = await q().query<{ id: string }>(`insert into events (slug,name,starts_at,ends_at,capacity,status) values ('ev','Ev',$1,$2,50,'published') returning id`, [new Date(now.getTime() + DAY), new Date(now.getTime() + DAY + HOUR)]);
      await q().query("insert into registrations(legacy_imported,policy_version,form_version,event_id,account_id,admission) values(true,1,1,$1,$2,'pending')", [ev!.id, guestStaff]);
      expect(await scheduleProfileReminders(now, db)).toBe(2);
      expect(await queued()).toEqual([due, old].map(profileReminderKey).sort());
    });

    it("enqueues once per account ever, even after the outbox payload is cleared or the profile is emptied again", async () => {
      const a = await account(3 * DAY);
      expect(await scheduleProfileReminders(now, db)).toBe(1);
      expect(await scheduleProfileReminders(now, db)).toBe(0);
      await q().query("update outbox set status='sent',payload=null");
      expect(await scheduleProfileReminders(new Date(now.getTime() + DAY), db)).toBe(0);
      expect(await queued()).toEqual([profileReminderKey(a)]);
    });

    it("each missing part on its own makes a profile incomplete", async () => {
      const ids = await Promise.all([0, 1, 2, 3, 4].map(() => account(3 * DAY, { complete: true })));
      await q().query("update accounts set photo=null where id=$1", [ids[0]]);
      await q().query("update accounts set job_role='  ' where id=$1", [ids[1]]);
      await q().query("update accounts set company=null where id=$1", [ids[2]]);
      await q().query("update accounts set headline='' where id=$1", [ids[3]]);
      await q().query("update accounts set profile_links='[]'::jsonb where id=$1", [ids[4]]);
      expect(await Promise.all(ids.map(id => profileGaps(q(), id)))).toEqual([["photo"], ["roleCompany"], ["roleCompany"], ["headline"], ["link"]]);
      expect(await scheduleProfileReminders(now, db)).toBe(5);
    });

    it("caps a run at the batch size, oldest first; the next run takes the rest", async () => {
      const ids = [];
      for (let i = 0; i < 5; i++) ids.push(await account(3 * DAY + i * HOUR));
      expect(await scheduleProfileReminders(now, db, 2)).toBe(2);
      expect(await queued()).toEqual([ids[4]!, ids[3]!].map(profileReminderKey).sort());
      expect(await scheduleProfileReminders(now, db, 2)).toBe(2);
      expect(await scheduleProfileReminders(now, db, 2)).toBe(1);
      expect(await scheduleProfileReminders(now, db, 2)).toBe(0);
    });

    it("sends with only the missing items; a profile completed before the send drops the email", async () => {
      const a = await account(3 * DAY, { complete: true }), b = await account(3 * DAY, { firstName: null });
      await q().query("update accounts set photo=null,headline=null where id=$1", [a]);
      expect(await scheduleProfileReminders(now, db)).toBe(2);
      await drain();
      const [mail] = sent();
      expect(resend.calls).toHaveLength(2);
      const forA = sent().find(m => m.to[0] === `${a}@example.test`)!, forB = sent().find(m => m.to[0] === `${b}@example.test`)!;
      expect(forA.subject).toBe("Finish your Didit Events profile");
      expect(forA.text).toContain("Hi Ana, your profile is almost there");
      expect(forA.text).toContain("[ ] Profile photo\n[ ] Headline");
      expect(forA.text).not.toMatch(/Role and company|A link/);
      expect(forA.html).toContain(`href="${BASE}/me/profile/edit"`);
      expect(forA.html).toMatch(/email-icons\/ticket\.png[^>]*>Complete my profile/);
      expect(forA.html).toContain(`href="${BASE}/me/settings"`);
      expect(forB.text).toContain("Your profile is almost there");
      expect(forB.text).toContain("[ ] Profile photo\n[ ] Role and company\n[ ] Headline\n[ ] A link (LinkedIn or website)");
      expect(mail!.tags).toEqual([{ name: "code", value: "M_29" }]);

      // Completed between enqueue and send: no email, the row fails permanently with a suppression reason.
      await resetDatabase(db); resend.reset();
      const c = await account(3 * DAY);
      expect(await scheduleProfileReminders(now, db)).toBe(1);
      await complete(c);
      await drain();
      expect(resend.calls).toHaveLength(0);
      expect(await q().query("select status,error from outbox where kind='email:M-29'")).toEqual([{ status: "failed", error: "suppressed_profile_complete" }]);
    });

    it("re-checks staff and the age window at send time", async () => {
      const a = await account(3 * DAY, { email: "later-staff@didit.me" });
      expect(await scheduleProfileReminders(now, db)).toBe(1);
      await q().query("insert into staff(email,role) values('later-staff@didit.me','staff')");
      await drain();
      expect(resend.calls).toHaveLength(0);
      expect(await q().query("select status,error from outbox where kind='email:M-29'")).toEqual([{ status: "failed", error: "suppressed_ineligible" }]);
      await resetDatabase(db); resend.reset();
      const b = await account(3 * DAY);
      expect(await scheduleProfileReminders(now, db)).toBe(1);
      await q().query("update accounts set created_at=clock_timestamp()-interval '9 days' where id=$1", [b]);
      await drain();
      expect(resend.calls).toHaveLength(0);
      expect(await q().query("select error from outbox where kind='email:M-29'")).toEqual([{ error: "suppressed_ineligible" }]);
      void a;
    });

    it("respects the reminder preference at send time", async () => {
      const a = await account(3 * DAY);
      expect(await scheduleProfileReminders(now, db)).toBe(1);
      await q().query("update accounts set email_reminders=false where id=$1", [a]);
      await drain();
      expect(resend.calls).toHaveLength(0);
      expect(await q().query("select status,error from outbox where kind='email:M-29'")).toEqual([{ status: "failed", error: "suppressed_preference" }]);
    });

    it("runs as a 15-minute job seeded with the lifecycle jobs", async () => {
      await account(3 * DAY);
      const jobs = new JobRegistry();
      registerNotifications(config, { outbox: new OutboxRegistry(), jobs, now: () => now });
      await scheduleLifecycleJobs(db);
      expect(await q().query("select interval_sec from jobs where name=$1", [PROFILE_REMINDER_JOB])).toEqual([{ interval_sec: 900 }]);
      await dispatchJobs(db, jobs);
      expect(await queued()).toHaveLength(1);
      expect(await q().query("select name from jobs where error is not null")).toEqual([]);
    });
  });
}
