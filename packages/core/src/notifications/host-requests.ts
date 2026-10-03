// Lane H (v4): hosts hear about every new guest request. Called inside the request-submit transaction, after the
// registration is pending or waitlisted; it only reads and inserts outbox rows. Staff invites, re-saves of a draft,
// open-mode auto-approvals and legacy repairs never call it, and a replayed submit returns before reaching it.
import type { Tx } from "../db/tx.ts";
import type { DomainEvent,Registration } from "../domain/services.ts";
import { enqueueEmail } from "./email.ts";
import { LEGACY_TEAM_MAILBOX } from "./resend.ts";

/** Batch guard: at most this many single host emails per event in a rolling window; later requests join a digest. */
export const HOST_EMAIL_BURST = 10;
export const HOST_EMAIL_WINDOW_MS = 10 * 60_000;

/**
 * Every host on the event with an email (speakers[].email) who is active staff, plus the staff member who created the
 * event, de-duplicated and never the guest. With none, the calendar owners (active staff with role owner). The team
 * mailbox (Reply-To) is never a recipient: it is on the provider's suppression list, and one suppressed address
 * blocks the whole message.
 */
export async function hostRecipients(tx: Pick<Tx,"query">, eventId: string, guestEmail: string): Promise<string[]> {
  const guest = guestEmail.trim().toLowerCase();
  const hosts = await tx.query<{ email: string }>(`with named as (
      select lower(btrim(s->>'email')) email from events e,
        jsonb_array_elements(case when jsonb_typeof(e.speakers)='array' then e.speakers else '[]'::jsonb end) s
      where e.id=$1 and jsonb_typeof(s)='object' and s ? 'email'
      union select lower(btrim(a.actor)) from audit a where a.event_id=$1 and a.action='event.create')
    select distinct st.email from staff st join named n on n.email=st.email where st.disabled_at is null and st.email<>$2 order by st.email`, [eventId, guest]);
  const named = hosts.map(h => h.email).filter(email => email !== LEGACY_TEAM_MAILBOX);
  if (named.length) return named;
  const owners = await tx.query<{ email: string }>("select email from staff where role='owner' and disabled_at is null and email<>$1 order by email", [guest]);
  return owners.map(o => o.email).filter(email => email !== LEGACY_TEAM_MAILBOX);
}

/** Start of the fixed 10-minute bucket a digest covers. */
export const digestWindow = (at: Date) => {
  const start = Math.floor(at.getTime() / HOST_EMAIL_WINDOW_MS) * HOST_EMAIL_WINDOW_MS;
  return { start: new Date(start), end: new Date(start + HOST_EMAIL_WINDOW_MS) };
};

/**
 * Queues one M-25 for the hosts (first host in To, the others in CC, replies to the team mailbox), keyed per
 * registration (and re-application), so a retried submit or a duplicate call never sends twice. The payload carries the re-application count: a notice queued for an earlier
 * application is suppressed at send time, so a withdraw-and-reapply is announced once (by its own notice). Past
 * HOST_EMAIL_BURST single emails for the event in the last 10 minutes the request is folded into one M-26 digest
 * for its 10-minute bucket, sent when the bucket closes.
 */
export async function notifyHostsOfRequest(tx: Tx, registration: Registration, event: Pick<DomainEvent,"id">, now: Date): Promise<number> {
  if (registration.admission !== "pending" && registration.admission !== "waitlisted") return 0;
  const [guest] = await tx.query<{ email: string }>("select email from accounts where id=$1", [registration.accountId]);
  const recipients = await hostRecipients(tx, event.id, guest?.email ?? "");
  const [to, ...cc] = recipients;
  if (!to) return 0;
  const kind = registration.admission === "waitlisted" ? "waitlist" : "request";
  const key = `${event.id}:${registration.id}:${registration.reapplicationCount}`;
  const [recent] = await tx.query<{ n: number }>(`select count(distinct split_part(dedupe_key,':',4))::int n from outbox
    where kind='email:M-25' and dedupe_key like $1 and created_at>$2::timestamptz-interval '10 minutes'`, [`email:M-25:${event.id}:%`, now]);
  if ((recent?.n ?? 0) < HOST_EMAIL_BURST) {
    // One message per request, To the hosts themselves; the events inbox is Reply-To only (2026-10-02: it is suppressed at Resend).
    await enqueueEmail(tx, { code: "M-25", dedupeKey: `email:M-25:${key}:hosts`, to, cc, eventId: event.id, data: { registrationId: registration.id, kind, reapplicationCount: registration.reapplicationCount } });
    return 1;
  }
  const window = digestWindow(now);
  await enqueueEmail(tx, { code: "M-26", dedupeKey: `email:M-26:${event.id}:${window.start.getTime()}:hosts`, to, cc, eventId: event.id,
    data: { windowStart: window.start, windowEnd: window.end }, runAt: window.end });
  return 1;
}
