import { createHash } from "node:crypto";
import { registrationChecks,renewalCause } from "../admission/policies.ts";
import { eventBy,registrationBy } from "../admission/shared.ts";
import { getDb,type Db } from "../db/index.ts";
import { queryable,withTx,type Queryable,type Tx } from "../db/tx.ts";
import type { EmailCode } from "../email/index.ts";
import { scheduleJob,type JobRegistry } from "../jobs.ts";
import { withCalendar } from "./calendar-invite.ts";
import { emailKind,enqueueEmail,EVENT_COLUMNS,mapsUrl,REMINDER_CODES,type EventEmailRow } from "./email.ts";
import { registerProfileReminderJob,scheduleProfileReminderJob } from "./profile-reminder.ts";

const HOUR = 3600_000, DAY = 24 * HOUR;
/** Scheduled lifecycle emails run every five minutes; each is a separate advisory-locked job. */
export const LIFECYCLE_INTERVAL_SEC = 300;
export const LIFECYCLE_JOBS = { "M-05": "email:M-05:nudge", "M-11": "email:M-11:tomorrow", "M-12": "email:M-12:doors", "M-14": "email:M-14:thanks" } as const;
export const OUTBOX_RETENTION_JOB = "outbox:retention";
/** C: B5 clears sent/failed payloads after seven days; dedupe keys stay forever. */
export const OUTBOX_PAYLOAD_RETENTION_DAYS = 7;

type EventRow = EventEmailRow;
interface Candidate { registration_id: string; account_id: string; deleting_at: Date | null; deleted_at: Date | null; renewalCause?:string }
const EVENT_SELECT = `select ${EVENT_COLUMNS} from events`;
const str = (v: unknown): string | undefined => typeof v === "string" && v.trim() ? v.trim() : undefined;

/** Splits candidates by C15/C25 eligibility for this event (read without locks: a reminder is advisory, the door re-checks). */
async function byEligibility(q: Queryable, event: EventRow, candidates: Candidate[], now:Date): Promise<{ eligible: Candidate[]; ineligible: Candidate[] }> {
  if (!candidates.length) return { eligible: [], ineligible: [] };
  const target=await eventBy(q,event.id);if(!target)return {eligible:[],ineligible:[]};
  const out = { eligible: [] as Candidate[], ineligible: [] as Candidate[] };
  for (const c of candidates) {
    const checks=await registrationChecks(q,await registrationBy(q,c.registration_id),target,now,true);
    (checks.canSubmit ? out.eligible : out.ineligible).push({...c,renewalCause:renewalCause(checks)});
  }
  return out;
}

/**
 * Approved registrations of live accounts, excluding opted-out ones when the code is a reminder.
 * The account filter is repeated at send time, so a later opt-out or deletion still suppresses.
 */
async function candidates(q: Queryable, eventId: string, code: EmailCode, extra = "", params: unknown[] = []): Promise<Candidate[]> {
  const pref = REMINDER_CODES.includes(code) ? "and a.email_reminders" : "";
  return q.query<Candidate & Record<string, unknown>>(`select r.id as registration_id,r.account_id,a.deleting_at,a.deleted_at
    from registrations r join accounts a on a.id=r.account_id
    where r.event_id=$1 and r.admission='approved' and a.deleting_at is null and a.deleted_at is null ${pref} ${extra}
    order by r.id`, [eventId, ...params]);
}
async function enqueueAll(db: Db, code: EmailCode, event: EventRow, rows: Candidate[], data: (c: Candidate) => Record<string, unknown>, key: (c: Candidate) => string = c => c.registration_id): Promise<number> {
  if (!rows.length) return 0;
  return withTx(async tx => {
    let created = 0;
    for (const c of rows) if (await enqueueEmail(tx, { code, dedupeKey: `${emailKind(code)}:${key(c)}`, accountId: c.account_id, eventId: event.id, data: data(c) })) created++;
    return created;
  }, db);
}
const upcoming = (q: Queryable, from: Date, to: Date | null) => q.query<EventRow & Record<string, unknown>>(
  `${EVENT_SELECT} where status in ('published','live') and starts_at > $1::timestamptz and ($2::timestamptz is null or starts_at <= $2::timestamptz) order by starts_at,id`, [from, to]);

/** M-05: approved at least 24 h ago, still not eligible, event not started. One nudge per registration and check cause. */
export async function scheduleVerificationNudges(now: Date, db: Db = getDb()): Promise<number> {
  const q = queryable(db); let created = 0;
  for (const event of await upcoming(q, now, null)) {
    // Approval time is the latest transition into 'approved'; rows without history fall back to updated_at.
    const rows = await candidates(q, event.id, "M-05", 
      "and coalesce((select max(h.created_at) from admission_history h where h.registration_id=r.id and h.to='approved'), r.updated_at) <= $2::timestamptz",
      [new Date(now.getTime() - DAY)]);
    const { ineligible } = await byEligibility(q, event, rows,now);
    const deadline = event.starts_at;
    created += await enqueueAll(db, "M-05", event, ineligible, () => ({ verifyUrl: `/me/events/${event.slug}`, deadline, timeZone: event.timezone }), c=>`${c.registration_id}:${c.renewalCause}`);
  }
  return created;
}

interface AgendaItem { t: string; l: string }
/**
 * Accepts the editor's {at,endAt?,label} rows (ISO instants, shown as HH:mm or HH:mm–HH:mm in `timeZone`) and the
 * older {t,l} or {time,title|label} blocks; anything else is dropped.
 */
export function agendaItems(value: unknown, timeZone = "Europe/Madrid"): AgendaItem[] {
  if (!Array.isArray(value)) return [];
  const hm = (at: string | undefined) => {
    if (!at || !Number.isFinite(Date.parse(at))) return undefined;
    try { return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at)); } catch { return undefined; }
  };
  return value.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const r = item as Record<string, unknown>;
    const at = str(r.at), endAt = str(r.endAt), until = at && endAt && Date.parse(endAt) > Date.parse(at) ? hm(endAt) : undefined;
    const start = hm(at), t = str(r.t) ?? str(r.time) ?? (start && until ? `${start}–${until}` : start), l = str(r.l) ?? str(r.title) ?? str(r.label);
    return t && l ? [{ t, l }] : [];
  }).slice(0, 30);
}

/** M-11: the day before (start within 24 h but more than 1 h away), to eligible approved guests. */
export async function scheduleTomorrowReminders(now: Date, db: Db = getDb()): Promise<number> {
  const q = queryable(db); let created = 0;
  for (const event of await upcoming(q, new Date(now.getTime() + HOUR), new Date(now.getTime() + DAY))) {
    const [agenda] = await q.query<{ agenda: unknown }>("select agenda from events where id=$1", [event.id]);
    const { eligible: rows } = await byEligibility(q, event, await candidates(q, event.id, "M-11"),now);
    created += await enqueueAll(db, "M-11", event, rows, () => ({ teaser: "", agenda: agendaItems(agenda?.agenda, event.timezone), directionsUrl: mapsUrl(event) }));
  }
  return created;
}

/** M-12: doors within the next hour, to eligible approved guests not yet checked in. */
export async function scheduleDoorsReminders(now: Date, db: Db = getDb()): Promise<number> {
  const q = queryable(db); let created = 0;
  for (const event of await upcoming(q, now, new Date(now.getTime() + HOUR))) {
    const rows = await candidates(q, event.id, "M-12", "and not exists (select 1 from checkins k where k.registration_id=r.id and k.undone_at is null)");
    const { eligible: ok } = await byEligibility(q, event, rows,now);
    created += await enqueueAll(db, "M-12", event, ok, () => ({ directions: "", mapsUrl: mapsUrl(event) }));
  }
  return created;
}

/** M-14: one day after the end (up to seven days late), to guests with a standing check-in. */
export async function scheduleThanks(now: Date, db: Db = getDb()): Promise<number> {
  const q = queryable(db); let created = 0;
  const events = await q.query<EventRow & Record<string, unknown>>(`${EVENT_SELECT} where status in ('published','live','ended')
    and ends_at <= $1::timestamptz and ends_at > $2::timestamptz order by ends_at,id`, [new Date(now.getTime() - DAY), new Date(now.getTime() - 7 * DAY)]);
  for (const event of events) {
    const attended = "exists (select 1 from checkins k where k.registration_id=r.id and k.undone_at is null)";
    const [count] = await q.query<{ n: number }>(`select count(*)::int as n from registrations r where r.event_id=$1 and ${attended}`, [event.id]);
    const url = `/e/${event.slug}`;
    const rows = await q.query<Candidate & Record<string, unknown>>(`select r.id as registration_id,r.account_id,a.deleting_at,a.deleted_at
      from registrations r join accounts a on a.id=r.account_id
      where r.event_id=$1 and ${attended} and a.deleting_at is null and a.deleted_at is null and a.email_reminders order by r.id`, [event.id]);
    created += await enqueueAll(db, "M-14", event, rows, () => ({
      attendeeCount: count?.n ?? 0,
      recap: { preheader: "Recordings and photos are up.", line: "The recordings and photos are on the event page." },
      recordingsUrl: url, photosUrl: url,
    }));
  }
  return created;
}

/** B5 retention: clear delivered/failed payloads after seven days without deleting the dedupe record. */
export async function clearSentPayloads(now: Date, db: Db = getDb()): Promise<number> {
  const rows = await queryable(db).query(`update outbox set payload=null where kind<>'email.test' and status in ('sent','failed') and payload is not null
    and coalesce(sent_at,failed_at,created_at) < $1::timestamptz returning id`, [new Date(now.getTime() - OUTBOX_PAYLOAD_RETENTION_DAYS * DAY)]);
  return rows.length;
}

// ── B4 hooks: called inside B4's own transaction (which already holds its C22 locks). They only read and insert
// outbox rows, so they never acquire an account/registration/event lock of their own. ──────────────────────────

/** What a guest's calendar entry shows: a change to any of these sends a calendar update. */
export interface EventPlace { name: string; startsAt: Date; endsAt: Date; venue: string | null; address: string | null }
/** Seeds the jobs table (idempotent upsert). */
export async function scheduleLifecycleJobs(db: Db = getDb()): Promise<void> {
  for (const name of Object.values(LIFECYCLE_JOBS)) await scheduleJob(name, LIFECYCLE_INTERVAL_SEC, {}, db);
  await scheduleJob(OUTBOX_RETENTION_JOB, 3600, {}, db);
  await scheduleProfileReminderJob(db);
}

/**
 * M-16: the start, end, title or venue changed on a published/live event → every approved guest. Keyed by the event's
 * persisted edit revision (`edit_version`, bumped by every saved edit) and the new values, so each saved change notifies
 * once, and a change back to earlier values (A→B→A→B) is a new update, never a duplicate of an older one.
 */
export async function notifyEventChanged(tx: Tx, input: { eventId: string; before: EventPlace; after: EventPlace }): Promise<number> {
  const { before, after } = input;
  const timeChanged = before.startsAt.getTime() !== after.startsAt.getTime();
  const venueChanged = (before.venue ?? "") !== (after.venue ?? "") || (before.address ?? "") !== (after.address ?? "");
  const detailsChanged = before.endsAt.getTime() !== after.endsAt.getTime() || before.name !== after.name;
  if (!timeChanged && !venueChanged && !detailsChanged) return 0;
  const [event] = await tx.query<{ status: string; slug: string; edit_version: number }>("select status,slug,edit_version from events where id=$1", [input.eventId]);
  if (!event || !["published", "live"].includes(event.status)) return 0;
  const change = timeChanged ? { kind: "time", before: before.startsAt } : venueChanged ? { kind: "venue", before: [before.venue, before.address].filter(Boolean).join(", ") } : { kind: "details" };
  const values = createHash("sha256").update(JSON.stringify([after.startsAt.toISOString(), after.endsAt.toISOString(), after.name, after.venue ?? "", after.address ?? ""])).digest("hex").slice(0, 16);
  const revision = `${event.edit_version}:${values}`;
  const rows = await candidates(tx, input.eventId, "M-16"), calendarUrl = `/e/${event.slug}/event.ics`;
  let created = 0;
  // Each update carries the guest's calendar invitation again (same UID, SEQUENCE+1 per registration), so the entry moves too.
  for (const c of rows) if (await withCalendar(tx, c.registration_id, "REQUEST", calendar => enqueueEmail(tx, { code: "M-16", dedupeKey: `email:M-16:${c.registration_id}:${revision}`, accountId: c.account_id, eventId: input.eventId, data: { change, calendarUrl, ...(calendar ? { calendar } : {}) } }))) created++;
  return created;
}
/**
 * M-21: B4 cancelled these registrations as the host (revocation or event cancellation). `occasion` distinguishes
 * separate cancellations of the same registration (e.g. the admission_history id, or "event-cancelled").
 */
export async function notifyHostCancellation(tx: Tx, input: { eventId: string; registrationIds: readonly string[]; occasion: string }): Promise<number> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.occasion)) throw new Error("InvalidCancellationOccasion");
  if (!input.registrationIds.length) return 0;
  const rows = await tx.query<{ registration_id: string; account_id: string }>(`select r.id as registration_id,r.account_id from registrations r join accounts a on a.id=r.account_id
    where r.event_id=$1 and r.id = any($2::uuid[]) and a.deleting_at is null and a.deleted_at is null order by r.id`, [input.eventId, [...input.registrationIds]]);
  let created = 0;
  for (const c of rows) if (await withCalendar(tx, c.registration_id, "CANCEL", calendar => enqueueEmail(tx, { code: "M-21", dedupeKey: `email:M-21:${c.registration_id}:${input.occasion}`, accountId: c.account_id, eventId: input.eventId, data: { otherEventsUrl: "/events", ...(calendar ? { calendar } : {}) } }))) created++;
  return created;
}

/** Registers the advisory-locked lifecycle jobs. Each handler is idempotent through its dedupe keys. */
export function registerLifecycleJobs(registry: JobRegistry, options: { db?: Db; now?: () => Date } = {}): void {
  const now = options.now ?? (() => new Date()), db = options.db;
  registry.register(LIFECYCLE_JOBS["M-05"], async () => { await scheduleVerificationNudges(now(), db); });
  registry.register(LIFECYCLE_JOBS["M-11"], async () => { await scheduleTomorrowReminders(now(), db); });
  registry.register(LIFECYCLE_JOBS["M-12"], async () => { await scheduleDoorsReminders(now(), db); });
  registry.register(LIFECYCLE_JOBS["M-14"], async () => { await scheduleThanks(now(), db); });
  registry.register(OUTBOX_RETENTION_JOB, async () => { await clearSentPayloads(now(), db); });
  registerProfileReminderJob(registry, { db, now });
}
