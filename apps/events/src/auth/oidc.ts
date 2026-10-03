import { isStaffEmail } from "@didit-events/core/staff-email";
import { oidcClientId } from "@didit-events/core/config";
import { createPublicKey, verify as verifySignature } from "node:crypto";
type NodeJwk = { kty?: string; crv?: string; x?: string; y?: string };
import { createLocalJWKSet, createRemoteJWKSet, customFetch, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { IdentityError, type OidcAdapter } from "@didit-events/core/identity";
import { log } from "@didit-events/core/log";

export const DISCOVERY = "https://apx.didit.me/auth/oidc/.well-known/openid-configuration";
const USERINFO = "https://apx.didit.me/auth/v2/users/retrieve/";
const text = (value: unknown, max: number): string | undefined => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
/** The Google profile picture URL, when it is an https URL (anything else is ignored, not an error). */
const pictureUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try { return new URL(value).protocol === "https:" ? value : undefined; } catch { return undefined; }
};
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
function verifiedEmail(user: Record<string, unknown>, identifier: unknown, identifierType: unknown, principal?: "guest" | "staff"): string {
  // _processed_user_data returns approved_data, which may contain email:{email,is_verified}.
  // Retained multi-value data uses emails:[{address,is_primary,is_verified}].
  const single = record(user.email), emails = Array.isArray(user.emails) ? user.emails.map(record).filter(value => value !== undefined) : [];
  const primary = single ? [single] : emails.filter(email => email.is_primary === true);
  const address = (email: Record<string, unknown>) => email.email ?? email.address;
  if (primary.length === 1) {
    const value = address(primary[0]!);
    if (primary[0]!.is_verified === true && typeof value === "string" && value.trim()) return value;
  } else if (primary.length === 0 && identifierType === "email" && typeof identifier === "string" && identifier.trim()) {
    // A verified flag without the matching address never verifies the identifier.
    const matches = emails.filter(email => {
      const value = address(email);
      return typeof value === "string" && value.trim().toLowerCase() === identifier.trim().toLowerCase();
    });
    if (matches.length === 1 && matches[0]!.is_verified === true) return identifier;
  }
  // Guest-only compatibility path: a Google sign-in through Didit can return the login identifier without approved
  // email data. Signed ID tokens still require email_verified=true.
  // Never use an identifier alone for staff, or override explicit email data.
  if (!Object.hasOwn(user, "email") && !Object.hasOwn(user, "emails") && principal !== "staff" &&
    identifierType === "email" && typeof identifier === "string" && identifier.trim() && !isStaffEmail(identifier)) return identifier;
  throw new IdentityError("OidcEmailUnverified");
}
type Metadata = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string; id_token_signing_alg_values_supported: string[]; token_endpoint_auth_methods_supported?: string[]; code_challenge_methods_supported?: string[] };
const PINNED = {
  issuer: "https://auth.didit.me/",
  authorization_endpoint: "https://apx.didit.me/auth/oidc/authorize",
  token_endpoint: "https://apx.didit.me/auth/oidc/token",
  jwks_uri: "https://apx.didit.me/auth/config/jwks",
};
export function createOidcAdapter(options: { fetch?: typeof fetch; discoveryUrl?: string; clientId?: string; clientSecret?: () => string; allowLocalTest?: boolean } = {}): OidcAdapter {
  const discovery = options.discoveryUrl ?? DISCOVERY, transport = options.fetch ?? fetch;
  let metadata: Promise<Metadata> | undefined;
  let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
  const configError = (reason: string, field?: string): never => {
    log("oidc.configuration_error", { reason, field });
    throw new IdentityError("InvalidOidcMetadata", 503);
  };
  async function discover() {
    metadata ??= (async () => {
      const pins = {
        issuer: process.env.DIDIT_OIDC_ISSUER || PINNED.issuer,
        authorization_endpoint: process.env.DIDIT_OIDC_AUTHORIZE_URL || PINNED.authorization_endpoint,
        token_endpoint: process.env.DIDIT_OIDC_TOKEN_URL || PINNED.token_endpoint,
        jwks_uri: process.env.DIDIT_OIDC_JWKS_URL || PINNED.jwks_uri,
      };
      for (const [field, value] of Object.entries(pins)) {
        let url: URL;
        try { url = new URL(value); } catch { return configError("invalid_pin", field); }
        if (url.username || url.password || url.hash || (url.protocol !== "https:" && !(options.allowLocalTest && process.env.NODE_ENV === "test" && url.protocol === "http:" && url.hostname === "127.0.0.1"))) configError("invalid_pin", field);
      }
      let discovered: unknown;
      // Transport/HTTP/JSON failures fall back to C28. A returned configuration is
      // checked outside this catch: discovery must never silently change the pins.
      try {
        const response = await transport(discovery, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (response.ok) discovered = await response.json();
      } catch { /* Discovery is unavailable; use the configured pins. */ }
      let d: Metadata = { ...pins, id_token_signing_alg_values_supported: ["ES256"], token_endpoint_auth_methods_supported: ["client_secret_basic"], code_challenge_methods_supported: ["S256"] };
      if (discovered !== undefined) {
        if (!discovered || typeof discovered !== "object") configError("invalid_discovery");
        const candidate = discovered as Metadata;
        for (const field of Object.keys(pins) as (keyof typeof pins)[]) {
          if (candidate[field] !== pins[field]) configError("discovery_mismatch", field);
        }
        if (!Array.isArray(candidate.id_token_signing_alg_values_supported) || !candidate.id_token_signing_alg_values_supported.includes("ES256") ||
          (candidate.code_challenge_methods_supported !== undefined && (!Array.isArray(candidate.code_challenge_methods_supported) || !candidate.code_challenge_methods_supported.includes("S256"))) ||
          (candidate.token_endpoint_auth_methods_supported !== undefined && !Array.isArray(candidate.token_endpoint_auth_methods_supported))) configError("unsupported_discovery");
        d = candidate;
      }
      jwks = createRemoteJWKSet(new URL(d.jwks_uri), { [customFetch]: transport, timeoutDuration: 8000 });
      return d;
    })().catch(error => { metadata = undefined; throw error; });
    return metadata;
  }
  return {
    async authorize(input) {
      if (!(options.clientId ?? oidcClientId())) throw new IdentityError("OidcClientNotConfigured", 503);
      const d = await discover(), url = new URL(d.authorization_endpoint);
      // Didit's custom claims="read:email" grants permission, not approved email
      // data (see verifiedEmail). Keep the existing scope without that extra grant.
      const params = { client_id: options.clientId ?? oidcClientId(), response_type: "code", redirect_uri: input.redirectUri, scope: "openid email profile", idp: "google", state: input.state, nonce: input.nonce, code_challenge: input.challenge, code_challenge_method: "S256",
        // Didit keeps its own session: without prompt=login a second sign-in (even after Sign out) skips Google silently.
        // prompt=login makes Didit re-run Google, which always shows the account chooser (select_account consent).
        prompt: "login" };
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      return url.href;
    },
    async exchange(input) {
      const d = await discover(), clientId = options.clientId ?? oidcClientId(), secret = options.clientSecret?.() ?? process.env.DIDIT_OIDC_CLIENT_SECRET;
      if (!secret) throw new IdentityError("OidcClientSecretRequired", 503);
      const body = new URLSearchParams({ grant_type: "authorization_code", code: input.code, code_verifier: input.verifier, redirect_uri: input.redirectUri, client_id: clientId });
      const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
      if (!d.token_endpoint_auth_methods_supported || d.token_endpoint_auth_methods_supported.includes("client_secret_basic")) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(secret)}`).toString("base64")}`;
      else if (d.token_endpoint_auth_methods_supported.includes("client_secret_post")) body.set("client_secret", secret);
      else throw new IdentityError("UnsupportedOidcClientAuth", 503);
      let tokens: Record<string, unknown>;
      try {
        const response = await transport(d.token_endpoint, { method: "POST", body, headers, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error();
        const value = record(await response.json());
        if (!value) throw new Error();
        tokens = value;
      } catch { throw new IdentityError("OidcExchangeFailed"); }
      const key: JWTVerifyGetKey = async (header, token) => {
        try { return await jwks!(header, token); }
        catch (error) {
          if (!(error instanceof errors.JWKSNoMatchingKey) || header.kid === undefined) throw error;
          // Didit's EC P-256 keys have no kid, even if the JWT names one. jose
          // still enforces kty/crv, alg, use, key_ops and exactly one matching key.
          const kidless = createLocalJWKSet({ keys: jwks!.jwks()!.keys.filter(key => key.kid === undefined) });
          return kidless({ ...header, kid: undefined });
        }
      };
      // Presence, even a malformed/null value, selects ID-token validation. Never
      // downgrade a failed ID token to an otherwise valid access token.
      if (Object.hasOwn(tokens, "id_token")) {
        if (typeof tokens.id_token !== "string") throw new IdentityError("InvalidIdToken");
        try {
          const { payload } = await jwtVerify(tokens.id_token, key, { issuer: d.issuer, audience: clientId, algorithms: ["ES256"], requiredClaims: ["iss", "sub", "aud", "exp", "iat", "nonce", "email", "email_verified"] });
          if (payload.nonce !== input.nonce || payload.email_verified !== true || typeof payload.email !== "string" || !payload.sub || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) || (payload.azp !== undefined && payload.azp !== clientId)) throw new Error();
          return { issuer: payload.iss!, subject: payload.sub, email: payload.email, firstName: text(payload.given_name, 120), lastName: text(payload.family_name, 120), fullName: text(payload.name, 240), picture: pictureUrl(payload.picture) };
        } catch { throw new IdentityError("InvalidIdToken"); }
      }
      let payload: Record<string, unknown> & { sub?: string; iss?: string };
      try {
        if (typeof tokens.access_token !== "string") throw new Error();
        payload = await verifyDiditAccessToken(tokens.access_token, d.jwks_uri, transport, d.issuer, clientId);
      } catch { throw new IdentityError("InvalidAccessToken"); }
      // Didit access tokens have no nonce. The single-use browser-bound state
      // and PKCE verifier were checked before this exchange (C5).
      let user: Record<string, unknown>;
      try {
        const response = await transport(USERINFO, { method: "GET", headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json" }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error();
        const value = record(await response.json());
        if (!value || value.user_id !== payload.sub) throw new Error();
        user = value;
      } catch { throw new IdentityError("OidcUserinfoFailed"); }
      const email = verifiedEmail(user, payload.identifier, payload.identifier_type, input.principal), names = record(user.names);
      // Return identity attributes only; access/refresh tokens are discarded. The picture URL is only fetched once to
      // import the photo of an account without one; it is never persisted in accounts, sessions or the state cookie.
      return { issuer: payload.iss!, subject: payload.sub!, email, firstName: text(names?.first_name, 120), lastName: text(names?.family_name, 120), fullName: text(names?.full_name, 240), picture: pictureUrl(user.picture) };
    },
  };
}

/** Verifies a Didit access token against the published keys (DER or raw ECDSA signature), then checks claims. */
const jwksCache = new Map<string, { at: number; keys: NodeJwk[] }>();
async function diditKeys(jwksUri: string, transport: typeof fetch): Promise<NodeJwk[]> {
  const hit = jwksCache.get(jwksUri);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.keys;
  const response = await transport(jwksUri, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("jwks_unavailable");
  const body = (await response.json()) as { keys?: unknown };
  const keys = (Array.isArray(body.keys) ? body.keys : []).filter((k): k is NodeJwk => !!k && typeof k === "object" && (k as NodeJwk).kty === "EC")
    .map(k => ({ ...k, crv: k.crv === "secp256r1" ? "P-256" : k.crv }))
    .filter(k => k.crv === "P-256" && typeof k.x === "string" && typeof k.y === "string");
  if (!keys.length) throw new Error("jwks_no_ec_key");
  jwksCache.set(jwksUri, { at: Date.now(), keys });
  return keys;
}
export async function verifyDiditAccessToken(token: string, jwksUri: string, transport: typeof fetch, issuer: string, clientId: string, now = Date.now()) {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error("malformed");
  const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")) as { typ?: unknown };
  if (header.typ !== undefined && header.typ !== "JWT") throw new Error("typ");
  const message = Buffer.from(`${parts[0]}.${parts[1]}`), signature = Buffer.from(parts[2]!, "base64url");
  const keys = await diditKeys(jwksUri, transport);
  const valid = keys.some(jwk => {
    const key = createPublicKey({ key: { kty: "EC", crv: jwk.crv, x: jwk.x, y: jwk.y }, format: "jwk" });
    for (const dsaEncoding of ["der", "ieee-p1363"] as const) {
      try { if (verifySignature("sha256", message, { key, dsaEncoding }, signature)) return true; } catch { /* wrong encoding for this signature */ }
    }
    return false;
  });
  if (!valid) throw new Error("signature");
  const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown> & { sub?: string; iss?: string };
  const seconds = Math.floor(now / 1000);
  if (payload.iss !== issuer || payload.aud !== clientId || payload.client_id !== clientId) throw new Error("claims");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("sub");
  if (typeof payload.exp !== "number" || payload.exp + 60 < seconds) throw new Error("exp");
  if (typeof payload.iat !== "number" || payload.iat > seconds) throw new Error("iat");
  return payload;
}
