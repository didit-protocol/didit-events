import { parseSpendCapUsd } from "../env.ts";
import { staffEmailSql } from "../staff-email.ts";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb, type Db } from "../db/index.ts";
import { advisoryKey, lockAccount, type Tx, type Queryable } from "../db/tx.ts";
import { DiditClient } from "../didit/client.ts";
import type { Account, GuestPrincipal, Staff } from "../domain/services.ts";

export class IdentityError extends Error {
  constructor(readonly code: string, readonly status = 401, readonly attemptsLeft?: number) { super(code); this.name = "IdentityError"; }
}
/** `fullName`/`picture`: the Google profile (via Didit), used only to prefill an empty profile; the URL is never stored. */
export interface OidcClaims { issuer: string; subject: string; email: string; firstName?: string; lastName?: string; fullName?: string; picture?: string }
export interface OidcAdapter {
  authorize(input: { state: string; nonce: string; challenge: string; redirectUri: string }): Promise<string>;
  exchange(input: { code: string; verifier: string; nonce: string; redirectUri: string; principal?: "guest" | "staff" }): Promise<OidcClaims>;
}
/** `fetch`: outbound HTTP for the Google profile picture import (tests pass a fake). */
export interface IdentityOptions { db?: Db; secret?: string; didit?: DiditClient; oidc?: OidcAdapter; appUrl?: string; dailyCapUsd?: number; totalCapUsd?: number; fetch?: typeof fetch }
let oidcAdapter: OidcAdapter | undefined;
export function configureOidc(adapter: OidcAdapter) { oidcAdapter = adapter; }
export function context(options: IdentityOptions) {
  return {
    db: () => options.db ?? getDb(),
    secret: () => { const s = options.secret ?? process.env.SESSION_SECRET; if (!s || s.length < 32) throw new IdentityError("SessionSecretRequired", 503); return s; },
    didit: () => options.didit ?? new DiditClient({ apiKey: process.env.DIDIT_API_KEY ?? "", otpApiKey: process.env.DIDIT_OTP_API_KEY || undefined }),
    fetch: (): typeof fetch => options.fetch ?? fetch,
    oidc: () => { const a = options.oidc ?? oidcAdapter; if (!a) throw new IdentityError("OidcNotConfigured", 503); return a; },
    appUrl: () => { const u = new URL(options.appUrl ?? process.env.APP_URL ?? "http://localhost:3000"); if (u.username || u.password || (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)))) throw new IdentityError("InvalidAppUrl", 503); return u.origin; },
    dailyCap: () => options.dailyCapUsd ?? Number(process.env.DIDIT_APP_DAILY_CAP_USD ?? 300),
    // F1 requires a total ledger scope. Without an explicit total cap, the $300/day
    // application cap remains the limiting policy rather than a lifetime $300 cap.
    totalCap: () => options.totalCapUsd ?? parseSpendCapUsd(process.env.DIDIT_SPEND_CAP_USD),
  };
}
export type IdentityContext = ReturnType<typeof context>;
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");
export const equal = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function emailAddress(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new IdentityError("InvalidEmail", 400);
  return email;
}
export function signToken(token: string, secret: string, purpose: string) { return `${token}.${createHmac("sha256", secret).update(`${purpose}\0${token}`).digest("base64url")}`; }
export function readToken(cookie: string, secret: string, purpose: string): string | null {
  const parts = cookie.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]{43}$/.test(parts[0]!)) return null;
  return equal(signToken(parts[0]!, secret, purpose), cookie) ? parts[0]! : null;
}
export function seal(value: object, secret: string): string {
  const iv = randomBytes(12), key = createHash("sha256").update(`oidc\0${secret}`).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString("base64url");
}
export function unseal(cookie: string, secret: string): unknown {
  try { const b = Buffer.from(cookie, "base64url"); if (b.toString("base64url") !== cookie || b.length < 29 || b.length > 4096) throw new Error(); const d = createDecipheriv("aes-256-gcm", createHash("sha256").update(`oidc\0${secret}`).digest(), b.subarray(0, 12)); d.setAuthTag(b.subarray(-16)); return JSON.parse(Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString()); }
  catch { throw new IdentityError("InvalidOidcState"); }
}
export function camel<T>(row: Record<string, unknown>): T { return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value])) as T; }
export async function tombstoned(q: Queryable, input: { email?: string; accountId?: string; diditSessionId?: string }): Promise<boolean> {
  if (!input.email && !input.accountId && !input.diditSessionId) throw new IdentityError("TombstoneKeyRequired", 400);
  const [row] = await q.query("select id from deletions where (email_hash=$1 and state<>'complete') or account_id=$2::uuid or original_account_id=$2::uuid or didit_session_ids @> $3::jsonb limit 1", [input.email ? hash(emailAddress(input.email)) : null, input.accountId ?? null, JSON.stringify(input.diditSessionId ? [input.diditSessionId] : ["__absent__"])]);
  return !!row;
}
export async function activeAccount(tx: Queryable, id: string): Promise<Account> {
  const [row] = await tx.query("select * from accounts where id=$1 and deleting_at is null and deleted_at is null", [id]);
  if (!row || await tombstoned(tx, { accountId: id, email: row.email as string })) throw new IdentityError("AccountUnavailable");
  return camel<Account>(row);
}
/** Separate identity-key gate precedes all account locks; deletion never acquires this gate. */
export async function identityGate(tx: Tx, key: string) { if (tx.kind === "postgres") await tx.query("select pg_advisory_xact_lock($1::bigint)", [advisoryKey("session", `identity:${key}`)]); }
export async function lockAccounts(tx: Tx, ids: string[]) { for (const id of [...new Set(ids)].sort()) await lockAccount(tx, id); }
/** A principal already resolved by a parallel request remains usable during refresh grace.
 * Explicit revocation still wins because it revokes the successor too. Queries use alias s. */
// authenticated_at is preserved across rotation and is the absolute family start.
// Account sessions derive staff access from the staff table, including legacy rows.
const staffSessionSql = (alias: string) => `(${alias}.principal='staff' or exists (
  select 1 from accounts a join staff t on t.email=a.email
  where a.id=${alias}.account_id and ${staffEmailSql("t.email")}
))`;
export const sessionDeadlineSql = (alias: string) => `${alias}.expires_at>clock_timestamp()
  and ${alias}.last_seen_at>clock_timestamp()-(case when ${staffSessionSql(alias)} then interval '30 days' else interval '90 days' end)
  and ${alias}.authenticated_at>clock_timestamp()-(case when ${staffSessionSql(alias)} then interval '90 days' else interval '400 days' end)`;
export const sessionLiveSql = () => `(s.revoked_at is null and ${sessionDeadlineSql("s")}) or
  (s.rotated_at>clock_timestamp()-interval '30 seconds' and exists (
    select 1 from sessions successor where successor.rotated_from=s.id
      and successor.revoked_at is null and ${sessionDeadlineSql("successor")}
  ))`;
export async function assertGuest(tx: Tx, principal: GuestPrincipal): Promise<Account> {
  const account = await activeAccount(tx, principal.accountId);
  const [session] = await tx.query(`select s.id from sessions s where s.id=$1 and s.account_id=$2 and s.principal='guest' and (${sessionLiveSql()})`, [principal.sessionId, principal.accountId]);
  if (!session) throw new IdentityError("SessionRequired");
  return account;
}
export type Role = Staff["role"];
export const SESSION_TTL_SECONDS = 400 * 86400;
export const STAFF_SESSION_TTL_SECONDS = 90 * 86400;
export const SESSION_ROTATION_SECONDS = 86400;
export const SESSION_GRACE_SECONDS = 30;
export const sessionCsrf = (cookie: string, secret: string) => createHmac("sha256", secret).update(`csrf\0${cookie}`).digest("base64url");
