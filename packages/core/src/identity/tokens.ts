import { staffEmailSql } from "../staff-email.ts";
import { getDb, type Db } from "../db/index.ts";
import { queryable, type Queryable } from "../db/tx.ts";
import type { StaffPrincipal } from "../domain/services.ts";
import { equal, hash, IdentityError, type Role } from "./shared.ts";

export type TokenPrincipal = StaffPrincipal & { apiTokenId: string; tokenName: string; tokenExpiresAt: Date };

/** Also used within service transactions: revocation and staff role changes take effect immediately. */
export async function staffForApiToken(q: Queryable, id: string, lock = false) {
  const [row] = await q.query<{ email: string; role: Role }>(`select s.email,s.role from api_tokens t join staff s on s.email=t.staff_email
    where t.id=$1 and t.revoked_at is null and t.expires_at>clock_timestamp()
      and s.disabled_at is null and ${staffEmailSql("s.email")} ${lock ? 'for share of s,t' : ''}`, [id]);
  return row ?? null;
}

export async function requireStaffByToken(token: string, roles: readonly Role[] = ["owner", "admin", "staff"], db: Db = getDb()): Promise<TokenPrincipal> {
  if (!/^det_[A-Za-z0-9_-]{43}$/.test(token)) throw new IdentityError("InvalidBearerToken", 401);
  const digest = hash(token), q = queryable(db);
  const [row] = await q.query<{ id: string; name: string; token_hash: string; expires_at: Date }>(
    "select id,name,token_hash,expires_at from api_tokens where token_hash=$1 and revoked_at is null and expires_at>clock_timestamp()", [digest]);
  if (!row || !equal(digest, row.token_hash)) throw new IdentityError("InvalidBearerToken", 401);
  const staff = await staffForApiToken(q, row.id);
  if (!staff || !roles.includes(staff.role)) throw new IdentityError("StaffForbidden", 403);
  await q.query("update api_tokens set last_used_at=clock_timestamp() where id=$1", [row.id]);
  return { principal: "staff", email: staff.email, role: staff.role, sessionId: "", apiTokenId: row.id, tokenName: row.name, tokenExpiresAt: row.expires_at };
}
