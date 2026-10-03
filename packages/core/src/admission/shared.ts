import { isStaffEmail } from "../staff-email.ts";
import { staffForApiToken } from "../identity/tokens.ts";
import { can,EVENT_CAPABILITIES,isGlobalRole,type EventCapability } from "../access/capabilities.ts";
import { getDb,type Db } from "../db/index.ts";
import { queryable,type Queryable,type Tx } from "../db/tx.ts";
import { eligibility } from "../domain/eligibility.ts";
import { eventStatus } from "../domain/event-status.ts";
import type { Account,DomainEvent,Evidence,Registration,StaffPrincipal } from "../domain/services.ts";
import type { EmailCode } from "../email/index.ts";
import { sessionLiveSql } from "../identity/shared.ts";
import { calendarMethodFor,withCalendar } from "../notifications/calendar-invite.ts";
import { enqueueEmail } from "../notifications/email.ts";
import { notifyInTx } from "../notify.ts";
import { enqueue } from "../outbox.ts";

export class AdmissionError extends Error {
  constructor(readonly code: string) { super(code); this.name = "AdmissionError"; }
}
export const fail = (code: string): never => { throw new AdmissionError(code); };
export const uuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
/** Only database column names are converted; JSON values keep their provider/application keys. */
export function row<T>(value: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v])) as T;
}
export async function one<T>(q: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  const [value] = await q.query(sql, params); return value ? row<T>(value) : null;
}
export const database = (db?: Db) => db ?? getDb();
export async function eventBy(q: Queryable, id: string): Promise<DomainEvent | null> {
  return one(q, "select * from events where id::text=$1 or slug=$1", [id]);
}
export function derivedEvent(event: DomainEvent, now = new Date()): DomainEvent {
  return { ...event, status: eventStatus(event, now) };
}
export async function accountBy(q: Queryable, id: string): Promise<Account> {
  const account = await one<Account>(q, "select * from accounts where id=$1", [id]);
  if (!account || account.deletingAt || account.deletedAt) fail("AccountUnavailable");
  return account!;
}
/** Global staff only. An event-scoped actor is always refused here; event work goes through `requireEventActor`. */
export async function requireActor(q: Queryable, actor: StaffPrincipal, roles: readonly string[] = ["owner", "admin", "staff"], lock = false): Promise<void> {
  if (actor.principal !== "staff" || actor.scope || !isStaffEmail(actor.email)) fail("Forbidden");
  if (actor.apiTokenId) {
    const tokenStaff = await staffForApiToken(q, actor.apiTokenId, lock);
    if (!tokenStaff || tokenStaff.email !== actor.email || tokenStaff.role !== actor.role) fail("Forbidden");
  }
  const [staff] = await q.query(`select role from staff where email=$1 and disabled_at is null ${lock ? "for share" : ""}`, [actor.email]);
  if (!staff || staff.role !== actor.role || !roles.includes(actor.role)) fail("Forbidden");
  if (actor.apiTokenId) return;
  const [session] = await q.query(`select s.id from sessions s left join accounts a on a.id=s.account_id
    where s.id=$1 and (${sessionLiveSql()}) and ((s.principal='staff' and s.staff_email=$2)
      or (s.principal='guest' and a.email=$2 and a.deleting_at is null and a.deleted_at is null)) ${lock ? "for share of s" : ""}`,[actor.sessionId,actor.email]);
  if (!session) fail("Forbidden");
}
/**
 * The core half of the capability matrix (access/capabilities.ts): global staff need a global role that holds the
 * capability; an event team member needs a scope on exactly this event, a role that holds it, a live membership row
 * for the session's own account email and a live guest session. Fails closed with `Forbidden`.
 */
export async function requireEventActor(q: Queryable, actor: StaffPrincipal, eventId: string, capability: EventCapability, lock = false): Promise<void> {
  if (!actor.scope) return requireActor(q, actor, EVENT_CAPABILITIES[capability].filter(isGlobalRole), lock);
  if (actor.principal !== "staff" || actor.apiTokenId || !uuid(actor.scope.eventId) || !can(actor.scope.role, capability)) fail("Forbidden");
  const [member] = await q.query<{ role: string }>(`select m.role from event_members m
    join accounts a on a.email=m.email and a.deleting_at is null and a.deleted_at is null
    join sessions s on s.account_id=a.id and s.principal='guest'
    where m.event_id=$1 and (m.event_id::text=$2 or exists(select 1 from events e where e.id=m.event_id and e.slug=$2))
      and m.email=$3 and m.revoked_at is null and s.id=$4 and (${sessionLiveSql()}) ${lock ? "for share of m" : ""}`, [actor.scope.eventId, eventId, actor.email, actor.sessionId]);
  if (!member || member.role !== actor.scope.role) fail("Forbidden");
}
export async function eligibleFor(q: Queryable, accountId: string, event: DomainEvent) {
  const account = await accountBy(q, accountId);
  const evidence = (await q.query("select * from evidence where account_id=$1", [accountId])).map(r => row<Evidence>(r));
  return { account, evidence, ...eligibility({ ...account, evidence }, event) };
}
export const actorName = (actor: StaffPrincipal | { accountId: string }) => "email" in actor ? actor.email : actor.accountId;
export async function signal(tx: Tx, eventId: string, type: string): Promise<void> {
  await notifyInTx(tx, `event_${eventId}`, { type, event_id: eventId });
}
export async function audit(tx: Tx, eventId: string, actor: string, action: string, target: string, data: Record<string, unknown> = {}): Promise<void> {
  await tx.query("insert into audit (event_id,actor,action,target,data) values ($1,$2,$3,$4,$5::jsonb)", [eventId, actor, action, target, JSON.stringify(data)]);
}
export async function mail(tx: Tx, kind: string, registration: Registration, key: string, extra: Record<string, unknown> = {}, runAt?: Date): Promise<void> {
  if (kind === "verify_invite") {
    await enqueue(tx, { kind, dedupeKey: `${kind}:${registration.id}:${key}`, payload: { eventId: registration.eventId, registrationId: registration.id, accountId: registration.accountId, ...extra }, runAt });
    return;
  }
  const event = (await eventBy(tx, registration.eventId))!;
  const data: Record<string, unknown> = { registrationId: registration.id, ...extra };
  if (kind === "M-02") data.replyBy = event.startsAt;
  if (kind === "M-06") {
    data.icsUrl = `/e/${event.slug}/event.ics`;
    const stamp = (at: Date) => at.toISOString().replace(/[-:]|\.\d{3}/g, "");
    data.googleCalendarUrl = `https://calendar.google.com/calendar/render?${new URLSearchParams({ action: "TEMPLATE", text: event.name, dates: `${stamp(event.startsAt)}/${stamp(event.endsAt)}`, location: [event.venue, event.address].filter(Boolean).join(", ") })}`;
  }
  if (kind === "M-09") {
    const [position] = await tx.query<{ n: number }>("select count(*)::int n from registrations where event_id=$1 and admission='waitlisted' and (applied_at,id)<=($2,$3::uuid)", [event.id, registration.appliedAt, registration.id]);
    data.position = position!.n;
    const [policy] = await tx.query<{ form: DomainEvent["form"] }>("select form from event_policies where event_id=$1 and version=$2", [event.id, registration.policyVersion]);
    data.requiresReview = policy?.form.mode === "request";
  }
  if (kind === "M-10") data.subscribeUrl = "/events";
  if (kind === "M-20") { data.cancelledAt = new Date(); data.requestAgainUrl = `/e/${event.slug}/register`; }
  if (kind === "M-21") data.otherEventsUrl = "/events";
  const send = (calendar: unknown) => enqueueEmail(tx, { code: kind as EmailCode, dedupeKey: `email:${kind}:${registration.id}:${key}`, accountId: registration.accountId, eventId: event.id, data: calendar ? { ...data, calendar } : data, runAt });
  // You're in carries the calendar invitation; a cancellation of an approved place removes it from the guest's calendar.
  // (M-16 attaches its own REQUEST in lifecycle, per changed guest.)
  const method = kind === "M-16" ? null : calendarMethodFor(kind);
  if (method) await withCalendar(tx, registration.id, method, send);
  else await send(null);
}
export async function registrationBy(q: Queryable, id: string): Promise<Registration> {
  const registration = uuid(id) ? await one<Registration>(q, "select * from registrations where id=$1", [id]) : null;
  return registration ?? fail("RegistrationNotFound");
}
export const read = (db?: Db) => queryable(database(db));
/** Closing the public request form still permits staff decisions and direct invitations. */
export function admitting(event: DomainEvent, now: Date): boolean {
  return event.status === "published" && now < event.startsAt && now < event.endsAt;
}
/** Staff and hosts grant seats and invite walk-ins until the event ENDS (published or live); public requests use `accepting`. */
export function staffAdmitting(event: DomainEvent, now: Date): boolean {
  const status = eventStatus(event, now);
  return status === "published" || status === "live";
}
export function accepting(event: DomainEvent, now: Date): boolean {
  return admitting(event, now) && (!event.form.closes_at || now < new Date(event.form.closes_at));
}
