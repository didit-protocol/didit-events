import type { Db } from "../db/index.ts";
import { lockForSeatGrant,withTx,type Tx } from "../db/tx.ts";
import type { AdmissionService,GuestPrincipal,PageRequest,Registration,StaffPrincipal } from "../domain/services.ts";
import { canTransition,type Admission,type TransitionActor } from "../domain/transitions.ts";
import { assertGuest } from "../identity/shared.ts";
import { acceptedEvent,approvalChecks,registrationChecks,renewalCause } from "./policies.ts";
import { accepting,accountBy,actorName,audit,database,eventBy,fail,mail,one,read,registrationBy,requireEventActor,row,signal,staffAdmitting } from "./shared.ts";

export interface GrantOptions { overCapacity?: boolean; reason?: string; actorEmail?: string; notify?: boolean; invited?: boolean; waitlistAtCapacity?: boolean; acceptingInvite?: boolean }
export interface DecisionOptions extends GrantOptions { rejectEmail?: boolean; block?: boolean }
export class Admissions implements AdmissionService {
  constructor(private readonly db?: Db) {}
  /** The event UPDATE lock is already held, and every affected account was locked before it. */
  async grantSeat(tx: Tx, id: string, actor: TransitionActor, options: GrantOptions = {}): Promise<Registration> {
    const registration = await registrationBy(tx, id);
    await accountBy(tx, registration.accountId);
    const event = (await eventBy(tx, registration.eventId))!;
    if (!staffAdmitting(event, new Date())) fail("RegistrationClosed");
    if (options.overCapacity && !["owner", "admin"].includes(actor)) fail("Forbidden");
    if (registration.admission === "approved") {
      // A host may reserve the seat but defer verification until the guest accepts.
      // The approval history id keeps acceptance/retries independent of note edits.
      if (options.acceptingInvite) { await this.approvalMail(tx, registration); return registrationBy(tx, id); }
      return registration;
    }
    if (!canTransition(registration.admission, "approved", actor)) fail("InvalidTransition");
    const checks = await approvalChecks(tx, registration, event, new Date(), actor === "system");
    const [count] = await tx.query<{ n: number }>("select count(*)::int n from registrations where event_id=$1 and admission='approved'", [event.id]);
    const over = count!.n >= event.capacity;
    if (over && !options.overCapacity && options.waitlistAtCapacity === false) fail("Capacity");
    if (over && !options.overCapacity) return registration.admission === "waitlisted" ? registration : this.change(tx, registration, "waitlisted", options.actorEmail ?? actor, "Event at capacity", false, options.notify, actor);
    const next = await this.change(tx, registration, "approved", options.actorEmail ?? actor, options.reason, over, false, actor);
    await audit(tx, event.id, options.actorEmail ?? actor, over ? "admission.over_capacity" : "admission.approve", id, { overCapacity: over, ready: checks.canSubmit });
    if (options.notify !== false) await this.approvalMail(tx, next);
    return next;
  }
  private async approvalMail(tx: Tx, registration: Registration): Promise<void> {
    const event = (await eventBy(tx, registration.eventId))!;
    const checks = await approvalChecks(tx, registration, event, new Date());
    const [history] = await tx.query<{ id: string }>("select id from admission_history where registration_id=$1 and \"to\"='approved' order by created_at desc,id desc limit 1", [registration.id]);
    await mail(tx, "M-06", registration, history?.id ?? registration.createdAt.toISOString(), { renewalNeeded: !checks.canSubmit, missingChecks: checks.missing.map(m=>m.check) });
  }

  private async change(tx: Tx, before: Registration, to: Admission, actor: string, reason?: string, over = false, notify = true, transitionActor: TransitionActor = "system", undoRejection = false): Promise<Registration> {
    // Undo is a separate, time-bounded restoration of the stored pre-rejection state.
    const restoring = undoRejection && ["owner", "admin", "staff"].includes(transitionActor) && before.admission === "rejected" &&
      before.undoRejection?.from === to && ["pending", "waitlisted"].includes(to) && new Date() < new Date(before.undoRejection.until);
    if (!canTransition(before.admission, to, transitionActor) && !restoring) fail("InvalidTransition");
    const event = (await eventBy(tx, before.eventId))!;
    const now = new Date();
    const late = before.admission === "approved" && to === "cancelled_by_guest" && event.startsAt.getTime() - now.getTime() < 86400_000;
    const [history] = await tx.query<{ id: string }>('insert into admission_history (registration_id,"from","to",actor,reason,over_capacity) values ($1,$2,$3,$4,$5,$6) returning id', [before.id, before.admission, to, actor, reason ?? null, over]);
    const undo = to === "rejected" ? { from: before.admission, appliedAt: before.appliedAt.toISOString(), until: new Date(now.getTime() + 30_000).toISOString(), historyId: history!.id, blocked: before.blocked } : null;
    // Queue positions are row_number over ALL waitlisted rows. Re-entry goes to the tail; undo restores the original FIFO key.
    const next = (await one<Registration>(tx, `update registrations set admission=$2::admission,reason=$3,late_cancellation=$4,over_capacity=$5,undo_rejection=$6::jsonb,
      applied_at=case when $2::admission='waitlisted' and admission<>'waitlisted' then greatest(date_trunc('milliseconds',clock_timestamp()),coalesce((select max(applied_at)+interval '1 millisecond' from registrations where event_id=$7 and admission='waitlisted'),date_trunc('milliseconds',clock_timestamp()))) else applied_at end,
      updated_at=clock_timestamp() where id=$1 returning *`, [before.id, to, reason ?? null, late, over, JSON.stringify(undo), before.eventId]))!;
    if (["revoked", "cancelled_by_guest", "cancelled_by_host", "rejected"].includes(to)) await tx.query("update link_tokens set revoked_at=clock_timestamp() where registration_id=$1 and revoked_at is null", [before.id]);
    if (notify) {
      const kind = to === "pending" ? "M-02" : to === "waitlisted" ? "M-09" : to === "rejected" ? "M-10" : to === "cancelled_by_guest" ? "M-20" : ["revoked", "cancelled_by_host"].includes(to) ? "M-21" : null;
      if (kind) await mail(tx, kind, next, history!.id, { reason, kind: before.admission === "pending" ? "withdrawn" : "cancelled" }, undo ? new Date(undo.until) : undefined);
    }
    await audit(tx, event.id, actor, `admission.${to}`, before.id, { from: before.admission, reason, lateCancellation: late });
    await signal(tx, event.id, "admission");
    if (to === "waitlisted" || before.admission === "approved" && to !== "approved") await this.schedulePromotion(tx, event.id);
    return next;
  }
  async schedulePromotion(tx: Tx, eventId: string): Promise<void> {
    await tx.query("insert into jobs (name,interval_sec,payload) values ($1,15,$2::jsonb) on conflict (name) do update set next_run_at=clock_timestamp()", [`waitlist:${eventId}`, JSON.stringify({ eventId })]);
  }
  async decide(actor: StaffPrincipal | GuestPrincipal, id: string, to: Admission, options: DecisionOptions = {}): Promise<Registration> {
    const hint = await registrationBy(read(this.db), id);
    return withTx(async tx => {
      await lockForSeatGrant(tx, [hint.accountId], hint.eventId);
      const before = await registrationBy(tx, id);
      await accountBy(tx, before.accountId);
      if (actor.principal === "staff") await requireEventActor(tx, actor, before.eventId, "requests.decide");
      else { await assertGuest(tx, actor); if (actor.accountId !== before.accountId) fail("Forbidden"); }
      const who = actor.principal === "staff" ? actor.role : "guest";
      if (before.admission === to) return before;
      if (!canTransition(before.admission, to, who)) fail("InvalidTransition");
      const event = (await eventBy(tx, before.eventId))!;
      if (to === "approved") return this.grantSeat(tx, id, who, { ...options, actorEmail: actorName(actor) });
      if (["rejected", "revoked", "cancelled_by_host", "cancelled_by_guest"].includes(to) && !options.reason?.trim()) fail("ReasonRequired");
      if (options.reason && options.reason.length > 500) fail("ReasonTooLong");
      if (actor.principal === "guest" && (new Date() >= event.startsAt || event.status !== "published")) fail("CancellationClosed");
      if (to === "pending") fail("UseApplyForReapplication");
      if (to === "waitlisted" && !accepting(event, new Date())) fail("RegistrationClosed");
      if (options.block) await tx.query("update registrations set blocked=true where id=$1", [id]);
      return this.change(tx, before, to, actorName(actor), options.reason?.trim(), false, to === "rejected" ? options.rejectEmail !== false : options.notify !== false, who);
    }, database(this.db));
  }
  transition(actor: StaffPrincipal | GuestPrincipal, id: string, to: Admission, reason?: string, options: Pick<DecisionOptions, "overCapacity"> = {}) { return this.decide(actor, id, to, { ...options, reason, waitlistAtCapacity: false }); }
  async apply(principal: GuestPrincipal, eventId: string, input: unknown = {}, _legacyWaitlist?: boolean): Promise<Registration> {
    const { Requests } = await import("./requests.ts");
    const result = await new Requests(database(this.db)).submitRequest(principal,eventId,input);
    return registrationBy(read(this.db),result.registration.id);
  }
  async promoteWaitlist(eventId: string): Promise<Registration | null> {
    // An unlocked hint never authorizes a grant. Revalidate FIFO and capacity under
    // account -> event UPDATE; release every lock before considering another account.
    // Scan the whole current queue so 50 ineligible guests cannot starve the next one.
    const attempted: string[] = [];
    const select = "select id,account_id from registrations where event_id=$1 and admission='waitlisted' and not(id=any($2::uuid[])) order by applied_at,id limit 1";
    for (;;) {
      const [candidate] = await read(this.db).query<{ id: string; account_id: string }>(select, [eventId, attempted]);
      if (!candidate) return null;
      const result = await withTx(async tx => {
        await lockForSeatGrant(tx, [candidate.account_id], eventId);
        const event = (await eventBy(tx, eventId))!, now = new Date();
        // Request-mode waitlists always need an explicit staff Promote decision.
        const candidateRegistration = await registrationBy(tx, candidate.id);
        const policy = await acceptedEvent(tx,candidateRegistration,event);
        if (policy.form.mode === "request") return {};
        if (!accepting(event, now) || now.getTime() >= event.startsAt.getTime() - 7200_000) return { stop: true };
        const [count] = await tx.query<{ n: number }>("select count(*)::int n from registrations where event_id=$1 and admission='approved'", [eventId]);
        if (count!.n >= event.capacity) return { stop: true };
        const [current] = await tx.query(select, [eventId, attempted]);
        if (current?.id !== candidate.id || current.account_id !== candidate.account_id) return {};
        const [account] = await tx.query("select id from accounts where id=$1 and deleting_at is null and deleted_at is null", [candidate.account_id]);
        if (!account || !(await approvalChecks(tx,candidateRegistration,event,now,true).catch(()=>null))) return {};
        return { registration: await this.grantSeat(tx, candidate.id, "system") };
      }, database(this.db));
      if (result.stop) return null;
      if (result.registration) return result.registration;
      attempted.push(candidate.id);
    }
  }
  /** Resume an already authorized event cancellation even if its staff actor later leaves. */
  async cancelForEvent(id: string, reason: string, actor: string): Promise<void> {
    const hint = await registrationBy(read(this.db), id);
    await withTx(async tx => {
      await lockForSeatGrant(tx, [hint.accountId], hint.eventId);
      const before = await registrationBy(tx, id), event = (await eventBy(tx, before.eventId))!;
      if (event.status !== "cancelled") fail("EventNotCancelled");
      if (["pending", "approved", "waitlisted"].includes(before.admission)) await this.change(tx, before, "cancelled_by_host", actor, reason);
    }, database(this.db));
  }
  async list(eventId: string, query: PageRequest & { admission?: Admission }) {
    const limit = Math.min(200, Math.max(1, query.limit));
    const rows = (await read(this.db).query(`select * from registrations where event_id=$1 and ($2::admission is null or admission=$2) and ($3::uuid is null or (applied_at,id) > (select applied_at,id from registrations where id=$3 and event_id=$1)) order by applied_at,id limit $4`, [eventId, query.admission ?? null, query.after ?? null, limit + 1])).map(r => row<Registration>(r));
    return { items: rows.slice(0, limit), next: rows.length > limit ? rows[limit - 1]!.id : null };
  }
  async undoReject(actor: StaffPrincipal, id: string): Promise<boolean> {
    const hint = await registrationBy(read(this.db), id);
    return withTx(async tx => {
      await lockForSeatGrant(tx, [hint.accountId], hint.eventId); await requireEventActor(tx, actor, hint.eventId, "requests.decide");
      const before = await registrationBy(tx, id), undo = before.undoRejection;
      if (before.admission !== "rejected" || !undo || new Date() >= new Date(undo.until) || !["pending", "waitlisted"].includes(undo.from)) return false;
      const [message] = await tx.query("select * from outbox where dedupe_key=$1 for update", [`email:M-10:${id}:${undo.historyId}`]);
      if (message && (message.status !== "pending" || message.claim_token)) return false;
      if (message) await tx.query("update outbox set status='sent',payload=null,sent_at=clock_timestamp(),provider_id='cancelled:undo' where id=$1", [message.id]);
      await this.change(tx, before, undo.from as Admission, actor.email, "Rejection undone", false, false, actor.role, true);
      await tx.query("update registrations set applied_at=$2,undo_rejection=null,blocked=$3 where id=$1", [id, undo.appliedAt, !!undo.blocked]);
      return true;
    }, database(this.db));
  }
  async saveNote(actor: StaffPrincipal, id: string, note: string): Promise<void> {
    if (note.length > 500) fail("NoteTooLong");
    const hint = await registrationBy(read(this.db), id);
    await withTx(async tx => { await lockForSeatGrant(tx, [hint.accountId], hint.eventId); await requireEventActor(tx, actor, hint.eventId, "requests.decide"); await tx.query("update registrations set staff_note=$2,updated_at=clock_timestamp() where id=$1", [id, note]); await signal(tx, hint.eventId, "admission"); }, database(this.db));
  }
  async resend(actor: StaffPrincipal, id: string): Promise<boolean> {
    const hint = await registrationBy(read(this.db), id);
    return withTx(async tx => {
      await lockForSeatGrant(tx, [hint.accountId], hint.eventId); await requireEventActor(tx, actor, hint.eventId, "requests.decide");
      const r = await registrationBy(tx, id), event = (await eventBy(tx, r.eventId))!;
      const checks = await registrationChecks(tx, r, event, new Date(), true);
      if (r.admission !== "approved" || !staffAdmitting(event, new Date()) || checks.canSubmit || !checks.missing.some(m => m.reason === "expired")) return false;
      await mail(tx, "M-03", r, `renewal:${renewalCause(checks)}`, { template: "M-03" });
      await signal(tx, r.eventId, "admission"); return true;
    }, database(this.db));
  }
}
