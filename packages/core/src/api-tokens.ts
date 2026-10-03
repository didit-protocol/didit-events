import { isStaffEmail } from "./staff-email.ts";
import { z } from "zod";
import { getDb, type Db } from "./db/index.ts";
import { queryable, withTx, type Queryable } from "./db/tx.ts";
import type { StaffPrincipal } from "./domain/services.ts";
import { staffForPrincipal } from "./identity/sessions.ts";
import { camel, emailAddress, hash, IdentityError, randomToken } from "./identity/shared.ts";

export interface ApiToken { id: string; name: string; staffEmail: string; createdAt: Date; lastUsedAt: Date | null; expiresAt: Date; revokedAt: Date | null }
const fields = "id,name,staff_email,created_at,last_used_at,expires_at,revoked_at";
async function manager(q: Queryable, actor: StaffPrincipal) {
  const staff = await staffForPrincipal(q, actor);
  if (!staff || staff.email !== actor.email || !["owner", "admin"].includes(staff.role)) throw new IdentityError("StaffForbidden", 403);
}
async function issue(q: Queryable, email: string, name: string) {
  const address = emailAddress(email), clean = z.string().trim().min(1).max(100).parse(name);
  const [staff] = await q.query("select email from staff where email=$1 and disabled_at is null", [address]);
  if (!staff || !isStaffEmail(address)) throw new IdentityError("StaffForbidden", 403);
  const token = `det_${randomToken()}`;
  const [row] = await q.query(`insert into api_tokens(name,token_hash,staff_email) values($1,$2,$3) returning ${fields}`, [clean, hash(token), address]);
  await q.query("insert into audit(actor,action,target,data) values($1,'api_token.created',$2,$3::jsonb)", [address, row!.id, JSON.stringify({ name: clean })]);
  return { token, metadata: camel<ApiToken>(row!) };
}
/** Local CLI bootstrap only. Possession of DATABASE_URL is the bootstrap authority. */
export async function bootstrapApiToken(email: string, name: string, db: Db = getDb()) { return withTx(tx => issue(tx, email, name), db); }
export function createApiTokenService(db?: Db) {
  const handle = () => db ?? getDb();
  return {
    async create(actor: StaffPrincipal, name: string) {
      return withTx(async tx => { await manager(tx, actor); return issue(tx, actor.email, name); }, handle());
    },
    async list(actor: StaffPrincipal): Promise<ApiToken[]> {
      const q = queryable(handle()); await manager(q, actor);
      return (await q.query(`select ${fields} from api_tokens where revoked_at is null and expires_at>clock_timestamp() order by created_at desc`)).map(row => camel<ApiToken>(row));
    },
    async revoke(actor: StaffPrincipal, id: string) {
      z.uuid().parse(id);
      await withTx(async tx => {
        await manager(tx, actor);
        const [row] = await tx.query("update api_tokens set revoked_at=clock_timestamp() where id=$1 and revoked_at is null returning id", [id]);
        if (row) await tx.query("insert into audit(actor,action,target) values($1,'api_token.revoked',$2)", [actor.email, id]);
      }, handle());
    },
  };
}
