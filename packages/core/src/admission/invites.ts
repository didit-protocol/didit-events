import { createHash,randomBytes } from "node:crypto";
import type { Db } from "../db/index.ts";
import { withTx,type Tx } from "../db/tx.ts";
import type { GuestPrincipal,Invite,InviteService,Registration,StaffPrincipal } from "../domain/services.ts";
import { enqueueEmail } from "../notifications/email.ts";
import { Admissions } from "./admission.ts";
import { eventStatus } from "../domain/event-status.ts";
import { audit,database,eventBy,fail,one,read,requireEventActor,signal,staffAdmitting } from "./shared.ts";

export const MESSAGE_MAX = 500;
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const validEmail = (email: string) => email.length <= 254 && /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i.test(email);
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export interface InviteInput { eventId: string; email?: string; maxUses: number; expiresAt: Date; message?: string; skipApproval?: boolean }
export interface InviteBatchSummary { invited: number; approvedExisting: number; waitlisted: number; alreadyRequested: number; skippedInvalid: number }
export class Invites implements InviteService {
  constructor(private readonly db?: Db) {}
  private async issue(tx: Tx, actor: StaffPrincipal, input: InviteInput, token: string) {
    const email = input.email === undefined ? null : normalizeEmail(input.email);
    const invite = (await one<Invite>(tx, "insert into invites (event_id,email,token_hash,max_uses,expires_at,created_by,message,skip_approval) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *", [input.eventId, email, tokenHash(token), input.maxUses, input.expiresAt, actor.email, input.message?.trim() ?? "", input.skipApproval !== false]))!;
    if (email) await enqueueEmail(tx, { code: "M-19", dedupeKey: `email:M-19:${invite.id}`, to: email, eventId: input.eventId, data: { inviteId: invite.id, acceptUrl: `/i/${token}`, message: invite.message, skipApproval: invite.skipApproval, inviter: { firstName: actor.email.split("@")[0] }, pitch: (await eventBy(tx, input.eventId))!.name } });
    await audit(tx, input.eventId, actor.email, "invite.create", invite.id, { direct: !!email });
    await signal(tx, input.eventId, "invite");
    return { invite, token };
  }
  async create(actor: StaffPrincipal, input: InviteInput): Promise<{ invite: Invite; token: string }> {
    const email = input.email === undefined ? null : normalizeEmail(input.email);
    if (email !== null && !validEmail(email)) fail("InvalidEmail");
    if (!Number.isSafeInteger(input.maxUses) || input.maxUses < 1 || email && input.maxUses !== 1 || !Number.isFinite(input.expiresAt.getTime())) fail("InvalidInvite");
    if (input.expiresAt <= new Date()) fail("EventEnded");
    const message = input.message?.trim() ?? "";
    if (message.length > MESSAGE_MAX) fail("MessageTooLong");
    const token = randomBytes(32).toString("base64url");
    return withTx(async tx => {
      await tx.query("select id from events where id=$1 for update", [input.eventId]);
      const event = await eventBy(tx, input.eventId);
      if (!event) return fail("EventNotFound");
      await requireEventActor(tx, actor, event.id, "guests.invite");
      // Staff and hosts can invite walk-ins until the event ends; public requests close at the start.
      if (!staffAdmitting(event, new Date())) fail(eventStatus(event, new Date()) === "ended" ? "EventEnded" : event.status === "cancelled" ? "EventCancelled" : event.status === "draft" ? "EventNotPublished" : "RegistrationClosed");
      if (input.expiresAt > event.endsAt) fail("InvalidInvite");
      return this.issue(tx, actor, { ...input, eventId: event.id }, token);
    }, database(this.db));
  }
  async get(token: string): Promise<Invite | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return one(read(this.db), "select * from invites where token_hash=$1", [tokenHash(token)]);
  }
  async redeem(principal: GuestPrincipal, token: string, raw:unknown={}): Promise<Registration> {
    const hint=await this.get(token);if(!hint)return fail("InviteNotFound");
    const redeemed=await one<Registration>(read(this.db),"select r.* from invite_redemptions ir join registrations r on r.id=ir.registration_id where ir.invite_id=$1 and ir.account_id=$2",[hint.id,principal.accountId]);
    if(redeemed)return redeemed;
    const { submitRequestSchema }=await import("../domain/event-model.ts");
    const { Requests }=await import("./requests.ts");
    const input=submitRequestSchema.parse({...raw as object,inviteToken:token});
    const result=await new Requests(database(this.db)).submitRequest(principal,hint.eventId,input);
    return (await one<Registration>(read(this.db),"select * from registrations where id=$1",[result.registration.id]))!;
  }
  async revoke(actor: StaffPrincipal, id: string): Promise<void> {
    const hint = await one<Invite>(read(this.db), "select * from invites where id=$1", [id]);
    if (!hint) return fail("InviteNotFound");
    await withTx(async tx => {
      await requireEventActor(tx, actor, hint.eventId, "guests.invite");
      await tx.query("select id from events where id=$1 for update", [hint.eventId]);
      const invite = await one<Invite>(tx, "update invites set revoked_at=coalesce(revoked_at,clock_timestamp()),revoked_reason='host' where id=$1 returning *", [id]);
      if (!invite) return fail("InviteNotFound");
      await audit(tx, invite.eventId, actor.email, "invite.revoke", id); await signal(tx, invite.eventId, "invite");
    }, database(this.db));
  }
  async batch(actor: StaffPrincipal, eventId: string, emails: string[], options: { skipApproval: boolean; message?: string; overCapacity?: boolean; sendLink?: boolean }): Promise<InviteBatchSummary> {
    if (emails.length > 100) fail("BatchTooLarge");
    if ((options.message?.length ?? 0) > MESSAGE_MAX) fail("MessageTooLong");
    const summary: InviteBatchSummary = { invited: 0, approvedExisting: 0, waitlisted: 0, alreadyRequested: 0, skippedInvalid: 0 };
    for (const email of [...new Set(emails.map(normalizeEmail))]) {
      if (!validEmail(email)) { summary.skippedInvalid++; continue; }
      const existing=await one<Registration>(read(this.db),"select r.* from registrations r join accounts a on a.id=r.account_id where r.event_id=$1 and a.email=$2",[eventId,email]);
      if(existing) {
        if(options.skipApproval && ["pending","waitlisted"].includes(existing.admission)) {
          const result=await new Admissions(this.db).decide(actor,existing.id,"approved",{overCapacity:options.overCapacity});
          summary[result.admission==="approved"?"approvedExisting":"waitlisted"]++;
        } else summary.alreadyRequested++;
      } else {
        const event=await eventBy(read(this.db),eventId);if(!event)fail("EventNotFound");
        await this.create(actor,{eventId,email,maxUses:1,expiresAt:event!.endsAt,message:options.message,skipApproval:options.skipApproval});summary.invited++;
      }
    }
    return summary;
  }
}
