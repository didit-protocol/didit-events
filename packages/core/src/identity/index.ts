import { isStaffEmail } from "../staff-email.ts";
import { queryable, withTx, type Tx } from "../db/tx.ts";
import { jobHandlers, withJobLock } from "../jobs.ts";
import { workerLoop } from "../workers.ts";
import type { AuthService } from "../domain/services.ts";
import { authFlows } from "./auth.ts";
import { accountServices } from "./accounts.ts";
import { sessionServices } from "./sessions.ts";
import { teamServices } from "./team.ts";
import { context, emailAddress, IdentityError, type IdentityOptions } from "./shared.ts";

/** Dev sign-in is for a developer's own machine only: APP_URL must point at localhost (defence in depth; the route checks too). */
function localAppUrl(): boolean {
  try { const h = new URL(process.env.APP_URL ?? "").hostname; return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]"; } catch { return false; }
}
export { configureOidc, IdentityError, tombstoned, type IdentityOptions, type OidcAdapter } from "./shared.ts";
export { otpBinding } from "./auth.ts";
export { validatePhoto } from "./accounts.ts";

export function createIdentityServices(options: IdentityOptions = {}) {
  const ctx = context(options), sessions = sessionServices(ctx), flows = authFlows(ctx, sessions), accounts = accountServices(ctx), team = teamServices(ctx);
  /** Dev login stands in for the email code a sandbox can't receive: the address counts as proven (callers hold the non-production + DEV_AUTH gate). */
  async function devGuestLogin(tx: Tx, email: string, previousCookie?: string) {
    const result = await flows.guestLogin(tx, email, previousCookie);
    await tx.query(`update accounts set email_verified_at=coalesce(email_verified_at,clock_timestamp()),email_proof_method=coalesce(email_proof_method,'legacy_verified'),
      email_proof_ref=coalesce(email_proof_ref,'dev-login') where id=$1`, [result.principal.accountId]);
    return result;
  }
  const auth: AuthService = { ...flows, ...team, requireGuest: sessions.requireGuest, requireStaff: sessions.requireStaff };
  return { auth, sessions: sessions.service, accounts: accounts.service, profile: accounts, team,
    /** The database these services read (admin guards read event memberships from the same one). */
    db: ctx.db,
    async devLogin(email: string, previousCookie?: string) {
      if (process.env.NODE_ENV === "production" || process.env.DEV_AUTH !== "1" || !localAppUrl()) throw new IdentityError("NotFound", 404);
      return withTx(tx => devGuestLogin(tx, emailAddress(email), previousCookie), ctx.db());
    },
    async devStaffLogin(email: string, previousCookie?: string) {
      if (process.env.NODE_ENV === "production" || process.env.DEV_AUTH !== "1" || !localAppUrl()) throw new IdentityError("NotFound", 404);
      const address = emailAddress(email);
      const [staff] = await queryable(ctx.db()).query<{ role: "owner" | "admin" | "staff" }>("select role from staff where email=$1 and disabled_at is null", [address]);
      if (!staff || !isStaffEmail(address)) throw new IdentityError("StaffForbidden", 403);
      return withTx(tx => devGuestLogin(tx, address, previousCookie), ctx.db());
    },
    async processDeletions() {
      await queryable(ctx.db()).query(`with recursive retained as (
        select id,rotated_from from sessions where expires_at>=clock_timestamp()-interval '1 day'
        union select s.id,s.rotated_from from sessions s join retained r on s.id=r.rotated_from
      ) delete from sessions where id not in (select id from retained)`);
      await queryable(ctx.db()).query("delete from oidc_transactions where expires_at<clock_timestamp()-interval '1 day'");
      await queryable(ctx.db()).query("delete from otp_challenges where expires_at<clock_timestamp()-interval '1 day'");
      await queryable(ctx.db()).query("delete from otp_deliveries where lease_until<clock_timestamp()-interval '1 day'");
      const rows = await queryable(ctx.db()).query<{ id: string }>("select id from deletions where state in ('pending','remote_pending') and next_attempt_at<=clock_timestamp() order by created_at limit 20");
      for (const row of rows) {
        await withJobLock(`identity:delete:${row.id}`, async () => { await accounts.service.finishDeletion(row.id); }, ctx.db());
      }
    },
  };
}
export const identity = createIdentityServices();
export const authService = identity.auth;
export const sessionService = identity.sessions;
export const accountService = identity.accounts;
export const isTombstoned = identity.profile.isTombstoned;
// Dev hot reload re-evaluates this module against the same process-wide registry; register once.
if (!jobHandlers.get("identity:deletions")) jobHandlers.register("identity:deletions", () => identity.processDeletions());
/** B2 session/OTP/OIDC cleanup and deletion retries; also available through the registered scheduler handler. */
export function runIdentityDeletionWorker(signal: AbortSignal) {
  return workerLoop(() => identity.processDeletions(), { signal, intervalMs: 60_000 });
}
