import sharp from "sharp";
import { lockAccount,lockForDeletion,queryable,withTx } from "../db/tx.ts";
import type { AccountService,Deletion,GuestPrincipal } from "../domain/services.ts";
import { notifyInTx } from "../notify.ts";
import { Onboarding } from "./onboarding.ts";
import type { DeletionRestore } from "../db/schema.ts";
import { activeAccount,assertGuest,camel,hash,IdentityError,readToken,tombstoned,type IdentityContext } from "./shared.ts";

/** v5: how long a requested deletion waits before it runs; "Keep my account" in the same browser undoes it until then. */
export const DELETION_GRACE_MS = 7 * 86400_000;
/** The note on a place restored by "Keep my account" whose seat went to someone else during the grace period. */
export const SEAT_TAKEN_NOTE = "place taken while the account was set for deletion";
export interface PendingDeletion { deletionId: string; accountId: string; graceUntil: Date }

export function validatePhoto(bytes: Uint8Array): void {
  if (bytes.length > 300 * 1024 || bytes.length < 20 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new IdentityError("InvalidPhoto", 400);
  let pos = 2, dimensions = false, scan = false;
  while (pos + 3 < bytes.length) {
    if (bytes[pos++] !== 255) throw new IdentityError("InvalidPhoto", 400);
    while (bytes[pos] === 255) pos++;
    const marker = bytes[pos++]!;
    if (marker === 218) { scan = true; break; }
    const size = bytes[pos]! * 256 + bytes[pos + 1]!;
    if (size < 2 || pos + size > bytes.length) throw new IdentityError("InvalidPhoto", 400);
    if ([192, 193, 194].includes(marker)) {
      if (dimensions || size < 8 || bytes[pos + 2] !== 8 || bytes[pos + 3]! * 256 + bytes[pos + 4]! !== 512 || bytes[pos + 5]! * 256 + bytes[pos + 6]! !== 512) throw new IdentityError("PhotoMustBe512Square", 400);
      dimensions = true;
    }
    pos += size;
  }
  if (!dimensions || !scan) throw new IdentityError("InvalidPhoto", 400);
}
export interface ProfileInput { firstName: string; lastName: string; expectedProfileVersion?:number; photoUrl?: string | null; headline?: string; bio?: string; company?: string; jobRole?: string; profileLinks?: Array<{ label: string; href: string }>; confirmVerifiedNameChange?: boolean }
export function accountServices(ctx: IdentityContext) {
  async function updateProfile(principal: GuestPrincipal, input: ProfileInput) {
    if(input.photoUrl!==undefined)throw new IdentityError("UsePhotoUpload",400);
    const account=await activeAccount(queryable(ctx.db()),principal.accountId);
    await new Onboarding({db:ctx.db(),launch:async()=>({state:"blocked",code:"provider_unavailable"})}).saveOnboardingProfile(principal,{
      expectedProfileVersion:input.expectedProfileVersion??account.profileVersion,fullName:[input.firstName.trim(),input.lastName.trim()].filter(Boolean).join(" "),
      ...(input.headline!==undefined?{headline:input.headline}:{}),...(input.company!==undefined?{company:input.company}:{}),...(input.bio!==undefined?{bio:input.bio}:{}),...(input.jobRole!==undefined?{jobRole:input.jobRole}:{}),
      ...(input.profileLinks?{links:input.profileLinks.map(l=>({...l,kind:(new URL(l.href).hostname.replace(/^www\./,"")==="linkedin.com"?"linkedin":"website") as "linkedin"|"website"}))}:{})});
    return activeAccount(queryable(ctx.db()),principal.accountId);
  }
  /**
   * `graceMs` (v5): the deletion runs after the grace period instead of at once. Everything is still disabled now (C19),
   * but what changed is recorded so `keepAccount` can put it back, and the requesting session stays (inert: it resolves
   * for nothing but `pendingDeletion` / `keepAccount`) so this browser can show the banner and keep the account.
   */
  async function requestDeletion(principal: GuestPrincipal, options: { graceMs?: number } = {}): Promise<Deletion> {
    const grace = options.graceMs && options.graceMs > 0 ? options.graceMs : 0;
    return withTx(async tx => {
      await lockForDeletion(tx, principal.accountId);
      const account = await assertGuest(tx, principal);
      const restore: DeletionRestore | null = grace ? {
        evidence: (await tx.query<{ id: string; state: string; activation: string; invalidated_at: Date | null; invalidated_reason: string | null }>("select id,state,activation,invalidated_at,invalidated_reason from evidence where account_id=$1", [account.id]))
          .map(e => ({ id: e.id, state: e.state, activation: e.activation, invalidatedAt: e.invalidated_at?.toISOString() ?? null, invalidatedReason: e.invalidated_reason })),
        registrations: (await tx.query<{ id: string; admission: string; reason: string | null; late_cancellation: boolean }>("select id,admission,reason,late_cancellation from registrations where account_id=$1 and admission<>'cancelled_by_guest'", [account.id]))
          .map(r => ({ id: r.id, admission: r.admission, reason: r.reason, lateCancellation: r.late_cancellation })),
        invites: (await tx.query<{ id: string }>("select id from invites where email=$1 and revoked_at is null", [account.email])).map(i => i.id),
      } : null;
      // C19: this is the first domain write. All disablement and the tombstone commit together.
      await tx.query("update accounts set deleting_at=clock_timestamp(),updated_at=clock_timestamp() where id=$1", [account.id]);
      const remote = await tx.query<{ didit_session_id: string }>("select didit_session_id from verifications where account_id=$1", [account.id]);
      await tx.query("update evidence set invalidated_at=coalesce(invalidated_at,clock_timestamp()),invalidated_reason='account_deleted',activation='revoked',state='invalidated',updated_at=clock_timestamp() where account_id=$1", [account.id]);
      await tx.query("update sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where account_id=$1 and ($2::uuid is null or id<>$2::uuid)", [account.id, grace ? principal.sessionId : null]);
      await tx.query("update link_tokens set revoked_at=coalesce(revoked_at,clock_timestamp()) where registration_id in(select id from registrations where account_id=$1)", [account.id]);
      await tx.query("update invites set revoked_at=clock_timestamp(),revoked_reason='account_deletion' where email=$1 and revoked_at is null", [account.email]);
      await tx.query("update otp_challenges set redeemed_at=coalesce(redeemed_at,clock_timestamp()) where email=$1", [account.email]);
      await tx.query(`insert into admission_history(registration_id,"from","to",actor,reason) select id,admission,'cancelled_by_guest',$1::text,'account deleted' from registrations where account_id=$1::uuid and admission<>'cancelled_by_guest'`, [account.id]);
      const affected = await tx.query<{ event_id: string }>("update registrations set admission='cancelled_by_guest',reason='account deleted',updated_at=clock_timestamp() where account_id=$1 returning event_id", [account.id]);
      const unfinished = await tx.query("select id from verification_ops where account_id=$1 and state='creating' and verification_id is null", [account.id]);
      await tx.query("update verification_ops set state='expired' where account_id=$1 and state in ('creating','active')", [account.id]);
      const [row] = await tx.query(`insert into deletions(email_hash,account_id,original_account_id,didit_session_ids,manual_reason,grace_until,next_attempt_at,session_id,restore)
        values($1,$2,$2,$3::jsonb,$4,$5,coalesce($5,clock_timestamp()),$6,$7::jsonb) returning *`,
      [hash(account.email), account.id, JSON.stringify(remote.map(r => r.didit_session_id)), unfinished.length ? "verification_creation_in_flight" : null,
        grace ? new Date(Date.now() + grace) : null, grace ? principal.sessionId : null, restore ? JSON.stringify(restore) : null]);
      await tx.query("insert into audit(actor,action,target) values($1,'account.deletion_requested',$2)", [account.id, row!.id]);
      await tx.query("insert into jobs(name,interval_sec) values('identity:deletions',60) on conflict(name) do update set next_run_at=clock_timestamp()");
      for (const { event_id } of affected) await notifyInTx(tx, `event_${event_id}`, { type: "account_deleted", event_id });
      return camel<Deletion>(row!);
    }, ctx.db());
  }
  async function finishDeletion(id: string): Promise<Deletion> {
    const q = queryable(ctx.db()), [raw] = await q.query("select * from deletions where id=$1", [id]);
    if (!raw) throw new IdentityError("DeletionNotFound", 404);
    const deletion = camel<Deletion>(raw);
    if (deletion.state === "complete" || (deletion.state === "manual" && !deletion.manualCompletedAt)) return deletion;
    // A deletion kept in its grace period is gone (or not due yet): never erase anything remotely for it.
    const claimed = await q.query("update deletions set state='remote_pending',attempts=attempts+1 where id=$1 and state<>'complete' returning id", [id]);
    if (!claimed.length) throw new IdentityError("DeletionNotFound", 404);
    let confirmed = true;
    if (!deletion.manualCompletedAt) {
      try {
        for (const session of deletion.diditSessionIds) {
          const result = await ctx.didit().deleteSession(session, deletion.id);
          if (!result.erasureConfirmed) confirmed = false;
        }
      } catch {
        await q.query("update deletions set next_attempt_at=clock_timestamp()+interval '5 minutes' where id=$1", [id]);
        throw new IdentityError("RemoteDeletionPending", 503);
      }
    }
    if (!confirmed || (deletion.manualReason === "verification_creation_in_flight" && !deletion.manualCompletedAt)) {
      const [row] = await q.query("update deletions set state='manual',manual_reason=coalesce(manual_reason,'provider_erasure_unconfirmed') where id=$1 returning *", [id]);
      return camel<Deletion>(row!);
    }
    return withTx(async tx => {
      if (deletion.accountId) {
        await lockForDeletion(tx, deletion.accountId);
        const [account] = await tx.query<{ email: string }>("select email from accounts where id=$1 and deleting_at is not null", [deletion.accountId]);
        if (account) {
          const registrations = await tx.query<{ id: string; event_id: string }>("select id,event_id from registrations where account_id=$1", [deletion.accountId]);
          // Preserve dedupe keys while removing payloads that could send or restore this person's data.
          await tx.query(`update outbox set payload=null,status='sent',sent_at=coalesce(sent_at,clock_timestamp()),claim_token=null,locked_until=null
            where position($1 in payload::text)>0 or position($2 in payload::text)>0 or dedupe_key like any($3::text[])`, [deletion.accountId, JSON.stringify(account.email).slice(1, -1), registrations.map(r => `%${r.id}%`)]);
          await tx.query("update outbox set payload=null,status='sent',sent_at=coalesce(sent_at,clock_timestamp()),claim_token=null,locked_until=null where payload->>'opId' in (select id::text from verification_ops where account_id=$1)",[deletion.accountId]);
          for (const session of deletion.diditSessionIds) {
            await tx.query("update inbox set raw=null,headers=null,processed_at=coalesce(processed_at,clock_timestamp()) where raw like $1", [`%${session}%`]);
            await tx.query("update scans set candidates='[]'::jsonb where candidates @> $1::jsonb", [JSON.stringify([{ sessionId: session }])]);
          }
          await tx.query("delete from scans where registration_id in(select id from registrations where account_id=$1)", [deletion.accountId]);
          await tx.query("delete from checkins where registration_id in(select id from registrations where account_id=$1)", [deletion.accountId]);
          await tx.query("delete from verification_ops where account_id=$1",[deletion.accountId]);
          await tx.query("delete from evidence where account_id=$1 and kind<>'face'",[deletion.accountId]);
          await tx.query("delete from evidence where account_id=$1", [deletion.accountId]);
          await tx.query("delete from otp_challenges where email=$1", [account.email]);
          await tx.query("update invites set email=null where email=$1 and revoked_at is not null", [account.email]);
          await tx.query("update audit set data='{}'::jsonb where actor=$1 or target=$1 or target=any($2::text[])", [deletion.accountId, registrations.map(r => r.id)]);
          await tx.query("delete from accounts where id=$1", [deletion.accountId]);
          for (const r of registrations) await notifyInTx(tx, `event_${r.event_id}`, { type: "account_purged", event_id: r.event_id });
        }
      }
      const [row] = await tx.query("update deletions set state='complete',email_hash=null,completed_at=clock_timestamp() where id=$1 returning *", [id]);
      return camel<Deletion>(row!);
    }, ctx.db());
  }
  const deletionSession = (cookie: string) => { const token = readToken(cookie, ctx.secret(), "session"); return token ? hash(token) : null; };
  /** The deletion in its grace period that this browser's session asked for, else null (any other session sees nothing). */
  async function pendingDeletion(cookie: string): Promise<PendingDeletion | null> {
    const tokenHash = deletionSession(cookie);
    if (!tokenHash) return null;
    const [row] = await queryable(ctx.db()).query<{ id: string; account_id: string; grace_until: Date }>(`select d.id,d.account_id,d.grace_until from sessions s join deletions d on d.session_id=s.id
      where s.token_hash=$1 and s.principal='guest' and s.revoked_at is null and s.expires_at>clock_timestamp()
        and d.account_id=s.account_id and d.state='pending' and d.grace_until>clock_timestamp()`, [tokenHash]);
    return row ? { deletionId: row.id, accountId: row.account_id, graceUntil: row.grace_until } : null;
  }
  /**
   * "Keep my account": undo a deletion still in its grace period, from the session that asked for it. Puts back the
   * account, its proofs, the invitations sent to it and every registration the deletion cancelled; an approved place
   * whose seat went meanwhile comes back on the waitlist (pending the hosts without one), never over capacity.
   */
  async function keepAccount(cookie: string): Promise<{ accountId: string }> {
    const pending = await pendingDeletion(cookie);
    if (!pending) throw new IdentityError("DeletionNotCancellable", 409);
    return withTx(async tx => {
      // C22 seat-grant order: account -> events (UPDATE, ascending) -> registrations. Restoring an approved place is a seat
      // grant, so its events are locked before anything is counted; concurrent approvals and restorations serialize there.
      await lockAccount(tx, pending.accountId);
      const [deletion] = await tx.query<{ id: string; restore: DeletionRestore | null }>("select id,restore from deletions where id=$1 and account_id=$2 and state='pending' and grace_until>clock_timestamp() for update", [pending.deletionId, pending.accountId]);
      if (!deletion) throw new IdentityError("DeletionNotCancellable", 409);
      const restore = deletion.restore ?? { evidence: [], registrations: [], invites: [] };
      const eventIds = (await tx.query<{ event_id: string }>("select distinct event_id from registrations where id=any($1::uuid[]) and account_id=$2 order by event_id", [restore.registrations.map(r => r.id), pending.accountId])).map(r => r.event_id);
      for (const id of eventIds) await tx.query("select id from events where id=$1 for update", [id]);
      await lockForDeletion(tx, pending.accountId);
      const [account] = await tx.query<{ email: string }>("update accounts set deleting_at=null,updated_at=clock_timestamp() where id=$1 and deleting_at is not null and deleted_at is null returning email", [pending.accountId]);
      if (!account) throw new IdentityError("DeletionNotCancellable", 409);
      for (const e of restore.evidence) await tx.query("update evidence set state=$3::evidence_state,activation=$4,invalidated_at=$5,invalidated_reason=$6,updated_at=clock_timestamp() where id=$1 and account_id=$2", [e.id, pending.accountId, e.state, e.activation, e.invalidatedAt, e.invalidatedReason]);
      // Only the invitations the deletion itself revoked: one the hosts revoked (or an event cancellation) meanwhile stays revoked.
      if (restore.invites.length) await tx.query("update invites set revoked_at=null,revoked_reason=null where id=any($1::uuid[]) and email=$2 and revoked_reason='account_deletion'", [restore.invites, account.email]);
      const events = new Set<string>();
      for (const r of restore.registrations) {
        const [current] = await tx.query<{ event_id: string; capacity: number; waitlist: boolean }>(`select r.event_id,e.capacity,coalesce((e.form->>'waitlist')::boolean,false) waitlist from registrations r join events e on e.id=r.event_id
          where r.id=$1 and r.account_id=$2 and r.admission='cancelled_by_guest' and r.reason='account deleted' for update of r`, [r.id, pending.accountId]);
        if (!current) continue;
        let to = r.admission, reason = r.reason, note = "account kept";
        if (to === "approved") {
          const [seats] = await tx.query<{ n: number }>("select count(*)::int n from registrations where event_id=$1 and admission='approved'", [current.event_id]);
          if ((seats?.n ?? 0) >= current.capacity) {
            // Never over capacity: the place went while the account was set for deletion, so it waits for a seat again.
            to = current.waitlist ? "waitlisted" : "pending";
            reason = note = SEAT_TAKEN_NOTE;
          }
        }
        await tx.query(`update registrations set admission=$2::admission,reason=$3,late_cancellation=$4,updated_at=clock_timestamp(),
          applied_at=case when $2::admission in ('waitlisted','pending') and $5::text<>$2::text then clock_timestamp() else applied_at end where id=$1`, [r.id, to, reason, r.lateCancellation, r.admission]);
        await tx.query(`insert into admission_history(registration_id,"from","to",actor,reason) values($1,'cancelled_by_guest',$2,$3,$4)`, [r.id, to, pending.accountId, note]);
        events.add(current.event_id);
      }
      await tx.query("delete from deletions where id=$1", [deletion.id]);
      await tx.query("insert into audit(actor,action,target) values($1,'account.deletion_cancelled',$1)", [pending.accountId]);
      for (const id of events) await notifyInTx(tx, `event_${id}`, { type: "admission", event_id: id });
      return { accountId: pending.accountId };
    }, ctx.db());
  }
  const service: AccountService = {
    async get(id) { try { return await activeAccount(queryable(ctx.db()), id); } catch (e) { if (e instanceof IdentityError && e.code === "AccountUnavailable") return null; throw e; } },
    updateProfile, requestDeletion, finishDeletion,
  };
  async function savePhoto(principal: GuestPrincipal, bytes: Uint8Array) {
    if(bytes.byteLength>310*1024)throw new IdentityError("InvalidPhoto",400);
    try {const image=sharp(bytes,{limitInputPixels:512*512,animated:true,failOn:"warning"}),meta=await image.metadata();
      if(meta.format!=="jpeg" || meta.width!==512 || meta.height!==512 || (meta.pages??1)!==1)throw new Error();
      bytes=await image.rotate().jpeg({quality:90}).toBuffer();if(bytes.byteLength>300*1024)throw new Error();
    } catch {throw new IdentityError("InvalidPhoto",400);}
    await withTx(async tx => { await lockAccount(tx, principal.accountId); await assertGuest(tx, principal); await tx.query("update accounts set photo=$2,photo_url='/api/me/photo',profile_version=profile_version+1,updated_at=clock_timestamp() where id=$1", [principal.accountId, bytes]); }, ctx.db());
  }
  async function preference(principal: GuestPrincipal, enabled: boolean) {
    await withTx(async tx => { await lockAccount(tx, principal.accountId); await assertGuest(tx, principal); await tx.query("update accounts set marketing_opt_in=$2,updated_at=clock_timestamp() where id=$1", [principal.accountId, enabled]); }, ctx.db());
  }
  async function disconnectGoogle(principal: GuestPrincipal) {
    await withTx(async tx => { await lockAccount(tx, principal.accountId); await assertGuest(tx, principal); await tx.query("delete from account_identities where account_id=$1", [principal.accountId]); await tx.query("update sessions set revoked_at=clock_timestamp() where account_id=$1 and auth_method='oidc_google'", [principal.accountId]); await tx.query("insert into audit(actor,action,target) values($1,'account.google_disconnected',$1)", [principal.accountId]); }, ctx.db());
  }
  async function subscriberCount(): Promise<number> {
    const [row] = await queryable(ctx.db()).query<{ n: number }>("select count(*)::int n from accounts where marketing_opt_in and deleting_at is null and deleted_at is null");
    return row?.n ?? 0;
  }
  return { service, updateProfile, savePhoto, preference, subscriberCount, disconnectGoogle, pendingDeletion, keepAccount, isTombstoned: (input: { email?: string; accountId?: string; diditSessionId?: string }) => tombstoned(queryable(ctx.db()), input) };
}
