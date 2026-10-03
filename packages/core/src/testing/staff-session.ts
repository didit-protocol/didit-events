import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "../db/index.ts";
import { queryable } from "../db/tx.ts";
import type { AuthService, StaffPrincipal } from "../domain/services.ts";
import { sessionLiveSql } from "../identity/shared.ts";
import { PolicyError } from "../http/policy.ts";

/** Test-only signed-cookie adapter for retained legacy staff principals; shares current session lifetime rules. */
export async function testStaffSession(db: Db) {
  const q = queryable(db), secret = randomBytes(32), token = randomBytes(32).toString("base64url");
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const sign = (value: string) => createHmac("sha256", secret).update(value).digest();
  const email = "kiosk-staff@didit.me";
  await q.query("insert into staff(email,role) values($1,'admin')", [email]);
  const [session] = await q.query<{ id: string }>(`insert into sessions(token_hash,principal,auth_method,staff_email,expires_at)
    values($1,'staff','oidc_google',$2,clock_timestamp()+interval '1 day') returning id`, [hash(token), email]);
  const requireStaff: AuthService["requireStaff"] = async (cookie, roles) => {
    const [value, signature, extra] = cookie.split(".");
    const expected = sign(value ?? ""), received = Buffer.from(signature ?? "", "base64url");
    if (!value || extra !== undefined || received.length !== expected.length || !timingSafeEqual(received, expected)) throw new PolicyError(401, "InvalidSession");
    const [row] = await q.query<StaffPrincipal & Record<string, unknown>>(`select s.principal,s.id as "sessionId",f.email,f.role
      from sessions s join staff f on f.email=s.staff_email
      where s.token_hash=$1 and s.principal='staff' and s.auth_method='oidc_google'
      and (${sessionLiveSql()}) and f.disabled_at is null`, [hash(value)]);
    if (!row) throw new PolicyError(401, "InvalidSession");
    if (roles && !roles.includes(row.role)) throw new PolicyError(403, "StaffRequired");
    return row;
  };
  return { cookie: `${token}.${sign(token).toString("base64url")}`, sessionId: session!.id, email, requireStaff };
}
