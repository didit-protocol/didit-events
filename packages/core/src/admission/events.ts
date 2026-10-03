import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/index.ts";
import type * as schema from "../db/schema.ts";
import { lockForSeatGrant,withTx } from "../db/tx.ts";
import { checksSchema,coverSchema,doorSchema,emailsSchema,formSchema,speakersSchema,validateQuestionEvolution } from "../domain/event-model.ts";
import { ModelError } from "../domain/model-error.ts";
import type { DomainEvent,EventService,StaffPrincipal } from "../domain/services.ts";
import { enqueueEmail,notifyEventChanged } from "../notifications/index.ts";
import { Admissions } from "./admission.ts";
import { readEventIn } from "./read-model.ts";
import { audit,database,derivedEvent,eventBy,fail,one,read,requireActor,requireEventActor,row,signal } from "./shared.ts";

const inputSchema = z.object({
  slug: z.string().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), name: z.string().trim().min(1).max(200), description: z.string().max(600).default(""),
  startsAt: z.date(), endsAt: z.date(), timezone: z.string().refine(v => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }).default("Europe/Madrid"),
  venue: z.string().max(300).nullable().default(null), address: z.string().max(500).nullable().default(null), capacity: z.number().int().positive().max(1000000),
  checks:checksSchema.default({version:1,required:[],max_age:{}}),door:doorSchema.default({kiosk:false}),
  form:formSchema.default({version:1,mode:"request",closes_at:null,waitlist:true,fields:{phone_number:"off"},questions:[],consent_text:null}),
  emails:emailsSchema.default({version:1,templates:{}}),descriptionMd:z.string().max(20000).default(""),
  agenda: z.unknown().default([]), speakers: speakersSchema.default([]), cover: coverSchema.default({kind:"theme",theme:"aqua"}), welcomeOptions: z.unknown().nullable().default(null),
  placeId: z.string().max(300).nullable().default(null), lat: z.number().min(-90).max(90).nullable().default(null), lng: z.number().min(-180).max(180).nullable().default(null),
  mapsUrl: z.string().max(500).regex(/^https:\/\//).nullable().default(null),
});
const columns = { checks:"checks",door:"door",form:"form",emails:"emails",descriptionMd:"description_md", slug: "slug", name: "name", description: "description", startsAt: "starts_at", endsAt: "ends_at", timezone: "timezone", venue: "venue", address: "address", capacity: "capacity", agenda: "agenda", speakers: "speakers", cover: "cover", welcomeOptions: "welcome_options", placeId: "place_id", lat: "lat", lng: "lng", mapsUrl: "maps_url" } as const;
const json = new Set(["checks","door","form","emails", "agenda", "speakers", "cover", "welcomeOptions"]);
// These columns survive only as the migration archive. New writers use the v2 documents.
const legacyConfiguration = ["requirements", "maxAge", "ageMin", "matchThreshold", "doorMode", "registrationMode", "registrationClosesAt", "emailContent"];
function rejectLegacyWrite(input: object) {
  if (legacyConfiguration.some(key => Object.hasOwn(input, key))) throw new ModelError("invalid", "Use checks, door, form and emails");
}
function validate(input: unknown) {
  const parsed = inputSchema.parse(input);
  if (parsed.endsAt <= parsed.startsAt || parsed.form.closes_at && new Date(parsed.form.closes_at)>parsed.startsAt) fail("InvalidDates");
  if ((parsed.lat === null) !== (parsed.lng === null)) fail("InvalidPlace");
  return parsed;
}
export class Events implements EventService {
  constructor(private readonly db?: Db) {}
  async get(id: string): Promise<DomainEvent | null> { const event = await eventBy(read(this.db), id); return event && derivedEvent(event); }
  async list(): Promise<DomainEvent[]> { return (await read(this.db).query("select * from events order by starts_at desc,id")).map(r => derivedEvent(row<DomainEvent>(r))); }
  async create(actor: StaffPrincipal, input: typeof schema.events.$inferInsert): Promise<DomainEvent> {
    rejectLegacyWrite(input);
    const values = validate(input);
    if (input.status && input.status !== "draft") fail("CreateDraftFirst");
    return withTx(async tx => {
      await requireActor(tx, actor);
      const keys = Object.keys(columns) as (keyof typeof columns)[];
      const event = (await one<DomainEvent>(tx, `insert into events (${keys.map(k => columns[k]).join(",")}) values (${keys.map((k, i) => `$${i + 1}${json.has(k) ? "::jsonb" : ""}`).join(",")}) returning *`, keys.map(k => json.has(k) ? JSON.stringify(values[k]) : values[k])))!;
      await audit(tx, event.id, actor.email, "event.create", event.id); await signal(tx, event.id, "event"); return event;
    }, database(this.db));
  }
  async update(actor: StaffPrincipal, id: string, patch: Partial<Omit<typeof schema.events.$inferInsert, "id">> & {expectedVersion?:number}): Promise<DomainEvent> {
    rejectLegacyWrite(patch);
    return withTx(async tx => {
      await requireEventActor(tx, actor, id, "event.edit");
      const before = await one<DomainEvent>(tx, "select * from events where id=$1 for update", [id]);
      if (!before) return fail("EventNotFound");
      // Scan/spend limits (A-18: daily budget, kiosk on/off, door mode, match threshold) are not part of "edit": hosts may
      // change the rest of the event. Compared on meaning, so an editor that resends the same door/budget passes.
      const limit = (o: unknown) => (o as { dailyScanBudget?: unknown } | null)?.dailyScanBudget ?? null;
      const door = (d: unknown) => { const x = d as { kiosk?: unknown; mode?: unknown; match_threshold?: unknown } | null; return x?.kiosk === true ? `kiosk:${String(x.mode)}:${String(x.match_threshold)}` : "off"; };
      if (patch.welcomeOptions !== undefined && limit(patch.welcomeOptions) !== limit(before.welcomeOptions) || patch.door !== undefined && door(patch.door) !== door(before.door))
        await requireEventActor(tx, actor, id, "event.limits");
      if(patch.expectedVersion!==before.editVersion)throw new ModelError("context_changed");
      if (["ended", "cancelled"].includes(before.status)) throw new ModelError("closed");
      if (patch.status && patch.status !== before.status) fail("UseLifecycleOperation");
      const merged = { ...before, ...patch };
      // Editors and MCP patches resend the cover without the banner; keep the uploaded banner unless explicitly replaced.
      if (patch.cover && before.cover && (before.cover as { wide?: unknown }).wide && !(patch.cover as { wide?: unknown }).wide)
        merged.cover = { ...(patch.cover as object), wide: (before.cover as { wide?: unknown }).wide } as typeof merged.cover;
      const values = validate(merged);
      validateQuestionEvolution(before.form,values.form);
      const [count] = await tx.query<{ n: number }>("select count(*)::int n from registrations where event_id=$1 and admission='approved'", [id]);
      if (values.capacity < before.capacity && values.capacity < count!.n) fail("CapacityBelowApproved");
      const keys = Object.keys(columns) as (keyof typeof columns)[];
      const event = (await one<DomainEvent>(tx, `update events set ${keys.map((k, i) => `${columns[k]}=$${i + 2}${json.has(k) ? "::jsonb" : ""}`).join(",")},updated_at=clock_timestamp() where id=$1 returning *`, [id, ...keys.map(k => json.has(k) ? JSON.stringify(values[k]) : values[k])]))!;
      await audit(tx, id, actor.email, "event.update", id, { policyChanged: before.policyVersion !== event.policyVersion });
      await notifyEventChanged(tx, { eventId: id, before, after: event });
      await signal(tx, id, "event"); return derivedEvent(event);
    }, database(this.db));
  }
  private async lifecycle(actor: StaffPrincipal, id: string, status: DomainEvent["status"], reason?: string, expectedVersion?:number): Promise<DomainEvent> {
    return withTx(async tx => {
      await requireEventActor(tx, actor, id, status === "published" || status === "draft" ? "event.publish" : "event.danger");
      const event = await one<DomainEvent>(tx, "select * from events where id=$1 for update", [id]);
      if (!event) return fail("EventNotFound");
      if(expectedVersion!==undefined && event.editVersion!==expectedVersion)throw new ModelError("context_changed");
      if (event.status === status) return event;
      if (["ended", "cancelled"].includes(event.status)) fail("EventClosed");
      if (status !== "ended" && new Date() >= event.endsAt) fail("EventClosed");
      if (status === "published" && (event.status !== "draft" || event.startsAt <= new Date())) fail("InvalidPublish");
      if(status==="draft") {
        if(event.status!=="published" || event.startsAt<=new Date())throw new ModelError("closed");
        const [used]=await tx.query("select 1 from registrations where event_id=$1 union all select 1 from invites where event_id=$1 and revoked_at is null and expires_at>clock_timestamp() and uses<max_uses limit 1",[id]);
        if(used)throw new ModelError("context_changed","Close requests or cancel this event; guests already have access");
      }
      if(status==="published") {
        if(!event.venue?.trim() || !event.address?.trim())throw new ModelError("invalid","Venue and address are required");
        const {providerCapabilities}=await import("./event-editor.ts");
        const capability=await providerCapabilities(tx);
        if(event.checks.required.includes("phone")&&!capability.phone || event.checks.required.some(c=>c==="id_document"||c==="name_from_id")&&!capability.document || event.checks.age_min!==undefined&&!capability.age)throw new ModelError("provider_unavailable",capability.reason??"Selected checks are unavailable");
      }
      validate(event);
      const next = (await one<DomainEvent>(tx, "update events set status=$2,updated_at=clock_timestamp() where id=$1 returning *", [id, status]))!;
      await audit(tx, id, actor.email, `event.${status}`, id, { reason }); await signal(tx, id, "event");
      if (status === "cancelled") await tx.query("insert into jobs (name,interval_sec,payload) values ($1,15,$2::jsonb) on conflict (name) do nothing", [`cancel-event:${id}`, JSON.stringify({ eventId: id, actor, reason })]);
      return next;
    }, database(this.db));
  }
  publish(actor: StaffPrincipal, id: string, expectedVersion?:number) { return this.lifecycle(actor, id, "published",undefined,expectedVersion); }
  unpublish(actor:StaffPrincipal,id:string,expectedVersion:number){return this.lifecycle(actor,id,"draft",undefined,expectedVersion);}
  end(actor: StaffPrincipal, id: string, expectedVersion?: number) { return this.lifecycle(actor, id, "ended", undefined, expectedVersion); }
  async cancel(actor: StaffPrincipal, id: string, reason: string, expectedVersion?: number): Promise<void> {
    if (!reason.trim() || reason.length > 500) fail("ReasonRequired");
    await this.lifecycle(actor, id, "cancelled", reason, expectedVersion);
    await this.finishCancellation(actor, id, reason);
  }
  async finishCancellation(actor: StaffPrincipal, id: string, reason: string): Promise<void> {
    // Event transaction has committed. Never hold its lock while acquiring account locks.
    const admission = new Admissions(this.db);
    const rows = await read(this.db).query<{ id: string }>("select id from registrations where event_id=$1 and admission in ('pending','approved','waitlisted') order by id", [id]);
    for (const r of rows) { try { await admission.cancelForEvent(r.id, reason, actor.email); } catch (e) { if (!(e instanceof Error && e.message === "RegistrationNotFound")) throw e; } }
    await withTx(async tx => {
      const event = await one<DomainEvent>(tx, "select * from events where id=$1 for update", [id]);
      if (!event) return;
      if (event.status !== "cancelled") fail("EventNotCancelled");
      // Invitees who have not yet applied still need the cancellation notice.
      // Event-only transaction: no account or registration writer follows this lock.
      const invited = await tx.query<{ email: string }>("select distinct i.email from invites i where i.event_id=$1 and i.email is not null and i.revoked_at is null and not exists (select 1 from registrations r join accounts a on a.id=r.account_id where r.event_id=$1 and a.email=i.email)", [id]);
      for (const { email } of invited) await enqueueEmail(tx, { code: "M-21", dedupeKey: `email:M-21:event:${id}:${createHash("sha256").update(email).digest("hex")}`, eventId: id, to: email, data: { recipient: { email, firstName: "there" }, reason, otherEventsUrl: "/events" } });
      await tx.query("update invites set revoked_at=coalesce(revoked_at,clock_timestamp()),revoked_reason='event_cancelled' where event_id=$1 and (revoked_at is null or revoked_reason='account_deletion')", [id]);
      if (invited.length) await signal(tx, id, "invite");
    }, database(this.db));
  }
  async delete(actor: StaffPrincipal, id: string, options: { draftOnly?: boolean } = {}): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const accounts = await read(this.db).query<{ account_id: string }>("select account_id from registrations where event_id=$1 order by account_id", [id]);
      const deleted = await withTx(async tx => {
      await requireEventActor(tx, actor, id, "event.delete");
      if (accounts.length) await lockForSeatGrant(tx, accounts.map(a => a.account_id), id);
      else await tx.query("select id from events where id=$1 for update", [id]);
      const event = await eventBy(tx, id);
      if (!event) fail("EventNotFound");
      if (options.draftOnly && event!.status !== "draft") fail("DraftRequired");
      // A registration may have arrived before the event lock. Retry with its account included;
      // never acquire an additional account lock while holding the event.
      const current = await tx.query<{ account_id: string }>("select account_id from registrations where event_id=$1", [id]);
      if (current.some(r => !accounts.some(a => a.account_id === r.account_id))) return false;
      await audit(tx, id, actor.email, "event.delete", id, { name: event!.name });
      await tx.query("update audit set event_id=null where event_id=$1 and action='event.delete'", [id]);
      await signal(tx, id, "event");
      // Composite FKs require dependents to disappear before kiosk/registration cascades.
      await tx.query("delete from scans where event_id=$1", [id]);
      await tx.query("delete from checkins where event_id=$1", [id]);
      await tx.query("update outbox set status='sent',payload=null,sent_at=clock_timestamp(),provider_id='cancelled:event_deleted' where status='pending' and payload->>'eventId'=$1", [id]);
      await tx.query("delete from jobs where name in ($1,$2)", [`waitlist:${id}`, `cancel-event:${id}`]);
      await tx.query("delete from events where id=$1", [id]); return true;
      }, database(this.db));
      if (deleted) return;
    }
    fail("EventBusyRetry");
  }
  async liveSnapshot(actor: StaffPrincipal, id: string) {
    return withTx(async tx => {
      // One MVCC snapshot for every table, even when transactions commit out of order.
      if (tx.kind === "postgres") await tx.query("set transaction isolation level repeatable read read only");
      await requireEventActor(tx, actor, id, "event.view");
      const model = await readEventIn(tx, id); if (!model) return fail("EventNotFound");
      const { event, registrations, checkins, scans, approvedCount, views } = model;
      const auditRows = (await tx.query("select * from audit where event_id=$1 order by created_at,id", [event.id])).map(r => row<typeof schema.audit.$inferSelect>(r));
      return { updatedAt: new Date(), event, registrations, checkins, scans, audit: auditRows,
        counts: { approved: approvedCount, pending: registrations.filter(r => r.admission === "pending").length, waitlisted: registrations.filter(r => r.admission === "waitlisted").length, verified: views.filter(v => v.registration.admission === "approved" && v.eligible).length, checkedIn: checkins.filter(c => !c.undoneAt).length },
        statuses: views.map(v => ({ registrationId: v.registration.id, status: v.status, eligible: v.eligible, waitlistPosition: v.waitlistPosition })),
      };
    }, database(this.db));
  }
}
