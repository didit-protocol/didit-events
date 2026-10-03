import { staffEmailSql } from "../staff-email.ts";
import { staffForApiToken } from "./tokens.ts";
export { requireStaffByToken } from "./tokens.ts";
import { createHmac } from "node:crypto";
import { advisoryKey, queryable, withTx, type Tx, type Queryable } from "../db/tx.ts";
import type { GuestPrincipal, Session, SessionService, StaffPrincipal } from "../domain/services.ts";
import { activeAccount, assertGuest, camel, equal, hash, IdentityError, lockAccounts, randomToken, readToken, sessionLiveSql, sessionDeadlineSql, STAFF_SESSION_TTL_SECONDS, SESSION_GRACE_SECONDS, SESSION_ROTATION_SECONDS, SESSION_TTL_SECONDS, sessionCsrf, signToken, type IdentityContext, type Role } from "./shared.ts";

export type StaffAuthMethod = "oidc_google" | "email_otp";
export type LoginPrincipal = { principal: "guest"; accountId: string; authMethod: StaffAuthMethod };

/** Used by request guards and transaction-time staff checks. No role comes from a cookie. */
export async function staffForSession(q: Queryable, sessionId: string) {
  const [row] = await q.query<{ email: string; role: Role; account_id: string | null; authenticated_at: Date }>(`select t.email,t.role,s.account_id,s.authenticated_at
    from sessions s left join accounts a on a.id=s.account_id
    join staff t on t.email=case when s.principal='guest' then a.email else s.staff_email end
    where s.id=$1 and (${sessionLiveSql()})
      and s.auth_method in ('oidc_google','email_otp') and t.disabled_at is null and ${staffEmailSql("t.email")}
      and (s.principal='staff' or (a.deleting_at is null and a.deleted_at is null))`, [sessionId]);
  return row ?? null;
}
export async function accountStaffRole(q: Queryable, accountId: string): Promise<Role | undefined> {
  const [row] = await q.query<{ role: Role }>(`select t.role from accounts a join staff t on t.email=a.email
    where a.id=$1 and a.deleting_at is null and a.deleted_at is null and t.disabled_at is null and ${staffEmailSql("t.email")}`, [accountId]);
  return row?.role;
}

export function sessionServices(ctx: IdentityContext) {
  async function previous(cookie?: string, q: Queryable = queryable(ctx.db())) {
    const token = cookie ? readToken(cookie, ctx.secret(), "session") : null;
    if (!token) return null;
    const [row] = await q.query("select * from sessions where token_hash=$1", [hash(token)]);
    return row ? camel<Session>(row) : null;
  }
  async function familyRoot(tx: Tx, id: string) {
    const [root] = await tx.query<{ id: string }>(`with recursive ancestors as (
      select id,rotated_from from sessions where id=$1 union
      select s.id,s.rotated_from from sessions s join ancestors a on s.id=a.rotated_from
    ) select id from ancestors where rotated_from is null`, [id]);
    const rootId = root?.id ?? id;
    if (tx.kind === "postgres") await tx.query("select pg_advisory_xact_lock($1::bigint)", [advisoryKey("session", rootId)]);
    return rootId;
  }
  async function revokeFamily(tx: Tx, root: string) {
    await tx.query(`with recursive family as (
      select id from sessions where id=$1 union select s.id from sessions s join family f on s.rotated_from=f.id
    ) update sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where id in (select id from family)`, [root]);
  }
  /** Caller holds all account locks (including the old session account), ascending. */
  async function issue(tx: Tx, principal: LoginPrincipal, oldId?: string) {
    await activeAccount(tx, principal.accountId);
    if (oldId) await revokeFamily(tx, await familyRoot(tx, oldId));
    // Reauthentication starts an independent family; refresh alone extends rotated_from.
    const token = randomToken(), cookie = signToken(token, ctx.secret(), "session");
    const ttl = await accountStaffRole(tx, principal.accountId) ? STAFF_SESSION_TTL_SECONDS : SESSION_TTL_SECONDS;
    const [row] = await tx.query(`insert into sessions(token_hash,principal,auth_method,account_id,csrf_token,delivered_at,expires_at)
      values($1,'guest',$2,$3,$4,clock_timestamp(),clock_timestamp()+$5*interval '1 second') returning *`,
    [hash(token), principal.authMethod, principal.accountId, sessionCsrf(cookie, ctx.secret()), ttl]);
    return { session: camel<Session>(row!), cookie };
  }
  const successor = (token: string) => createHmac("sha256", ctx.secret()).update(`session-refresh\0${token}`).digest("base64url");
  async function resolve(cookie: string, refresh: boolean) {
    let token = readToken(cookie, ctx.secret(), "session");
    if (!token) return null;
    return withTx(async tx => {
      const hint = await previous(cookie, tx);
      if (!hint) return null;
      await lockAccounts(tx, hint.accountId ? [hint.accountId] : []);
      const root = await familyRoot(tx, hint.id);
      let currentCookie = cookie;
      let session = await previous(cookie, tx);
      if (!session) return null;
      let replaced = false;
      // A rotated token is evidence even after its original expiry. Keep ancestors until the family expires.
      if (session.rotatedAt) {
        const [grace] = await tx.query("select id from sessions where id=$1 and rotated_at>clock_timestamp()-$2*interval '1 second'", [session.id, SESSION_GRACE_SECONDS]);
        token = successor(token!);
        currentCookie = signToken(token, ctx.secret(), "session");
        const next = await previous(currentCookie, tx);
        if (!next || next.rotatedFrom !== session.id) return null;
        if (!grace) {
          const [child] = await tx.query("select id from sessions where rotated_from=$1 limit 1", [next.id]);
          if (next.deliveredAt || child) { await revokeFamily(tx, root); return null; }
        }
        session = next;
        replaced = true;
      }
      if (session.revokedAt) return null;
      const [live] = await tx.query(`select s.* from sessions s where s.id=$1 and ${sessionDeadlineSql("s")}
        and ((s.principal='guest' and exists(select 1 from accounts a where a.id=s.account_id and a.deleting_at is null and a.deleted_at is null))
          or (s.principal='staff' and s.auth_method in ('oidc_google','email_otp')))`, [session.id]);
      if (!live) return null;
      // Only the presented token proves delivery; recovering its successor does not.
      if (!hint.deliveredAt) {
        const [presented] = await tx.query<{ delivered_at: Date }>("update sessions set delivered_at=clock_timestamp() where id=$1 and delivered_at is null returning delivered_at", [hint.id]);
        if (!replaced && presented) session.deliveredAt = presented.delivered_at;
      }
      const csrf = session.csrfToken ?? sessionCsrf(currentCookie, ctx.secret());
      const [due] = refresh && !replaced && session.principal === "guest" ? await tx.query("select id from sessions where id=$1 and created_at<=clock_timestamp()-$2*interval '1 second'", [session.id, SESSION_ROTATION_SECONDS]) : [];
      if (due) {
        token = successor(token!);
        currentCookie = signToken(token, ctx.secret(), "session");
        await tx.query("update sessions set revoked_at=clock_timestamp(),rotated_at=clock_timestamp() where id=$1", [session.id]);
        const [row] = await tx.query(`insert into sessions(token_hash,principal,auth_method,account_id,rotated_from,authenticated_at,csrf_token,expires_at)
          values($1,'guest',$2,$3,$4,$5,$6,$7) returning *`,
        [hash(token), session.authMethod, session.accountId, session.id, session.authenticatedAt, csrf, session.expiresAt]);
        session = camel<Session>(row!); replaced = true;
      } else {
        // Applies to ordinary resolve() guards too, at most once per hour. The
        // live check above runs first so an idle-expired session cannot revive.
        const [seen] = await tx.query<{ last_seen_at: Date }>(`update sessions set last_seen_at=clock_timestamp()
          where id=$1 and last_seen_at<=clock_timestamp()-interval '1 hour' returning last_seen_at`, [session.id]);
        session.lastSeenAt = seen?.last_seen_at ?? camel<Session>(live).lastSeenAt;
      }
      // Rotation preserves the absolute deadline; successful use alone renews the idle window.
      return { session, ...(replaced ? { cookie: currentCookie } : {}), csrfToken: csrf };
    }, ctx.db());
  }
  const service: SessionService = {
    async rotate(principal, previousSessionId) {
      const [old] = previousSessionId ? await queryable(ctx.db()).query<{ account_id: string | null }>("select account_id from sessions where id=$1", [previousSessionId]) : [];
      return withTx(async tx => {
        await lockAccounts(tx, [principal.accountId, ...(old?.account_id ? [old.account_id] : [])]);
        return issue(tx, principal, previousSessionId);
      }, ctx.db());
    },
    async resolve(cookie) { return (await resolve(cookie, false))?.session ?? null; },
    refresh: cookie => resolve(cookie, true),
    async validCsrf(cookie, token) { const session = await service.resolve(cookie); return !!session?.csrfToken && equal(session.csrfToken, token); },
    async revoke(id) {
      const [hint] = await queryable(ctx.db()).query<{ account_id: string | null }>("select account_id from sessions where id=$1", [id]);
      await withTx(async tx => {
        await lockAccounts(tx, hint?.account_id ? [hint.account_id] : []);
        await revokeFamily(tx, await familyRoot(tx, id));
      }, ctx.db());
    },
    async revokeAll(principal) {
      await withTx(async tx => {
        await lockAccounts(tx, [principal.accountId]);
        const account = await assertGuest(tx, principal);
        await tx.query("update sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where account_id=$1 or staff_email=$2", [account.id, account.email]);
      }, ctx.db());
    },
  };
  async function requireGuest(cookie: string, maxAge?: number): Promise<GuestPrincipal> {
    const session = await service.resolve(cookie);
    if (!session || session.principal !== "guest" || !session.accountId) throw new IdentityError("GuestSessionRequired");
    if (maxAge !== undefined && Date.now() - session.authenticatedAt.getTime() >= maxAge * 1000) throw new IdentityError("FreshAuthenticationRequired");
    return { principal: "guest", accountId: session.accountId, sessionId: session.id, authenticatedAt: session.authenticatedAt };
  }
  async function requireStaff(cookie: string, roles: readonly Role[] = ["owner", "admin", "staff"]): Promise<StaffPrincipal> {
    const session = await service.resolve(cookie);
    if (!session) throw new IdentityError("StaffSessionRequired", 401);
    const staff = await staffForSession(queryable(ctx.db()), session.id);
    if (!staff || !roles.includes(staff.role)) throw new IdentityError("StaffForbidden", 403);
    return { principal: "staff", email: staff.email, role: staff.role, ...(staff.account_id ? { accountId: staff.account_id } : {}), sessionId: session.id, authenticatedAt: session.authenticatedAt };
  }
  return { service, previous, issue, requireGuest, requireStaff };
}
export type Sessions = ReturnType<typeof sessionServices>;

/** Resolve the actual credential type; token IDs never masquerade as browser sessions. */
export async function staffForPrincipal(q: Queryable, actor: StaffPrincipal) {
  return actor.apiTokenId ? staffForApiToken(q, actor.apiTokenId) : staffForSession(q, actor.sessionId);
}
