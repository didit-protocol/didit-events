import { isStaffEmail, staffEmailSql } from "../staff-email.ts";
import { queryable, withTx, type Queryable, type Tx } from "../db/tx.ts";
import type { Staff, StaffPrincipal } from "../domain/services.ts";
import { enqueueEmail } from "../notifications/email.ts";
import { camel, emailAddress, identityGate, IdentityError, type IdentityContext, type Role } from "./shared.ts";

import { staffForPrincipal } from "./sessions.ts";

/** A resent team invite waits at least this long after the previous one to the same address. */
export const INVITE_RESEND_COOLDOWN_SEC = 60;
const SIGNED_IN = "exists(select 1 from sessions s where s.staff_email=$1 or s.account_id in (select id from accounts where email=$1))";

/** Queues the T-01 team invite in the caller's transaction. `key` scopes idempotency: one email per invite or resend. */
async function queueInvite(tx: Tx, principal: StaffPrincipal, email: string, role: Role, key: string): Promise<void> {
  const [inviter] = await tx.query<{ first_name: string | null; last_name: string | null }>("select first_name,last_name from accounts where email=$1 and deleted_at is null", [principal.email]);
  const name = [inviter?.first_name, inviter?.last_name].map(part => part?.trim()).filter(Boolean).join(" ");
  await enqueueEmail(tx, { code: "T-01", to: email, dedupeKey: `email:T-01:${email}:${key}`,
    data: { inviteeEmail: email, inviter: { ...(name ? { name } : {}), email: principal.email }, role, adminUrl: "/admin" } });
}

export function teamServices(ctx: IdentityContext) {
  async function actor(tx: Queryable, principal: StaffPrincipal, manage = true): Promise<Role> {
    const row = await staffForPrincipal(tx, principal);
    if (!row || row.email !== principal.email || (manage && !["owner", "admin"].includes(row.role))) throw new IdentityError("StaffForbidden", 403);
    return row.role;
  }
  async function change(principal: StaffPrincipal, rawEmail: string, role?: Role, disable = false, restore = false) {
    const email = emailAddress(rawEmail);
    if (!isStaffEmail(email) || (role && !["owner", "admin", "staff"].includes(role))) throw new IdentityError("InvalidStaff", 400);
    return withTx(async tx => {
      // Serializes owner counts and team changes, then row locks in email order.
      await identityGate(tx, "staff-team");
      await tx.query("select email from staff where email=any($1::text[]) order by email for update", [[email, principal.email]]);
      const actorRole = await actor(tx, principal);
      const [target] = await tx.query<{ role: Role; disabled_at: Date | null }>("select role,disabled_at from staff where email=$1", [email]);
      if (actorRole !== "owner" && (role === "owner" || target?.role === "owner")) throw new IdentityError("OwnerRequired", 403);
      if (target?.role === "owner" && !target.disabled_at && (disable || (role && role !== "owner"))) {
        const [count] = await tx.query<{ n: string }>(`select count(*) as n from staff where role='owner' and disabled_at is null and ${staffEmailSql("email")}`);
        if (Number(count?.n) <= 1) throw new IdentityError("FinalOwner", 409);
      }
      let row;
      if (restore) [row] = await tx.query("update staff set disabled_at=null where email=$1 returning *", [email]);
      else if (disable) [row] = await tx.query("update staff set disabled_at=clock_timestamp() where email=$1 returning *", [email]);
      else [row] = await tx.query("insert into staff(email,role,invited_by) values($1,$2,$3) on conflict(email) do update set role=excluded.role returning *", [email, role, principal.email]);
      if (!row) throw new IdentityError("StaffNotFound", 404);
      // A new address gets the invite email in the same transaction; a role change on an existing row does not.
      if (!target && role) await queueInvite(tx, principal, email, role, `invite:${(row.created_at as Date).getTime()}`);
      // Only legacy staff sessions are revoked. Account sessions retain guest access.
      if (disable || (target && role && target.role !== role)) await tx.query("update sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where staff_email=$1", [email]);
      await tx.query("insert into audit(actor,action,target,data) values($1,$2,$3,$4::jsonb)", [principal.email, disable ? "staff.disabled" : restore ? "staff.restored" : "staff.invited_or_role_changed", email, JSON.stringify({ role })]);
      return camel<Staff>(row);
    }, ctx.db());
  }
  return {
    inviteStaff: (principal: StaffPrincipal, email: string, role: Role) => change(principal, email, role),
    disableStaff: async (principal: StaffPrincipal, email: string) => { await change(principal, email, undefined, true); },
    restoreStaff: async (principal: StaffPrincipal, email: string) => { await change(principal, email, undefined, false, true); },
    /** Sends the invite email again to an active member who has never signed in, at most once a minute. */
    async resendStaffInvite(principal: StaffPrincipal, rawEmail: string): Promise<void> {
      const email = emailAddress(rawEmail);
      await withTx(async tx => {
        await identityGate(tx, "staff-team");
        const actorRole = await actor(tx, principal);
        const [target] = await tx.query<{ role: Role; disabled_at: Date | null; signed_in: boolean }>(`select role,disabled_at,${SIGNED_IN} as signed_in from staff where email=$1`, [email]);
        if (!target || target.disabled_at) throw new IdentityError("StaffNotFound", 404);
        if (actorRole !== "owner" && target.role === "owner") throw new IdentityError("OwnerRequired", 403);
        if (target.signed_in) throw new IdentityError("AlreadySignedIn", 409);
        const [recent] = await tx.query("select 1 from outbox where kind='email:T-01' and payload->>'to'=$1 and created_at>clock_timestamp()-$2 * interval '1 second' limit 1", [email, INVITE_RESEND_COOLDOWN_SEC]);
        if (recent) throw new IdentityError("InviteCooldown", 429);
        const [now] = await tx.query<{ at: Date }>("select clock_timestamp() as at");
        await queueInvite(tx, principal, email, target.role, `resend:${now!.at.getTime()}`);
        await tx.query("insert into audit(actor,action,target,data) values($1,$2,$3,$4::jsonb)", [principal.email, "staff.invite_resent", email, JSON.stringify({ role: target.role })]);
      }, ctx.db());
    },
    async listStaff(principal: StaffPrincipal) { await actor(queryable(ctx.db()), principal, false); return (await queryable(ctx.db()).query("select t.*,exists(select 1 from sessions s where (s.staff_email=t.email or s.account_id in (select id from accounts where email=t.email))) as has_signed_in,(select max(last_seen_at) from sessions s where (s.staff_email=t.email or s.account_id in (select id from accounts where email=t.email))) as last_active_at from staff t order by email")).map(row => camel<Staff & { hasSignedIn: boolean; lastActiveAt: Date | null }>(row)); },
  };
}
