// v6 profile reminder (M-29): two days after sign-up, an account whose profile still misses a photo, role and
// company, headline or link gets one email asking to finish it. Once per account ever (dedupe key), at most
// PROFILE_REMINDER_BATCH per run, never for staff-only accounts; the send re-reads the profile and drops the email
// when nothing is missing any more.
import { getDb,type Db } from "../db/index.ts";
import { queryable,withTx,type Queryable } from "../db/tx.ts";
import { PROFILE_GAPS,type ProfileGap } from "../email/index.ts";
import { scheduleJob,type JobRegistry } from "../jobs.ts";
import { enqueueEmail } from "./email.ts";

const HOUR = 3600_000, DAY = 24 * HOUR;
export const PROFILE_REMINDER_JOB = "email:M-29:profile";
export const PROFILE_REMINDER_INTERVAL_SEC = 900;
/** Accounts enqueued per run, so a backlog never floods Resend. */
export const PROFILE_REMINDER_BATCH = 200;
/** Sent from 48 h after sign-up; accounts older than 7 days are never reminded. */
export const PROFILE_REMINDER_AFTER_MS = 2 * DAY, PROFILE_REMINDER_UNTIL_MS = 7 * DAY;
export const profileReminderKey = (accountId: string) => `email:M-29:${accountId}`;

const blank = (column: string) => `btrim(coalesce(a.${column},''))=''`;
/** One SQL expression per gap, over `accounts a`. */
const GAP_SQL: Record<ProfileGap, string> = {
  photo: "a.photo is null",
  roleCompany: `(${blank("job_role")} or ${blank("company")})`,
  headline: blank("headline"),
  link: "jsonb_array_length(coalesce(a.profile_links,'[]'::jsonb))=0",
};
const MISSING_SQL = `array_remove(array[${PROFILE_GAPS.map(g => `case when ${GAP_SQL[g]} then '${g}' end`).join(",")}]::text[],null)`;

/** What the account's profile still misses (empty when complete, or the account is gone). */
export async function profileGaps(q: Queryable, accountId: string): Promise<ProfileGap[]> {
  const [row] = await q.query<{ missing: ProfileGap[] }>(`select ${MISSING_SQL} missing from accounts a where a.id=$1`, [accountId]);
  return row?.missing ?? [];
}

/**
 * Enqueues M-29 for live, email-verified accounts created 48 h to 7 days ago with an incomplete profile, reminders
 * on, not reminded before and not active staff (Didit team accounts never get it).
 */
export async function scheduleProfileReminders(now: Date, db: Db = getDb(), limit = PROFILE_REMINDER_BATCH): Promise<number> {
  const rows = await queryable(db).query<{ id: string }>(`select a.id from accounts a
    where a.created_at <= $1::timestamptz and a.created_at > $2::timestamptz
      and a.deleting_at is null and a.deleted_at is null and a.email_verified_at is not null and a.email_reminders
      and cardinality(${MISSING_SQL}) > 0
      and not exists (select 1 from outbox o where o.dedupe_key='email:M-29:'||a.id::text)
      and not exists (select 1 from staff s where lower(s.email)=lower(a.email) and s.disabled_at is null)
    order by a.created_at,a.id limit $3`, [new Date(now.getTime() - PROFILE_REMINDER_AFTER_MS), new Date(now.getTime() - PROFILE_REMINDER_UNTIL_MS), limit]);
  if (!rows.length) return 0;
  return withTx(async tx => {
    let created = 0;
    for (const r of rows) if (await enqueueEmail(tx, { code: "M-29", dedupeKey: profileReminderKey(r.id), accountId: r.id })) created++;
    return created;
  }, db);
}

export async function scheduleProfileReminderJob(db: Db = getDb()): Promise<void> {
  await scheduleJob(PROFILE_REMINDER_JOB, PROFILE_REMINDER_INTERVAL_SEC, {}, db);
}
export function registerProfileReminderJob(registry: JobRegistry, options: { db?: Db; now?: () => Date } = {}): void {
  const now = options.now ?? (() => new Date());
  registry.register(PROFILE_REMINDER_JOB, async () => { await scheduleProfileReminders(now(), options.db); });
}

/** Send-time eligibility (the preference is checked by the sender): still live, not active staff, created within the window plus one day. */
export async function profileReminderEligible(q: Queryable, accountId: string, now = new Date()): Promise<boolean> {
  const [row] = await q.query<{ ok: boolean }>(`select (a.deleting_at is null and a.deleted_at is null
      and a.created_at > $2::timestamptz
      and not exists (select 1 from staff s where lower(s.email)=lower(a.email) and s.disabled_at is null)) ok
    from accounts a where a.id=$1`, [accountId, new Date(now.getTime() - PROFILE_REMINDER_UNTIL_MS - 86_400_000)]);
  return row?.ok === true;
}
