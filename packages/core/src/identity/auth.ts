import { createHash,randomUUID } from "node:crypto";
import { consume } from "../counters.ts";
import { queryable,withTx,type Tx } from "../db/tx.ts";
import { consentSchema,type ConsentInput } from "../domain/event-model.ts";
import { splitFullName } from "../domain/profile.ts";
import type { GuestPrincipal } from "../domain/services.ts";
import { reserve,settle } from "../spend.ts";
import { enqueueEmail } from "../notifications/email.ts";
import { createModelServices } from "../verification/model-runtime.ts";
import { recordEmailProvenInTx } from "./onboarding.ts";
import { importProfilePicture } from "./picture.ts";
import type { Sessions } from "./sessions.ts";
import { activeAccount,assertGuest,emailAddress,equal,hash,IdentityError,identityGate,lockAccounts,randomToken,seal,tombstoned,unseal,type IdentityContext,type OidcClaims } from "./shared.ts";

/** First/last/full name from the Google claims; a lone full name is split the way the profile form splits it. */
/**
 * "events.owner@didit.me" → "Events Owner": a suggestion for the profile form when the sign-in carried no name
 * (Didit's userinfo has names only for data the user shared, never the plain Google profile). Only a local part made
 * of 2–3 alphabetic words split by . _ - qualifies; "+tags" are ignored; anything else gives null.
 */
export function nameFromEmail(email?: string): string | null {
  const local = (email ?? "").split("@")[0]!.split("+")[0]!;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 3 || !parts.every(p => /^\p{L}{2,}$/u.test(p))) return null;
  return parts.map(p => p[0]!.toLocaleUpperCase() + p.slice(1).toLocaleLowerCase()).join(" ");
}

export function googleNames(claims?: OidcClaims): { firstName: string | null; lastName: string | null; fullName: string | null } {
  const fullName = claims?.fullName ?? ([claims?.firstName, claims?.lastName].filter(Boolean).join(" ") || null) ?? nameFromEmail(claims?.email);
  if (!fullName || claims?.firstName || claims?.lastName) return { firstName: claims?.firstName ?? null, lastName: claims?.lastName ?? null, fullName };
  const split = splitFullName(fullName);
  return { firstName: split.firstName || null, lastName: split.lastName || null, fullName };
}
type OtpPurpose = "login" | "staff_login";
type OtpRow = { id: string; email: string; didit_request_id: string; binding_hash: string; synthetic: boolean; expires_at: Date; attempts: number; sends: number; redeemed_at: Date | null; last_sent_at: Date } & Record<string, unknown>;
export function otpBinding(cookie: string): { id: string; token: string } | null {
  const match = /^([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/.exec(cookie);
  return match ? { id: match[1]!, token: match[2]! } : null;
}
export function authFlows(ctx: IdentityContext, sessions: Sessions) {
  /** `welcome`: a guest sign-up (email code or Google as a guest) queues M-28 when this creates the account. */
  async function guestLogin(tx: Tx, email: string, oldCookie?: string, claims?: OidcClaims, proof?: { method: "didit_otp" | "didit_google"; ref: string; at: Date; consent?: ConsentInput }, welcome = false) {
    await identityGate(tx, email);
    const [hint] = await tx.query<{ id: string }>("select id from accounts where email=$1", [email]);
    // Read old session through this transaction; never nest a PGlite query during a tx.
    const old = oldCookie ? await sessions.previous(oldCookie, tx) : null;
    const id = hint?.id ?? randomUUID();
    await lockAccounts(tx, [id, ...(old?.accountId ? [old.accountId] : [])]);
    if (await tombstoned(tx, { email })) throw new IdentityError("AccountUnavailable");
    if (claims && old?.principal === "guest" && old.accountId && !old.revokedAt && old.expiresAt.getTime() > Date.now()) {
      const current = await activeAccount(tx, old.accountId);
      if (current.email !== email) throw new IdentityError("IdentityLinkConflict", 409);
    }
    // The Google profile fills an empty name (new or existing account); a name the person set is never replaced.
    const names = googleNames(claims);
    if (!hint) await tx.query("insert into accounts(id,email,first_name,last_name,full_name) values($1,$2,$3,$4,$5)", [id, email, names.firstName, names.lastName, names.fullName]);
    await activeAccount(tx, id);
    if (claims) {
      if (hint && names.fullName) await tx.query(`update accounts set first_name=$2,last_name=$3,full_name=$4,profile_version=profile_version+1,updated_at=clock_timestamp()
        where id=$1 and nullif(btrim(full_name),'') is null and nullif(btrim(first_name),'') is null and nullif(btrim(last_name),'') is null`,
        [id, names.firstName, names.lastName, names.fullName]);
      const [identity] = await tx.query<{ account_id: string }>("select account_id from account_identities where issuer=$1 and subject=$2", [claims.issuer, claims.subject]);
      if (identity && identity.account_id !== id) throw new IdentityError("IdentityLinkConflict", 409);
      // The unique issuer/subject constraint is the final arbiter across concurrent emails.
      const inserted = await tx.query("insert into account_identities(account_id,issuer,subject) values($1,$2,$3) on conflict(issuer,subject) do update set subject=excluded.subject where account_identities.account_id=excluded.account_id returning id", [id, claims.issuer, claims.subject]);
      if (!inserted.length) throw new IdentityError("IdentityLinkConflict", 409);
    }
    // Same transaction as the insert: a sign-up that fails later sends nothing. Once per account (dedupe key).
    if (!hint && welcome) await enqueueEmail(tx, { code: "M-28", dedupeKey: `email:M-28:${id}`, accountId: id });
    const result = await sessions.issue(tx, { principal: "guest", accountId: id, authMethod: claims ? "oidc_google" : "email_otp" }, old?.id);
    const principal: GuestPrincipal = { principal: "guest", accountId: id, sessionId: result.session.id, authenticatedAt: result.session.authenticatedAt };
    const face = proof ? await recordEmailProvenInTx(tx, { accountId: id, email, method: proof.method, proofRef: proof.ref, provenAt: proof.at,
      consent: proof.consent === undefined ? undefined : { ...consentSchema.parse(proof.consent), acceptedAt: new Date().toISOString() } }) : { faceOpId: null };
    return { principal, cookie: result.cookie, isNew: !hint, faceOpId: face.faceOpId };
  }
  const sendOtp = (rawEmail: string, sourceIp: string, options: { cookie?: string; resend?: boolean } = {}) => sendChallenge("login", rawEmail, sourceIp, options);
  async function sendStaffOtp(rawEmail: string, sourceIp: string, options: { cookie?: string; resend?: boolean } = {}) {
    const result = await sendChallenge("staff_login", rawEmail, sourceIp, options);
    // Flat event with no address: the synthetic/real split stays server-side only.
    console.info(JSON.stringify({ event: "auth.staff_email_code_requested" }));
    return result;
  }
  async function sendChallenge(purpose: OtpPurpose, rawEmail: string, sourceIp: string, options: { cookie?: string; resend?: boolean } = {}) {
    const email = emailAddress(rawEmail), q = queryable(ctx.db());
    const ipLimit = await consume(`otp:ip:${hash(sourceIp)}`, 20, 3600, ctx.db());
    const emailLimit = await consume(`otp:email:${hash(email)}`, 5, 3600, ctx.db());
    if (!ipLimit.allowed || !emailLimit.allowed) throw new IdentityError("OtpRateLimited", 429);
    const binding = options.cookie ? otpBinding(options.cookie) : null;
    const [old] = binding ? await q.query<OtpRow>("select * from otp_challenges where id=$1 and email=$2 and binding_hash=$3 and purpose=$4", [binding.id, email, hash(binding.token), purpose]) : [];
    if (old && old.expires_at.getTime() > Date.now()) {
      if (old.sends >= 2 || old.attempts >= 3 || old.redeemed_at || Date.now() - old.last_sent_at.getTime() < 30_000) throw new IdentityError("OtpRateLimited", 429);
    }
    const owner = randomUUID();
    const lease = await q.query(`insert into otp_deliveries(email_hash,owner,lease_until) values($1,$2,clock_timestamp()+interval '30 seconds')
      on conflict(email_hash) do update set owner=excluded.owner,lease_until=excluded.lease_until where otp_deliveries.lease_until<clock_timestamp() returning owner`, [hash(email), owner]);
    if (!lease.length) throw new IdentityError("OtpRateLimited", 429);
    try {
      const token = old && !old.redeemed_at ? binding!.token : randomToken();
      async function storeChallenge(requestId: string, synthetic: boolean): Promise<{ challengeId: string; cookie: string; expiresAt: Date }> {
        const id = randomUUID();
        const [row] = await q.query<OtpRow>(`insert into otp_challenges(id,email,didit_request_id,expires_at,ip,binding_hash,synthetic,purpose)
          values($1,$2,$3,clock_timestamp()+interval '5 minutes',$4,$5,$6,$7)
          on conflict(didit_request_id) do update set sends=otp_challenges.sends+1,last_sent_at=clock_timestamp()
          where otp_challenges.binding_hash=excluded.binding_hash and otp_challenges.purpose=excluded.purpose and otp_challenges.redeemed_at is null
            and otp_challenges.sends<2 and otp_challenges.attempts<3 and otp_challenges.expires_at>clock_timestamp() returning *`, [id, email, requestId, sourceIp, hash(token), synthetic, purpose]);
        // A provider retry can belong to another browser. Never transfer its binding;
        // give this browser a nonredeemable challenge with the same wrong-code behavior.
        if (!row) return storeChallenge(randomUUID(), true);
        return { challengeId: row.id, cookie: `${row.id}.${token}`, expiresAt: row.expires_at };
      }
      const syntheticRequestId = () => old?.synthetic && old.expires_at.getTime() > Date.now() && !old.redeemed_at ? old.didit_request_id : randomUUID();
      // Every address consumes both counters and the delivery lease before account-state branching.
      // Synthetic rows share the expiry/attempt machinery but never contact Didit or issue a session.
      // Old staff_login challenges follow the same account availability rules.
      const unavailable = await tombstoned(q, { email }) || (await q.query("select id from accounts where email=$1 and (deleting_at is not null or deleted_at is not null)", [email])).length > 0;
      if (unavailable) {
        return await storeChallenge(syntheticRequestId(), true);
      }
      const reservation = await reserve({ op: "email_send", usdMax: 0.03, scopes: [{ kind: "app/day", id: "events", usdCap: ctx.dailyCap() }, { kind: "total", id: "events", usdCap: ctx.totalCap() }] }, ctx.db());
      let sent;
      try { sent = await ctx.didit().sendEmailOtp({ email, options: { code_size: 6, alphanumeric_code: false } }, reservation); }
      catch (error) { await settle(reservation.id, "uncertain", ctx.db()); throw error; }
      await settle(reservation.id, sent.status === "Success" ? 0.03 : 0, ctx.db());
      return await storeChallenge(sent.status === "Undeliverable" ? syntheticRequestId() : sent.request_id, sent.status === "Undeliverable");
    } finally { await q.query("delete from otp_deliveries where email_hash=$1 and owner=$2", [hash(email), owner]); }
  }
  async function afterProof(result: Awaited<ReturnType<typeof guestLogin>>) {
    const services = createModelServices({ db: ctx.db(), client: ctx.didit(), appUrl: ctx.appUrl(), appDailyCapUsd: ctx.dailyCap(), totalCapUsd: ctx.totalCap() });
    const faceLaunch = await services.onboarding.afterEmailProven(result.principal, result.faceOpId);
    return { ...result, faceLaunch, onboarding: await services.onboarding.getOnboarding(result.principal) };
  }
  const checkOtp = (challengeId: string, code: string, options: { otpCookie: string; previousCookie?: string; email?: string; consent?: ConsentInput }) =>
    redeem("login", challengeId, code, options, (tx, email, ref, at) => guestLogin(tx, email, options.previousCookie, undefined, { method: "didit_otp", ref, at, consent: consentSchema.parse(options.consent) }, true)).then(afterProof);
  async function reproveOtp(principal: GuestPrincipal, challengeId: string, code: string, otpCookie: string) {
    // Resolve the email from the live account, then bind the challenge to it in redeem.
    const account = await activeAccount(queryable(ctx.db()), principal.accountId);
    return redeem("login", challengeId, code, { otpCookie, email: account.email }, async tx => {
      await lockAccounts(tx, [principal.accountId]);
      await assertGuest(tx, principal);
      return sessions.issue(tx, { principal: "guest", accountId: principal.accountId, authMethod: "email_otp" }, principal.sessionId);
    });
  }
  const checkStaffOtp = (challengeId: string, code: string, options: { otpCookie: string; previousCookie?: string; email?: string; consent?: ConsentInput }) =>
    redeem("staff_login", challengeId, code, options, (tx, email, ref, at) => guestLogin(tx, email, options.previousCookie, undefined, { method: "didit_otp", ref, at, consent: consentSchema.parse(options.consent) })).then(afterProof);
  async function redeem<T>(purpose: OtpPurpose, challengeId: string, code: string, options: { otpCookie: string; email?: string }, login: (tx: Tx, email: string, ref: string, at: Date) => Promise<T>): Promise<T> {
    const binding = otpBinding(options.otpCookie), q = queryable(ctx.db());
    if (!binding || binding.id !== challengeId || !/^\d{6}$/.test(code)) throw new IdentityError("OtpWrong", 400, 0);
    const checkToken = randomUUID();
    const [challenge] = await q.query<OtpRow>(`update otp_challenges set attempts=attempts+1,check_token=$3 where id=$1 and binding_hash=$2
      and redeemed_at is null and expires_at>clock_timestamp() and attempts<3 and check_token is null and ($4::text is null or email=$4) and purpose=$5 returning *`, [challengeId, hash(binding.token), checkToken, options.email ? emailAddress(options.email) : null, purpose]);
    if (!challenge) {
      const [row] = await q.query<OtpRow>("select * from otp_challenges where id=$1 and binding_hash=$2 and purpose=$3", [challengeId, hash(binding.token), purpose]);
      throw new IdentityError(row && row.attempts >= 3 ? "OtpLocked" : "OtpExpired", 400);
    }
    try {
      if (challenge.synthetic) throw new IdentityError(challenge.attempts >= 3 ? "OtpLocked" : "OtpWrong", 400, 3 - challenge.attempts);
      const checked = await ctx.didit().checkEmailOtp(challenge.email, code);
      if (checked.status !== "Approved" || checked.request_id !== challenge.didit_request_id || emailAddress(checked.email.email) !== challenge.email) {
        if (checked.status === "Expired or Not Found") throw new IdentityError("OtpExpired", 400);
        throw new IdentityError(challenge.attempts >= 3 ? "OtpLocked" : "OtpWrong", 400, 3 - challenge.attempts);
      }
      return await withTx(async tx => {
        const current = await tx.query("select id from otp_challenges where id=$1 and check_token=$2 and redeemed_at is null and expires_at>clock_timestamp()", [challenge.id, checkToken]);
        if (!current.length) throw new IdentityError("AccountUnavailable");
        const result = await login(tx, challenge.email, challenge.didit_request_id, provenAtOf(checked));
        const consumed = await tx.query(`update otp_challenges set redeemed_at=clock_timestamp(),check_token=null where id=$1 and check_token=$2
          and redeemed_at is null and expires_at>clock_timestamp() returning id`, [challenge.id, checkToken]);
        if (!consumed.length) throw new IdentityError("OtpExpired", 400);
        return result;
      }, ctx.db());
    } finally { await q.query("update otp_challenges set check_token=null where id=$1 and check_token=$2", [challenge.id, checkToken]); }
  }
  async function beginOidc(principal: "staff" | "guest", returnTo: string, previousCookie?: string, consent?: ConsentInput) {
    const state = randomToken(), nonce = randomToken(), verifier = randomToken();
    const data = { state, nonce, verifier, principal, next: returnTo, previousCookie, consent, expires: Date.now() + 300_000 };
    const url = await ctx.oidc().authorize({ state, nonce, challenge: createHash("sha256").update(verifier).digest("base64url"), redirectUri: `${ctx.appUrl()}/api/auth/oidc/callback` });
    await queryable(ctx.db()).query("insert into oidc_transactions(state_hash,expires_at) values($1,clock_timestamp()+interval '5 minutes')", [hash(state)]);
    return { url, cookie: seal(data, ctx.secret()) };
  }
  async function finishOidc(callbackUrl: string, cookie: string) {
    try { return await completeOidc(callbackUrl, cookie); }
    catch (error) {
      const reasons: Record<string, string> = {
        InvalidOidcState: "state_mismatch", OidcCancelled: "authorization_cancelled", InvalidOidcCode: "invalid_code",
        OidcExchangeFailed: "token_exchange_failed", InvalidIdToken: "id_token_invalid", InvalidAccessToken: "access_token_invalid",
        OidcUserinfoFailed: "userinfo_failed", OidcEmailUnverified: "email_unverified", InvalidEmail: "email_unverified",
        StaffForbidden: "not_staff", StaffSessionRequired: "not_staff", IdentityLinkConflict: "identity_link_conflict",
        AccountUnavailable: "account_unavailable", InvalidOidcMetadata: "configuration_error", OidcNotConfigured: "configuration_error",
        OidcClientSecretRequired: "configuration_error", UnsupportedOidcClientAuth: "configuration_error",
      };
      // Only fixed reason codes reach this flat audit event, never error details,
      // callback URLs, authorization codes, email addresses or provider tokens.
      const reason = error instanceof IdentityError ? reasons[error.code] ?? "callback_failed" : "callback_failed";
      console.info(JSON.stringify({ event: "auth.oidc_callback_failed", reason }));
      throw error;
    }
  }
  async function completeOidc(callbackUrl: string, cookie: string) {
    const data = unseal(cookie, ctx.secret()) as { state?: string; nonce?: string; verifier?: string; expires?: number; principal?: string; next?: string; previousCookie?: string; consent?: ConsentInput };
    // Next standalone may use its bind host in req.url; the callback path and state are the trusted binding.
    // Token exchange always uses the configured public APP_URL redirect URI.
    const url = new URL(callbackUrl), state = url.searchParams.get("state");
    if (!data.state || !data.nonce || !data.verifier || !data.expires || data.expires <= Date.now() || !["guest", "staff"].includes(data.principal ?? "") || !state || !equal(state, data.state) || url.pathname !== "/api/auth/oidc/callback" || url.searchParams.getAll("state").length !== 1) throw new IdentityError("InvalidOidcState");
    const used = await queryable(ctx.db()).query("update oidc_transactions set consumed_at=clock_timestamp() where state_hash=$1 and consumed_at is null and expires_at>clock_timestamp() returning state_hash", [hash(state)]);
    if (!used.length) throw new IdentityError("InvalidOidcState");
    // The provider returned an error with a verified state (Didit sends access_denied when the guest cancels Google):
    // carry where they came from so the app can return them to its own sign-in screen, never a raw error page.
    if (url.searchParams.has("error")) throw Object.assign(new IdentityError("OidcCancelled", 400), { next: data.next, cancelled: url.searchParams.get("error") === "access_denied" });
    const code = url.searchParams.get("code");
    if (!code || code.length > 4096 || url.searchParams.getAll("code").length !== 1) throw new IdentityError("InvalidOidcCode");
    const claims = await ctx.oidc().exchange({ code, verifier: data.verifier, nonce: data.nonce, redirectUri: `${ctx.appUrl()}/api/auth/oidc/callback`, principal: data.principal === "staff" ? "staff" : "guest" });
    const email = emailAddress(claims.email);
    const consent = data.consent === undefined ? undefined : consentSchema.parse(data.consent);
    const login = await withTx(tx => guestLogin(tx, email, data.previousCookie, claims, { method: "didit_google", ref: `${claims.issuer}#${claims.subject}`, at: new Date(), consent }, data.principal === "guest"), ctx.db());
    // Outside the login transaction: a slow or failing download never blocks sign-in.
    await importProfilePicture(ctx, login.principal.accountId, claims.picture);
    return { ...await afterProof(login), next: data.next };
  }
  return { sendOtp, checkOtp, reproveOtp, sendStaffOtp, checkStaffOtp, beginOidc, finishOidc, guestLogin };
}

/** When Didit proved the email: its own timestamp when sent, never later than now (clock skew), else now. */
function provenAtOf(checked: { email: { verified_at?: string }; created_at?: string }): Date {
  const now = Date.now(), at = Date.parse(checked.email.verified_at ?? checked.created_at ?? "");
  return new Date(Number.isFinite(at) ? Math.min(at, now) : now);
}
