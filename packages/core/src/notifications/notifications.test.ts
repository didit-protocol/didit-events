import { createHmac,randomUUID } from "node:crypto";
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import type { Db } from "../db/index.ts";
import { queryable,withTx } from "../db/tx.ts";
import { dispatchJobs,JobRegistry } from "../jobs.ts";
import { dispatchOutbox,enqueue,OUTBOX_MAX_ATTEMPTS,OutboxRegistry } from "../outbox.ts";
import { resetDatabase,testDatabase } from "../testing/database.ts";
import { skipPostgres } from "../testing/postgres.ts";
import { RESEND_DAILY_QUOTA,startFakeResend,type FakeResend } from "./fake-resend.ts";
import {
clearSentPayloads,createNotificationService,decodeData,encodeData,enqueueEmail,handleResendWebhook,LIFECYCLE_JOBS,notifyEventChanged,PROFILE_REMINDER_JOB,
notifyHostCancellation,registerNotifications,retryAfterSec,scheduleDoorsReminders,scheduleLifecycleJobs,scheduleThanks,
scheduleTomorrowReminders,scheduleVerificationNudges,splitAddress,verifyResendSignature,type EmailConfig,
} from "./index.ts";

const HOUR = 3600_000, DAY = 24 * HOUR;
/** Fake clock: every schedule takes `now`; rows are placed relative to it. */
const NOW = new Date("2027-03-01T10:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const BASE = "https://events.example.test";


describe("pure helpers", () => {
  it("round-trips dates through the payload encoding and splits addresses", () => {
    const data = { deadline: new Date("2027-01-01T00:00:00Z"), change: { kind: "time", before: new Date("2027-01-02T00:00:00Z") }, n: 1 };
    expect(decodeData(JSON.parse(JSON.stringify(encodeData(data))))).toEqual(data);
    expect(splitAddress("Carrer de Pallars 99, 08018, Barcelona")).toEqual({ street: "Carrer de Pallars 99, 08018", city: "Barcelona" });
    expect(splitAddress(null)).toEqual({ street: "", city: "" });
  });
  it("parses Retry-After seconds and HTTP dates", () => {
    expect(retryAfterSec("120")).toBe(120);
    expect(retryAfterSec(new Date(Date.now() + 30_000).toUTCString())).toBeGreaterThanOrEqual(29);
    expect(retryAfterSec(null)).toBeUndefined();
  });
});

for (const kind of ["pglite", "postgres"] as const) {
  describe.skipIf(kind === "postgres" && skipPostgres)(`${kind} notifications`, () => {
    let db: Db, close: () => Promise<void>, resend: FakeResend, config: EmailConfig, registry: OutboxRegistry;
    beforeAll(async () => {
      ({ db, close } = await testDatabase(kind));
      resend = await startFakeResend();
    }, 60_000);
    beforeEach(async () => {
      await resetDatabase(db);
      resend.reset();
      config = { now:()=>NOW,baseUrl: BASE, resend: { apiKey: "re_test", apiUrl: resend.url }, db };
      registry = new OutboxRegistry();
      registerNotifications(config, { outbox: registry, jobs: new JobRegistry() });
    });
    afterAll(async () => { await resend?.close(); await close?.(); });

    const q = () => queryable(db);
    async function account(opts: { verified?: boolean; reminders?: boolean; deleting?: boolean; firstName?: string } = {}): Promise<string> {
      const id = randomUUID();
      await q().query("insert into accounts (id,email,first_name,email_reminders,deleting_at) values ($1,$2,$3,$4,$5)",
        [id, `${id}@example.test`, opts.firstName ?? "Ana", opts.reminders ?? true, opts.deleting ? NOW : null]);
      if (opts.verified) {
        await q().query("update accounts set email_verified_at=$2,email_proof_method='legacy_verified',email_proof_ref='fixture' where id=$1",[id,at(-DAY)]);
        const [v] = await q().query<{ id: string }>("insert into verifications (account_id,didit_session_id,workflow_id,vendor_data,status) values ($1,$2,$3,'fixture','approved') returning id", [id, randomUUID(), randomUUID()]);
        for (const proof of ["face", "identity"]) {
          await q().query(`insert into evidence (account_id,verification_id,kind,value,established_at,valid_until,provider_status,activation)
            values ($1,$2,$3,case when $3::text='identity' then '{}'::jsonb else null end,$4,$5,'approved','active')`, [id, v!.id, proof, at(-DAY), at(100 * DAY)]);
        }
      }
      return id;
    }
    async function event(opts: { startsIn: number; hours?: number; status?: string; slug?: string }): Promise<string> {
      const id = randomUUID();
      await q().query(`insert into events (id,slug,name,starts_at,ends_at,capacity,status,venue,address,agenda,email_content)
        values ($1,$2,'AI Era',$3,$4,50,$5,'Didit HQ','Carrer de Pallars 99, Barcelona',$6::jsonb,$7::jsonb)`,
      [id, opts.slug ?? `ev-${id.slice(0, 8)}`, at(opts.startsIn), at(opts.startsIn + (opts.hours ?? 3) * HOUR), opts.status ?? "published",
        JSON.stringify([{ time: "18:30", title: "Doors" }, { bogus: true }]), JSON.stringify({ teaser: "" })]);
      return id;
    }
    async function registration(eventId: string, accountId: string, admission = "approved", approvedAgo?: number): Promise<string> {
      const [r] = await q().query<{ id: string }>("insert into registrations(legacy_imported,policy_version,form_version,event_id,account_id,admission) values(true,1,1,$1,$2,$3) returning id", [eventId, accountId, admission]);
      if (approvedAgo !== undefined) await q().query("insert into admission_history (registration_id,\"from\",\"to\",actor,created_at) values ($1,'pending','approved','staff',$2)", [r!.id, at(-approvedAgo)]);
      return r!.id;
    }
    const outbox = () => q().query<{ kind: string; dedupe_key: string; status: string; attempts: number; error: string | null; provider_id: string | null; payload: Record<string, unknown> | null; next_attempt_at: Date; delivery_status: string | null }>(
      "select kind,dedupe_key,status,attempts,error,provider_id,payload,next_attempt_at,delivery_status from outbox order by dedupe_key");
    const drain = async () => { while (await dispatchOutbox(db, registry)) { /* until idle */ } };

    it("dispatches each dedupe key exactly once under concurrent workers, with Idempotency-Key = dedupe key", async () => {
      const ids = await Promise.all(Array.from({ length: 6 }, () => account()));
      const ev = await event({ startsIn: 5 * DAY });
      await withTx(async tx => {
        for (const id of ids) await enqueueEmail(tx, { code: "M-21", dedupeKey: `email:M-21:${id}:test`, accountId: id, eventId: ev, data: { otherEventsUrl: "/events" } });
        // A duplicate enqueue is a no-op.
        expect(await enqueueEmail(tx, { code: "M-21", dedupeKey: `email:M-21:${ids[0]}:test`, accountId: ids[0], eventId: ev })).toBeNull();
      }, db);
      resend.setDelay(20);
      await Promise.all(Array.from({ length: 24 }, () => dispatchOutbox(db, registry)));
      await drain();
      expect(resend.calls).toHaveLength(6);
      expect(new Set(resend.calls.map(c => c.headers["idempotency-key"]))).toEqual(new Set(ids.map(id => `email:M-21:${id}:test`)));
      const rows = await outbox();
      expect(rows.every(r => r.status === "sent" && r.attempts === 1 && r.provider_id?.startsWith("re_"))).toBe(true);
      const call = resend.calls[0]!.body as { from: string; to: string[]; reply_to?: string; html: string; text: string; subject: string };
      expect(call.from).toBe("Didit Events <events@updates.didit.me>");
      expect(call.reply_to).toBe("events@example.com");
      expect(call.to[0]).toMatch(/@example\.test$/);
      expect(call.subject).toBe("Update on your place for AI Era");
      expect(call.html).toContain(`${BASE}/events`);
      expect(call.html).not.toMatch(/href="\//);
      expect(call.text).toContain("Ana");
    });

    it("a lease recovery re-sends with the same Idempotency-Key, so the provider deduplicates", async () => {
      const id = await account(), ev = await event({ startsIn: 5 * DAY });
      await withTx(tx => enqueueEmail(tx, { code: "M-21", dedupeKey: `email:M-21:${id}:lease`, accountId: id, eventId: ev, data: { otherEventsUrl: "/events" } }), db);
      await dispatchOutbox(db, registry);
      // Simulate a crash after the provider call but before the checkpoint.
      await q().query("update outbox set status='pending',provider_id=null,sent_at=null,next_attempt_at=clock_timestamp()");
      await dispatchOutbox(db, registry);
      expect(resend.calls.map(c => c.headers["idempotency-key"])).toEqual([`email:M-21:${id}:lease`, `email:M-21:${id}:lease`]);
      const [row] = await outbox();
      expect(row!.provider_id).toBe("re_1");
    });

    it("retries 5xx and 429 with backoff (honouring Retry-After), then sends; never stores provider bodies", async () => {
      const id = await account(), ev = await event({ startsIn: 5 * DAY });
      await withTx(tx => enqueueEmail(tx, { code: "M-21", dedupeKey: `email:M-21:${id}:retry`, accountId: id, eventId: ev, data: { otherEventsUrl: "/events" } }), db);
      resend.respond({ status: 503 }, { status: 429, headers: { "retry-after": "120" } });
      const t0 = Date.now();
      await dispatchOutbox(db, registry);
      let [row] = await outbox();
      expect(row).toMatchObject({ status: "pending", attempts: 1, error: "resend_503" });
      expect(row!.next_attempt_at.getTime() - t0).toBeGreaterThan(1000);
      expect(await dispatchOutbox(db, registry)).toBe(false); // backoff holds the row
      await q().query("update outbox set next_attempt_at=clock_timestamp()");
      await dispatchOutbox(db, registry);
      [row] = await outbox();
      expect(row).toMatchObject({ status: "pending", attempts: 2, error: "resend_429" });
      expect(row!.next_attempt_at.getTime() - Date.now()).toBeGreaterThan(110_000);
      await q().query("update outbox set next_attempt_at=clock_timestamp()");
      await dispatchOutbox(db, registry);
      [row] = await outbox();
      expect(row).toMatchObject({ status: "sent", attempts: 3, error: null });
      expect(resend.calls).toHaveLength(3);
      expect(JSON.stringify(await q().query("select * from outbox"))).not.toContain("SECRET_PROVIDER_BODY");
    });

    it("a spent provider quota defers the email for an hour without using an attempt, and other messages still flow", async () => {
      const [first, second] = [await account(), await account()], ev = await event({ startsIn: 5 * DAY });
      await withTx(tx => enqueueEmail(tx, { code: "M-21", dedupeKey: "email:M-21:a-quota", accountId: first, eventId: ev, data: { otherEventsUrl: "/events" } }), db);
      await withTx(tx => enqueueEmail(tx, { code: "M-21", dedupeKey: "email:M-21:b-next", accountId: second, eventId: ev, data: { otherEventsUrl: "/events" } }), db);
      await q().query("update outbox set next_attempt_at=clock_timestamp()-interval '1 minute' where dedupe_key='email:M-21:a-quota'"); // claimed first
      const lines: string[] = [], info = vi.spyOn(console, "info").mockImplementation(line => { lines.push(String(line)); });
      try {
        resend.respond(RESEND_DAILY_QUOTA);
        expect(await dispatchOutbox(db, registry)).toBe(true);
        let [quota, next] = await outbox();
        expect(quota).toMatchObject({ status: "pending", attempts: 0, error: "provider_quota" });
        expect(Math.round((quota!.next_attempt_at.getTime() - Date.now()) / 60_000)).toBe(60);
        expect(next).toMatchObject({ status: "pending", attempts: 0, error: null });
        // No head-of-line blocking: the deferred row is out of the way and the next message goes out.
        expect(await dispatchOutbox(db, registry)).toBe(true);
        expect(await dispatchOutbox(db, registry)).toBe(false);
        [quota, next] = await outbox();
        expect(next).toMatchObject({ status: "sent", attempts: 1 });
        // Many refusals never reach OUTBOX_MAX_ATTEMPTS; a larger Retry-After is honoured up to 6 hours; a quota named only in the message counts.
        for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 2; i++) {
          resend.respond(i % 2 ? { status: 429, body: { name: "rate_limit_exceeded", message: "You have reached your monthly email quota." } } : { ...RESEND_DAILY_QUOTA, headers: { "retry-after": String(i ? 7200 : 86_400) } });
          await q().query("update outbox set next_attempt_at=clock_timestamp() where status='pending'");
          await dispatchOutbox(db, registry);
          [quota] = await outbox();
          expect(quota).toMatchObject({ status: "pending", attempts: 0, error: "provider_quota" });
          expect(Math.round((quota!.next_attempt_at.getTime() - Date.now()) / 60_000)).toBe(i % 2 ? 60 : i ? 120 : 360);
        }
        // The quota is back: the email goes out, on its first counted attempt.
        await q().query("update outbox set next_attempt_at=clock_timestamp() where status='pending'");
        await dispatchOutbox(db, registry);
        expect((await outbox())[0]).toMatchObject({ status: "sent", attempts: 1, error: null });
        const logged = lines.filter(line => line.includes("email.quota_deferred"));
        expect(logged).toHaveLength(OUTBOX_MAX_ATTEMPTS + 3);
        expect(JSON.parse(logged[0]!)).toEqual({ event: "email.quota_deferred", fields: { code: "provider_quota", kind: "email:M-21", retryInSec: 3600 } });
        expect(lines.join("\n")).not.toMatch(/@example\.test|quota\./);
      } finally { info.mockRestore(); }
    });

    it("a quota refusal gives up 48 hours after the row was created (provider_quota); a plain 429 keeps the normal backoff", async () => {
      const id = await account(), ev = await event({ startsIn: 5 * DAY });
      await withTx(tx => enqueueEmail(tx, { code: "M-21", dedupeKey: `email:M-21:${id}:quota`, accountId: id, eventId: ev, data: { otherEventsUrl: "/events" } }), db);
      await q().query("update outbox set created_at=clock_timestamp()-interval '47 hours 59 minutes'");
      resend.respond(RESEND_DAILY_QUOTA);
      await dispatchOutbox(db, registry);
      expect((await outbox())[0]).toMatchObject({ status: "pending", attempts: 0, error: "provider_quota" });
      // Resend's rate limit (2 requests/second) is a 429 too: it counts as an attempt and backs off in seconds.
      await q().query("update outbox set next_attempt_at=clock_timestamp()");
      resend.respond({ status: 429, body: { statusCode: 429, name: "rate_limit_exceeded", message: "Too many requests. You can only make 2 requests per second." } });
      await dispatchOutbox(db, registry);
      let [row] = await outbox();
      expect(row).toMatchObject({ status: "pending", attempts: 1, error: "resend_429" });
      expect(row!.next_attempt_at.getTime() - Date.now()).toBeLessThan(10_000);
      await q().query("update outbox set created_at=clock_timestamp()-interval '48 hours 1 minute',next_attempt_at=clock_timestamp()");
      resend.respond(RESEND_DAILY_QUOTA);
      await dispatchOutbox(db, registry);
      [row] = await outbox();
      expect(row).toMatchObject({ status: "failed", attempts: 2, error: "provider_quota" });
      expect((await q().query<{ failed: boolean }>("select failed_at is not null failed from outbox"))[0]).toEqual({ failed: true });
      await q().query("update outbox set next_attempt_at=clock_timestamp()");
      expect(await dispatchOutbox(db, registry)).toBe(false);
      expect(JSON.stringify(await q().query("select * from outbox"))).not.toContain("quota.");
    });

    it("fails permanently on 4xx with the status stored and never retries", async () => {
      const id = await account(), ev = await event({ startsIn: 5 * DAY });
      await withTx(tx => enqueueEmail(tx, { code: "M-21", dedupeKey: `email:M-21:${id}:bad`, accountId: id, eventId: ev, data: { otherEventsUrl: "/events" } }), db);
      resend.respond({ status: 422 });
      await dispatchOutbox(db, registry);
      await q().query("update outbox set next_attempt_at=clock_timestamp()");
      expect(await dispatchOutbox(db, registry)).toBe(false);
      expect(resend.calls).toHaveLength(1);
      expect((await outbox())[0]).toMatchObject({ status: "failed", attempts: 1, error: "resend_422" });
    });

    it("never dispatches Didit-sent codes (M-01, M-04, M-17)", async () => {
      const id = await account();
      for (const code of ["M-01", "M-04", "M-17"] as const) {
        await expect(withTx(tx => enqueueEmail(tx, { code, dedupeKey: `email:${code}:${id}`, accountId: id }), db)).rejects.toThrow("DiditSentEmailCode");
        // Even a raw row enqueued past the guard fails permanently without a provider call.
        await withTx(tx => enqueue(tx, { kind: `email:${code}`, dedupeKey: `email:${code}:${id}`, payload: { code, accountId: id } }), db);
      }
      await drain();
      expect(resend.calls).toHaveLength(0);
      expect((await outbox()).map(r => [r.status, r.error])).toEqual([["failed", "didit_sent_code"], ["failed", "didit_sent_code"], ["failed", "didit_sent_code"]]);
    });

    it("suppresses deleted accounts and opted-out reminders at send time", async () => {
      const gone = await account({ deleting: true }), optedOut = await account({ reminders: false }), ev = await event({ startsIn: 20 * HOUR });
      await withTx(async tx => {
        await enqueueEmail(tx, { code: "M-21", dedupeKey: `email:M-21:${gone}:x`, accountId: gone, eventId: ev, data: { otherEventsUrl: "/events" } });
        await enqueueEmail(tx, { code: "M-12", dedupeKey: `email:M-12:${optedOut}`, accountId: optedOut, eventId: ev, data: { directions: "", mapsUrl: "https://maps.example" } });
        // Opt-out does not gate a service notice.
        await enqueueEmail(tx, { code: "M-21", dedupeKey: `email:M-21:${optedOut}:x`, accountId: optedOut, eventId: ev, data: { otherEventsUrl: "/events" } });
      }, db);
      await drain();
      expect(resend.calls).toHaveLength(1);
      expect((await outbox()).map(r => [r.dedupe_key.split(":").slice(0, 2).join(":"), r.status, r.error]).sort()).toEqual([
        ["email:M-12", "failed", "suppressed_preference"], ["email:M-21", "failed", "suppressed_account"], ["email:M-21", "sent", null],
      ].sort());
    });

    it("M-11 goes to eligible approved guests of events starting in (1 h, 24 h], once", async () => {
      const tomorrow = await event({ startsIn: 20 * HOUR }), soon = await event({ startsIn: 30 * 60_000 }), later = await event({ startsIn: 30 * HOUR });
      const draft = await event({ startsIn: 20 * HOUR, status: "draft" }), cancelled = await event({ startsIn: 20 * HOUR, status: "cancelled" });
      const yes = await account({ verified: true }), unverified = await account(), optedOut = await account({ verified: true, reminders: false });
      const pending = await account({ verified: true }), deleting = await account({ verified: true, deleting: true });
      const rYes = await registration(tomorrow, yes);
      await registration(tomorrow, unverified); await registration(tomorrow, optedOut); await registration(tomorrow, pending, "pending"); await registration(tomorrow, deleting);
      for (const other of [soon, later, draft, cancelled]) await registration(other, yes);
      expect(await scheduleTomorrowReminders(NOW, db)).toBe(1);
      expect(await scheduleTomorrowReminders(NOW, db)).toBe(0);
      const rows = await outbox();
      expect(rows.map(r => r.dedupe_key)).toEqual([`email:M-11:${rYes}`]);
      expect(decodeData(rows[0]!.payload)).toMatchObject({ code: "M-11", accountId: yes, eventId: tomorrow, data: { teaser: "", agenda: [{ t: "18:30", l: "Doors" }] } });
      await drain();
      expect(resend.calls).toHaveLength(1);
      expect((resend.calls[0]!.body as { subject: string }).subject).toBe("Tomorrow: AI Era");
    });

    it("M-12 goes to eligible approved guests not yet checked in, for events starting within the hour", async () => {
      const ev = await event({ startsIn: 40 * 60_000 }), tomorrow = await event({ startsIn: 20 * HOUR });
      const a = await account({ verified: true }), b = await account({ verified: true }), c = await account();
      const ra = await registration(ev, a), rb = await registration(ev, b); await registration(ev, c); await registration(tomorrow, a);
      await q().query("insert into checkins (event_id,registration_id,method) values ($1,$2,'manual')", [ev, rb]);
      expect(await scheduleDoorsReminders(NOW, db)).toBe(1);
      expect(await scheduleDoorsReminders(at(10 * 60_000), db)).toBe(0);
      expect((await outbox()).map(r => r.dedupe_key)).toEqual([`email:M-12:${ra}`]);
      expect(await scheduleDoorsReminders(at(41 * 60_000), db)).toBe(0); // event started
    });

    it("M-05 nudges approved guests still unverified 24 h after approval, before the event", async () => {
      const ev = await event({ startsIn: 3 * DAY }), past = await event({ startsIn: -HOUR });
      const due = await account(), recent = await account(), verified = await account({ verified: true }), optedOut = await account({ reminders: false });
      const rDue = await registration(ev, due, "approved", 25 * HOUR);
      await registration(ev, recent, "approved", 2 * HOUR); await registration(ev, verified, "approved", 25 * HOUR);
      await registration(ev, optedOut, "approved", 25 * HOUR); await registration(past, due, "approved", 25 * HOUR);
      expect(await scheduleVerificationNudges(NOW, db)).toBe(1);
      expect(await scheduleVerificationNudges(at(HOUR), db)).toBe(0);
      expect((await outbox()).map(r => r.dedupe_key)).toEqual([expect.stringMatching(new RegExp(`^email:M-05:${rDue}:[a-f0-9]{64}$`))]);
      await drain();
      const body = resend.calls[0]!.body as { html: string };
      expect(body.html).toContain(`${BASE}/me/events/`);
    });

    it("M-14 thanks attendees one day after the end, within a seven-day window", async () => {
      const ended = await event({ startsIn: -28 * HOUR, hours: 3 }), fresh = await event({ startsIn: -5 * HOUR, hours: 3 }), stale = await event({ startsIn: -9 * DAY });
      const a = await account(), b = await account(), c = await account(), d = await account({ reminders: false });
      const ra = await registration(ended, a), rb = await registration(ended, b); await registration(ended, c); const rd = await registration(ended, d);
      await q().query("insert into checkins (event_id,registration_id,method) values ($1,$2,'manual'),($1,$3,'manual')", [ended, ra, rd]);
      await q().query("insert into checkins (event_id,registration_id,method,undone_at) values ($1,$2,'manual',clock_timestamp())", [ended, rb]);
      for (const other of [fresh, stale]) { const r = await registration(other, a); await q().query("insert into checkins (event_id,registration_id,method) values ($1,$2,'manual')", [other, r]); }
      expect(await scheduleThanks(NOW, db)).toBe(1);
      expect(await scheduleThanks(NOW, db)).toBe(0);
      const rows = await outbox();
      expect(rows.map(r => r.dedupe_key)).toEqual([`email:M-14:${ra}`]);
      expect(decodeData(rows[0]!.payload)).toMatchObject({ data: { attendeeCount: 2 } });
      await drain();
      expect((resend.calls[0]!.body as { html: string }).html).toContain(`${BASE}/e/`);
    });

    it("M-16 (B4 hook) notifies approved guests once per distinct time/venue change", async () => {
      const ev = await event({ startsIn: 5 * DAY }), draft = await event({ startsIn: 5 * DAY, status: "draft" });
      const a = await account(), b = await account(), opted = await account({ reminders: false });
      const ra = await registration(ev, a), rOpt = await registration(ev, opted); await registration(ev, b, "waitlisted"); await registration(draft, a);
      const before = { name: "Event", startsAt: at(5 * DAY), endsAt: at(5 * DAY + 4 * HOUR), venue: "Didit HQ", address: "Carrer de Pallars 99, Barcelona" };
      const moved = { ...before, startsAt: at(5 * DAY + 30 * 60_000) };
      expect(await withTx(tx => notifyEventChanged(tx, { eventId: ev, before, after: moved }), db)).toBe(2);
      expect(await withTx(tx => notifyEventChanged(tx, { eventId: ev, before, after: moved }), db)).toBe(0);
      expect(await withTx(tx => notifyEventChanged(tx, { eventId: ev, before, after: before }), db)).toBe(0);
      expect(await withTx(tx => notifyEventChanged(tx, { eventId: ev, before: moved, after: { ...moved, venue: "Cafe" } }), db)).toBe(2);
      expect(await withTx(tx => notifyEventChanged(tx, { eventId: draft, before, after: moved }), db)).toBe(0);
      const keys = (await outbox()).map(r => r.dedupe_key);
      expect(keys.filter(k => k.startsWith(`email:M-16:${ra}:`))).toHaveLength(2);
      expect(keys.filter(k => k.startsWith(`email:M-16:${rOpt}:`))).toHaveLength(2);
      await q().query("update events set starts_at=$2,ends_at=$3 where id=$1", [ev, moved.startsAt, at(5 * DAY + 4 * HOUR)]);
      await drain();
      expect(resend.calls).toHaveLength(4);
      expect(resend.calls.map(c => (c.body as { subject: string }).subject)).toContain("Update: doors now open at 11:30");
    });

    it("M-21 (B4 hook) goes to the cancelled registrations, once per occasion, skipping deleting accounts", async () => {
      const ev = await event({ startsIn: 5 * DAY }), other = await event({ startsIn: 5 * DAY });
      const a = await account(), b = await account({ deleting: true }), c = await account();
      const ra = await registration(ev, a, "cancelled_by_host"), rb = await registration(ev, b, "cancelled_by_host"), rc = await registration(other, c, "cancelled_by_host");
      expect(await withTx(tx => notifyHostCancellation(tx, { eventId: ev, registrationIds: [ra, rb, rc], occasion: "event-cancelled" }), db)).toBe(1);
      expect(await withTx(tx => notifyHostCancellation(tx, { eventId: ev, registrationIds: [ra], occasion: "event-cancelled" }), db)).toBe(0);
      await expect(withTx(tx => notifyHostCancellation(tx, { eventId: ev, registrationIds: [ra], occasion: "bad key!" }), db)).rejects.toThrow();
      expect((await outbox()).map(r => r.dedupe_key)).toEqual([`email:M-21:${ra}:event-cancelled`]);
    });

    it("lifecycle jobs run under the advisory job lock and stay idempotent across concurrent schedulers", async () => {
      const ev = await event({ startsIn: 20 * HOUR });
      for (let i = 0; i < 5; i++) await registration(ev, await account({ verified: true }));
      const jobs = new JobRegistry();
      registerNotifications(config, { outbox: new OutboxRegistry(), jobs, now: () => NOW });
      await scheduleLifecycleJobs(db);
      expect((await q().query("select name from jobs order by name")).map(r => r.name)).toEqual([...Object.values(LIFECYCLE_JOBS), "outbox:retention", PROFILE_REMINDER_JOB].sort());
      const ran = await Promise.all([dispatchJobs(db, jobs), dispatchJobs(db, jobs), dispatchJobs(db, jobs)]);
      expect(ran.reduce((a, b) => a + b, 0)).toBe(6); // each job ran exactly once
      expect((await outbox()).filter(r => r.kind === "email:M-11")).toHaveLength(5);
      expect(await q().query("select name from jobs where error is not null")).toEqual([]);
      await q().query("update jobs set next_run_at=clock_timestamp()");
      await dispatchJobs(db, jobs);
      expect(await outbox()).toHaveLength(5);
    });

    it("NotificationService.scheduleReminders + deliver use the same binding and dedupe", async () => {
      const ev = await event({ startsIn: 20 * HOUR });
      const a = await account({ verified: true }); await registration(ev, a);
      const service = createNotificationService(config);
      expect(await service.scheduleReminders(NOW)).toBe(1);
      const [row] = await outbox();
      expect(await service.deliver({ kind: row!.kind, dedupeKey: row!.dedupe_key, payload: row!.payload! })).toEqual({ providerId: "re_1" });
      expect(resend.calls[0]!.headers["idempotency-key"]).toBe(row!.dedupe_key);
    });

    it("clears sent payloads after seven days but keeps the dedupe record", async () => {
      const a = await account(), ev = await event({ startsIn: 5 * DAY });
      await withTx(tx => enqueueEmail(tx, { code: "M-21", dedupeKey: `email:M-21:${a}:old`, accountId: a, eventId: ev, data: { otherEventsUrl: "/events" } }), db);
      await withTx(tx => enqueueEmail(tx, { code: "M-21", dedupeKey: `email:M-21:${a}:new`, accountId: a, eventId: ev, data: { otherEventsUrl: "/events" } }), db);
      await drain();
      await q().query("update outbox set sent_at=$1 where dedupe_key like '%:old'", [at(-8 * DAY)]);
      await q().query("update outbox set sent_at=$1 where dedupe_key like '%:new'", [at(-6 * DAY)]);
      expect(await clearSentPayloads(NOW, db)).toBe(1);
      const rows = await outbox();
      expect(rows.map(r => [r.dedupe_key.split(":").at(-1), r.payload === null])).toEqual([["new", false], ["old", true]]);
      expect(await withTx(tx => enqueueEmail(tx, { code: "M-21", dedupeKey: `email:M-21:${a}:old`, accountId: a, eventId: ev }), db)).toBeNull();
    });

    it("Resend webhook verifies the Svix signature and records receipts without moving backwards", async () => {
      const a = await account(), ev = await event({ startsIn: 5 * DAY });
      await withTx(tx => enqueueEmail(tx, { code: "M-21", dedupeKey: `email:M-21:${a}:hook`, accountId: a, eventId: ev, data: { otherEventsUrl: "/events" } }), db);
      await drain();
      const secret = `whsec_${Buffer.from("resend-test-secret").toString("base64")}`, now = new Date();
      const signed = (type: string, sig?: string) => {
        const raw = JSON.stringify({ type, created_at: now.toISOString(), data: { email_id: "re_1" } }), id = `msg_${randomUUID()}`, ts = String(Math.floor(now.getTime() / 1000));
        const v1 = createHmac("sha256", Buffer.from("resend-test-secret")).update(`${id}.${ts}.${raw}`).digest("base64");
        return new Request("https://events.example.test/api/webhooks/resend", { method: "POST", body: raw, headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": ts, "svix-signature": sig ?? `v1,${v1}` } });
      };
      await expect(handleResendWebhook(signed("email.delivered", "v1,AAAA"), secret, { db, now })).rejects.toMatchObject({ status: 401 });
      expect((await outbox())[0]!.delivery_status).toBeNull();
      expect(await handleResendWebhook(signed("email.bounced"), secret, { db, now })).toEqual({ recorded: true });
      expect(await handleResendWebhook(signed("email.delivered"), secret, { db, now })).toEqual({ recorded: false });
      expect((await outbox())[0]!.delivery_status).toBe("bounced");
      const stale = signed("email.delivered");
      expect(verifyResendSignature("{}", stale.headers, secret, new Date(now.getTime() + 301_000))).toBe(false);
      const withCookie = signed("email.delivered"); withCookie.headers.set("cookie", "a=b");
      await expect(handleResendWebhook(withCookie, secret, { db, now })).rejects.toMatchObject({ status: 401 });
    });
  });
}
