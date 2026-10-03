import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { DiditClient } from "@didit-events/core/didit/client";
import { fakeDiditServer } from "@didit-events/core/didit/fake-server";
import { createIdentityServices } from "@didit-events/core/identity";
import { testDatabase, resetDatabase } from "@didit-events/core/testing/database";
import { queryable } from "@didit-events/core/db/tx";
import { unseal } from "@didit-events/core/identity/shared";
import type { Db } from "@didit-events/core/db";
import { createOidcAdapter, DISCOVERY } from "./oidc";
let db: Db, close: () => Promise<void>, identity: ReturnType<typeof createIdentityServices>;
const consent = { disclosureVersion: "events-profile-v2", shareProfileWithHosts: true, eventConsentAccepted: false, acceptedChecks: ["face"] } as const;
let fake: Awaited<ReturnType<typeof fakeDiditServer>>;
let appUrl = "https://events.test";
vi.mock("./runtime", () => ({ get identity() { return identity; } }));
let base: string, key: Awaited<ReturnType<typeof generateKeyPair>>, foreignKey: Awaited<ReturnType<typeof generateKeyPair>>, otherCurve: Awaited<ReturnType<typeof generateKeyPair>>;
let current: URL, counts = { token: 0, jwks: 0, discovery: 0 }, overrides: Record<string, unknown> = {}, badSignature = false;
let discoveryStatus = 200, discoveryOverrides: Record<string, unknown> = {}, kidless = false, multipleKeys = false, mixedCurves = false, jwtKid: string | undefined = "fixture";
const userinfoUrl = "https://apx.didit.me/auth/v2/users/retrieve/", subject = "8ef8e25f-c353-4b29-9029-9854ee95aa31";
let tokenMode: "id" | "access" | "both" = "id", tokenStatus = 200, invalidTokenBody = false, extraTokens: Record<string, unknown> = {};
let userinfo: unknown, userinfoStatus = 200, userinfoCalls = 0, userinfoDelay = 0, invalidUserinfoBody = false, accessToken = "", logs: string[] = [];
const fixtureFetch: typeof fetch = (input, init) => fetch(String(input) === userinfoUrl ? `${base}/auth/v2/users/retrieve/` : input, init);
const server = createServer((req, res) => { void (async () => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/auth/v2/users/retrieve/") {
    userinfoCalls++;
    if (req.method !== "GET" || !accessToken || req.headers.authorization !== `Bearer ${accessToken}`) { res.writeHead(401).end("{}"); return; }
    if (userinfoDelay) await new Promise(resolve => setTimeout(resolve, userinfoDelay));
    res.writeHead(userinfoStatus, userinfoStatus === 302 ? { location: `${base}/unexpected-redirect` } : {});
    res.end(invalidUserinfoBody ? "not-json" : JSON.stringify(userinfo)); return;
  }
  if (req.url === "/discovery") { counts.discovery++; res.statusCode = discoveryStatus; res.end(JSON.stringify({ issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, jwks_uri: `${base}/jwks`, id_token_signing_alg_values_supported: ["ES256"], token_endpoint_auth_methods_supported: ["client_secret_basic"], code_challenge_methods_supported: ["S256"], ...discoveryOverrides })); return; }
  if (req.url === "/jwks") { counts.jwks++; res.end(JSON.stringify({ keys: [{ ...await exportJWK(key.publicKey), alg: "ES256", ...(kidless ? {} : { kid: "fixture" }) }, ...(multipleKeys ? [{ ...await exportJWK(foreignKey.publicKey), alg: "ES256" }] : []), ...(mixedCurves ? [await exportJWK(otherCurve.publicKey)] : [])] })); return; }
  if (req.url === "/token") {
    counts.token++;
    if (tokenStatus !== 200 || invalidTokenBody) { res.writeHead(tokenStatus).end(invalidTokenBody ? "not-json" : "{}"); return; }
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = new URLSearchParams(Buffer.concat(chunks).toString());
    if (req.headers.authorization !== `Basic ${Buffer.from("fixture-client:fixture-secret").toString("base64")}` || body.get("redirect_uri") !== `${appUrl}/api/auth/oidc/callback` || createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url") !== current.searchParams.get("code_challenge")) { res.writeHead(400); res.end("{}"); return; }
    const payload = { iss: base, sub: "google-subject", aud: "fixture-client", exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000), nonce: current.searchParams.get("nonce"), email: "ana@example.test", email_verified: true, given_name: "Ana", family_name: "Ruiz", ...overrides };
    const jwt = await new SignJWT(payload).setProtectedHeader({ alg: "ES256", ...(jwtKid ? { kid: jwtKid } : {}) }).sign((badSignature ? foreignKey : key).privateKey);
    // Didit replaces the OIDC body: no nonce or email_verified in this access JWT.
    const accessClaims = { iss: base, sub: subject, aud: "fixture-client", client_id: "fixture-client", exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000), identifier: "ana@example.test", identifier_type: "email", is_staff: false, has_2fa_enabled: false, claims: ["email", "names", "picture"], jti: "fixture-jti", ...overrides };
    accessToken = await new SignJWT(accessClaims).setProtectedHeader({ alg: "ES256", ...(jwtKid ? { kid: jwtKid } : {}) }).sign((badSignature ? foreignKey : key).privateKey);
    res.end(JSON.stringify({ ...(tokenMode !== "access" ? { id_token: jwt } : {}), ...(tokenMode !== "id" ? { access_token: accessToken, refresh_token: "fixture-refresh-never-retained", token_type: "Bearer", expires_in: 300 } : {}), ...extraTokens })); return;
  }
  res.writeHead(404); res.end("{}");
})().catch(() => { res.writeHead(500); res.end("{}"); }); });
beforeAll(async () => {
  ({ db, close } = await testDatabase(process.env.TEST_DATABASE_URL ? "postgres" : "pglite"));
  fake = await fakeDiditServer();
  key = await generateKeyPair("ES256"); foreignKey = await generateKeyPair("ES256"); otherCurve = await generateKeyPair("ES384");
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error();
  base = `http://127.0.0.1:${address.port}`;
}, 60000);
beforeEach(async () => {
  fake.decisions.clear(); fake.calls.length=0;
  await resetDatabase(db); await queryable(db).query("truncate oidc_transactions");
  appUrl = "https://events.test";
  counts = { token: 0, jwks: 0, discovery: 0 }; overrides = {}; badSignature = false;
  discoveryStatus = 200; discoveryOverrides = {}; kidless = false; multipleKeys = false; mixedCurves = false; jwtKid = "fixture";
  tokenMode = "id"; tokenStatus = 200; invalidTokenBody = false; extraTokens = {};
  userinfoStatus = 200; userinfoCalls = 0; userinfoDelay = 0; invalidUserinfoBody = false; accessToken = ""; logs = [];
  // The shape of Didit's userinfo response.
  userinfo = { user_id: subject, email: { email: "ana@example.test", is_verified: true }, names: { first_name: "Ana", family_name: "Ruiz", full_name: "Ana Ruiz", is_verified: true }, picture: "https://images.example.test/ana.jpg" };
  vi.spyOn(console, "info").mockImplementation((line: string) => { logs.push(line); });
  vi.stubEnv("DIDIT_OIDC_ISSUER", base); vi.stubEnv("DIDIT_OIDC_AUTHORIZE_URL", `${base}/authorize`);
  vi.stubEnv("DIDIT_OIDC_TOKEN_URL", `${base}/token`); vi.stubEnv("DIDIT_OIDC_JWKS_URL", `${base}/jwks`);
  identity = createIdentityServices({ db, didit: new DiditClient({apiKey:"fake",fetch:fake.fetch}), secret: "fixture-secret-over-thirty-two-characters", appUrl: "https://events.test", oidc: createOidcAdapter({ fetch: fixtureFetch, discoveryUrl: `${base}/discovery`, clientId: "fixture-client", clientSecret: () => "fixture-secret", allowLocalTest: true }) });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fake?.close(); await close?.(); });
async function begin(as: "guest" | "staff" = "guest", old?: string) {
  const start = await identity.auth.beginOidc(as, "/me/events", old, {...consent, acceptedChecks: ["face"]}); current = new URL(start.url);
  const callback = `https://events.test/api/auth/oidc/callback?state=${current.searchParams.get("state")}&code=fixture`;
  return { ...start, callback };
}
it("uses Google, PKCE S256, nonce and confidential exchange, then keys identity by issuer/subject", async () => {
  const b = await begin();
  expect(current.searchParams.get("idp")).toBe("google"); expect(current.searchParams.get("code_challenge_method")).toBe("S256"); expect(current.searchParams.get("scope")).toBe("openid email profile");
  expect(current.searchParams.has("claims")).toBe(false);
  expect(current.searchParams.get("prompt")).toBe("login"); // Google account chooser on every sign-in
  const result = await identity.auth.finishOidc(b.callback, b.cookie);
  expect(result.principal.principal).toBe("guest");
  expect(await queryable(db).query("select issuer,subject from account_identities")).toEqual([{ issuer: base, subject: "google-subject" }]);
  expect(await queryable(db).query("select principal,auth_method from sessions")).toEqual([{ principal: "guest", auth_method: "oidc_google" }]);
  expect(counts).toEqual({ discovery: 1, token: 1, jwks: 1 });
});
it("reads the Google profile name from the ID token", async () => {
  overrides = { name: "Ana Ruiz Ortega", picture: "http://insecure.example.test/a.jpg" };
  const b = await begin();
  await identity.auth.finishOidc(b.callback, b.cookie);
  expect(await queryable(db).query("select first_name,last_name,full_name,photo_url from accounts")).toEqual([{ first_name: "Ana", last_name: "Ruiz", full_name: "Ana Ruiz Ortega", photo_url: null }]);
});
it("bad state, missing cookie and tampering never exchange a token", async () => {
  const b = await begin();
  for (const [url, cookie] of [[b.callback.replace("state=", "state=bad"), b.cookie], [b.callback, ""], [b.callback, `${b.cookie}x`]]) await expect(identity.auth.finishOidc(url!, cookie!)).rejects.toThrow();
  expect(counts.token).toBe(0); expect(await queryable(db).query("select id from accounts")).toHaveLength(0);
});
it("consumes state atomically before exchange, rejecting replay including simultaneous callbacks", async () => {
  const b = await begin();
  const results = await Promise.allSettled([identity.auth.finishOidc(b.callback, b.cookie), identity.auth.finishOidc(b.callback, b.cookie)]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(counts.token).toBe(1); expect(await queryable(db).query("select id from sessions")).toHaveLength(1);
});
it("expired state is rejected before exchange", async () => {
  const b = await begin(); await queryable(db).query("update oidc_transactions set expires_at=clock_timestamp()-interval '1 second'");
  await expect(identity.auth.finishOidc(b.callback, b.cookie)).rejects.toThrow(); expect(counts.token).toBe(0);
});
it.each([
  ["nonce mismatch", { nonce: "wrong" }], ["wrong audience", { aud: "other-client" }], ["wrong issuer", { iss: "https://evil.test" }],
  ["expired", { exp: 1 }], ["unverified email", { email_verified: false }], ["missing expiry", { exp: undefined }], ["missing subject", { sub: undefined }],
  ["wrong authorized party", { aud: ["fixture-client", "other"], azp: "other" }],
])("rejects %s without changing accounts or sessions", async (_label, claims) => {
  const b = await begin(); overrides = claims;
  await expect(identity.auth.finishOidc(b.callback, b.cookie)).rejects.toMatchObject({ code: "InvalidIdToken" });
  expect(counts.token).toBe(1); expect(await queryable(db).query("select id from accounts")).toHaveLength(0); expect(await queryable(db).query("select id from sessions")).toHaveLength(0);
});
it("rejects a correctly shaped token with a foreign signature", async () => {
  const b = await begin(); badSignature = true;
  await expect(identity.auth.finishOidc(b.callback, b.cookie)).rejects.toThrow(); expect(counts.token).toBe(1); expect(await queryable(db).query("select id from sessions")).toHaveLength(0);
});
it.each(["non-didit", "not-invited", "disabled"])("%s signs in as an account but cannot use staff access", async mode => {
  const b = await begin("staff"); overrides.email = mode === "non-didit" ? "outsider@example.test" : "employee@didit.me";
  if (mode === "disabled") await queryable(db).query("insert into staff(email,disabled_at) values('employee@didit.me',clock_timestamp())");
  const result = await identity.auth.finishOidc(b.callback, b.cookie);
  await expect(identity.auth.requireStaff(result.cookie)).rejects.toMatchObject({ status: 403 });
  expect(await identity.auth.requireGuest(result.cookie)).toBeTruthy(); expect(counts.token).toBe(1);
});
it("active staff obtains one account session through either old OIDC URL", async () => {
  await queryable(db).query("insert into staff(email,role) values('employee@didit.me','admin')");
  let b = await begin("staff"); overrides.email = "employee@didit.me";
  const staff = await identity.auth.finishOidc(b.callback, b.cookie); expect(await identity.auth.requireStaff(staff.cookie)).toMatchObject({ role: "admin" });
  b = await begin("guest"); const guest = await identity.auth.finishOidc(b.callback, b.cookie);
  expect(await identity.auth.requireStaff(guest.cookie)).toMatchObject({ role: "admin" }); expect(counts.token).toBe(2);
});
it("links an existing matching email, rotates sessions, and rejects subject/email or logged-in-account conflicts", async () => {
  const q = queryable(db), [account] = await q.query<{ id: string }>("insert into accounts(email) values('ana@example.test') returning id");
  const old = await identity.sessions.rotate({ principal: "guest", accountId: account!.id, authenticatedAt: new Date(), authMethod: "email_otp" });
  let b = await begin("guest", old.cookie);
  const result = await identity.auth.finishOidc(b.callback, b.cookie);
  expect(await identity.sessions.resolve(old.cookie)).toBeNull(); expect(await q.query("select id from accounts")).toHaveLength(1);
  b = await begin(); overrides.email = "different@example.test";
  await expect(identity.auth.finishOidc(b.callback, b.cookie)).rejects.toMatchObject({ code: "IdentityLinkConflict" });
  b = await begin("guest", result.cookie); overrides.sub = "different-sub";
  await expect(identity.auth.finishOidc(b.callback, b.cookie)).rejects.toMatchObject({ code: "IdentityLinkConflict" });
  expect(await q.query("select id from accounts")).toHaveLength(1); expect(await q.query("select id from sessions where revoked_at is null")).toHaveLength(1); expect(counts.token).toBe(3);
});

it.each([[500, undefined], [500, "provider-key"], [200, undefined]] as const)("discovery %s uses the C28 defaults and verifies ES256 with kidless JWKS (JWT kid %s)", async (status, kid) => {
  for (const name of ["ISSUER", "AUTHORIZE_URL", "TOKEN_URL", "JWKS_URL"]) vi.stubEnv(`DIDIT_OIDC_${name}`, "");
  discoveryStatus = status; kidless = true; jwtKid = kid; overrides.iss = "https://auth.didit.me/";
  discoveryOverrides = { issuer: "https://auth.didit.me/", authorization_endpoint: "https://apx.didit.me/auth/oidc/authorize", token_endpoint: "https://apx.didit.me/auth/oidc/token", jwks_uri: "https://apx.didit.me/auth/config/jwks" };
  const endpoints: Record<string, string> = {
    [DISCOVERY]: "/discovery",
    "https://apx.didit.me/auth/oidc/token": "/token",
    "https://apx.didit.me/auth/config/jwks": "/jwks",
  };
  const requests: string[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = String(input); requests.push(url);
    if (!endpoints[url]) throw new Error("Unexpected OIDC endpoint");
    return fetch(`${base}${endpoints[url]}`, init);
  };
  identity = createIdentityServices({ db, didit: new DiditClient({apiKey:"fake",fetch:fake.fetch}), secret: "fixture-secret-over-thirty-two-characters", appUrl: "https://events.test", oidc: createOidcAdapter({ fetch: transport, clientId: "fixture-client", clientSecret: () => "fixture-secret" }) });
  const b = await begin();
  expect(`${current.origin}${current.pathname}`).toBe("https://apx.didit.me/auth/oidc/authorize");
  expect((await identity.auth.finishOidc(b.callback, b.cookie)).principal.principal).toBe("guest");
  expect(requests).toEqual(Object.keys(endpoints));
  expect(counts).toEqual({ discovery: 1, token: 1, jwks: 1 });
  expect(await queryable(db).query("select issuer,subject from account_identities")).toEqual([{ issuer: "https://auth.didit.me/", subject: "google-subject" }]);
  expect(await queryable(db).query("select principal,auth_method from sessions")).toEqual([{ principal: "guest", auth_method: "oidc_google" }]);
});
it("discovery 500 respects all four configured endpoint overrides", async () => {
  discoveryStatus = 500; kidless = true;
  const b = await begin();
  expect(`${current.origin}${current.pathname}`).toBe(`${base}/authorize`);
  await identity.auth.finishOidc(b.callback, b.cookie);
  expect(counts).toEqual({ discovery: 1, token: 1, jwks: 1 });
  expect(await queryable(db).query("select issuer from account_identities")).toEqual([{ issuer: base }]);
});
it.each(["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"])("discovery %s mismatch fails closed and logs a configuration error", async field => {
  discoveryOverrides[field] = "https://unexpected.test/config";
  const logged = vi.spyOn(console, "info").mockImplementation(() => {});
  await expect(begin()).rejects.toMatchObject({ code: "InvalidOidcMetadata", status: 503 });
  expect(logged).toHaveBeenCalledWith(JSON.stringify({ event: "oidc.configuration_error", fields: { reason: "discovery_mismatch", field } }));
  expect(counts).toEqual({ discovery: 1, token: 0, jwks: 0 });
  expect(await queryable(db).query("select id from accounts")).toHaveLength(0);
  expect(await queryable(db).query("select id from sessions")).toHaveLength(0);
});
it("an ambiguous kidless EC key set is rejected, not tried until one signature passes", async () => {
  kidless = true; multipleKeys = true;
  const b = await begin();
  await expect(identity.auth.finishOidc(b.callback, b.cookie)).rejects.toMatchObject({ code: "InvalidIdToken" });
  expect(counts).toEqual({ discovery: 1, token: 1, jwks: 1 });
  expect(await queryable(db).query("select id from sessions")).toHaveLength(0);
});
it("a nonmatching kid cannot use a keyed JWK", async () => {
  jwtKid = "wrong";
  const b = await begin();
  await expect(identity.auth.finishOidc(b.callback, b.cookie)).rejects.toMatchObject({ code: "InvalidIdToken" });
  expect(counts).toEqual({ discovery: 1, token: 1, jwks: 1 });
  expect(await queryable(db).query("select id from sessions")).toHaveLength(0);
});
it("kidless ES256 selection ignores a key on a different EC curve", async () => {
  kidless = true; mixedCurves = true;
  const b = await begin();
  await identity.auth.finishOidc(b.callback, b.cookie);
  expect(counts).toEqual({ discovery: 1, token: 1, jwks: 1 });
  expect(await queryable(db).query("select id from sessions")).toHaveLength(1);
});
it("network failure during discovery still permits the pinned exchange", async () => {
  const transport: typeof fetch = async (input, init) => {
    if (String(input) === `${base}/discovery`) throw new TypeError("fixture network failure");
    return fetch(input, init);
  };
  identity = createIdentityServices({ db, didit: new DiditClient({apiKey:"fake",fetch:fake.fetch}), secret: "fixture-secret-over-thirty-two-characters", appUrl: "https://events.test", oidc: createOidcAdapter({ fetch: transport, discoveryUrl: `${base}/discovery`, clientId: "fixture-client", clientSecret: () => "fixture-secret", allowLocalTest: true }) });
  const b = await begin();
  await identity.auth.finishOidc(b.callback, b.cookie);
  expect(counts).toEqual({ discovery: 0, token: 1, jwks: 1 });
  expect(await queryable(db).query("select id from sessions")).toHaveLength(1);
});

it("standalone bind-host callback succeeds on the public APP_URL with one verified token exchange", async () => {
  appUrl = "https://events.didit.me";
  vi.stubEnv("APP_URL", appUrl); vi.stubEnv("SESSION_SECRET", "fixture-secret-over-thirty-two-characters");
  identity = createIdentityServices({ db, didit: new DiditClient({apiKey:"fake",fetch:fake.fetch}), secret: "fixture-secret-over-thirty-two-characters", appUrl, oidc: createOidcAdapter({ discoveryUrl: `${base}/discovery`, clientId: "fixture-client", clientSecret: () => "fixture-secret", allowLocalTest: true }) });
  await queryable(db).query("insert into staff(email,role) values('employee@didit.me','admin')");
  const b = await begin("staff"); overrides.email = "employee@didit.me";
  const { GET } = await import("../../app/api/auth/oidc/callback/route");
  const callback = new URL(b.callback); callback.protocol = "http:"; callback.host = "0.0.0.0:3000";
  const response = await GET(new Request(callback, { headers: { cookie: `__Host-oidc=${b.cookie}`, "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } }));
  expect(response.status).toBe(307); expect(response.headers.get("location")).toBe(`${appUrl}/onboarding?returnTo=%2Fme%2Fevents`);
  expect(response.headers.get("set-cookie")).toContain("__Host-sid=");
  expect(counts).toEqual({ discovery: 1, token: 1, jwks: 1 });
  expect(await queryable(db).query("select principal,auth_method,staff_email from sessions")).toEqual([{ principal: "guest", auth_method: "oidc_google", staff_email: null }]);
  expect(await queryable(db).query("select state_hash from oidc_transactions where consumed_at is not null")).toHaveLength(1);
});
it("callback still rejects incorrect paths and duplicate state/code before exchange", async () => {
  const b = await begin();
  for (const callback of [b.callback.replace("/callback", "/wrong"), `${b.callback}&state=${current.searchParams.get("state")}`, `${b.callback}&code=another`]) {
    await expect(identity.auth.finishOidc(callback, b.cookie)).rejects.toThrow();
  }
  expect(counts.token).toBe(0); expect(await queryable(db).query("select id from sessions")).toHaveLength(0);
});
it("cross-site staff document navigation redirects to the pinned Didit authorize endpoint", async () => {
  for (const name of ["ISSUER", "AUTHORIZE_URL", "TOKEN_URL", "JWKS_URL"]) vi.stubEnv(`DIDIT_OIDC_${name}`, "");
  vi.stubEnv("APP_URL", appUrl);
  discoveryStatus = 500;
  const transport: typeof fetch = (input, init) => {
    if (String(input) !== DISCOVERY) throw new Error("Unexpected external request");
    return fetch(`${base}/discovery`, init);
  };
  identity = createIdentityServices({ db, didit: new DiditClient({apiKey:"fake",fetch:fake.fetch}), secret: "fixture-secret-over-thirty-two-characters", appUrl, oidc: createOidcAdapter({ fetch: transport, clientId: "fixture-client", clientSecret: () => "fixture-secret" }) });
  const { GET } = await import("../../app/api/auth/oidc/start/route");
  const response = await GET(new Request(`${appUrl}/api/auth/oidc/start?as=staff&next=/admin/team&consent=${encodeURIComponent(JSON.stringify(consent))}`, { headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", origin: "https://external.test" } }));
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location")!);
  expect(location.origin + location.pathname).toBe("https://apx.didit.me/auth/oidc/authorize");
  expect(location.searchParams.get("redirect_uri")).toBe(`${appUrl}/api/auth/oidc/callback`);
  expect(response.headers.get("set-cookie")).toMatch(/__Host-oidc=.*Secure.*HttpOnly.*SameSite=lax/i);
  expect(await queryable(db).query("select state_hash from oidc_transactions where consumed_at is null")).toHaveLength(1);
  expect(await queryable(db).query("select id from sessions")).toHaveLength(0);
  expect(counts).toEqual({ discovery: 1, token: 0, jwks: 0 });
});
it.each([
  ["same-origin", undefined, false],
  ["cross-site", JSON.stringify(consent), false],
  ["same-site", JSON.stringify(consent), false],
  [undefined, JSON.stringify(consent), false],
  ["cross-site", "invalid-json", false],
  ["same-origin", JSON.stringify(consent), true],
] as const)("OIDC navigation from %s with consent %s records consent only when trusted", async (site, raw, accepted) => {
  const { GET } = await import("../../app/api/auth/oidc/start/route");
  const url = new URL(`${appUrl}/api/auth/oidc/start?as=staff&next=/admin/team`);
  if (raw !== undefined) url.searchParams.set("consent", raw);
  const response = await GET(new Request(url, { headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", ...(site ? {"sec-fetch-site":site} : {}) } }));
  expect(response.status).toBe(302);
  current = new URL(response.headers.get("location")!);
  expect(current.origin + current.pathname).toBe(`${base}/authorize`);
  const cookie = response.headers.get("set-cookie")!.match(/__Host-oidc=([^;]+)/)![1]!;
  expect(unseal(cookie, "fixture-secret-over-thirty-two-characters")).toMatchObject({principal:"staff",next:"/admin/team"});
  const result = await identity.auth.finishOidc(`${appUrl}/api/auth/oidc/callback?state=${current.searchParams.get("state")}&code=fixture`, cookie);
  expect(result.onboarding.email.verified).toBe(true);
  const ops = await queryable(db).query("select consent from verification_ops where account_id=$1", [result.principal.accountId]);
  if (accepted) {
    expect(ops).toEqual([{consent:{...consent,acceptedAt:expect.any(String)}}]);
    expect(fake.count("POST","/v3/session/")).toBe(1);
  } else {
    expect(result).toMatchObject({faceOpId:null,faceLaunch:{state:"not_needed"}});
    expect(ops).toEqual([]); expect(fake.count("POST","/v3/session/")).toBe(0);
    expect(await queryable(db).query("select id from outbox where kind='verification.create'")).toEqual([]);
  }
});
it.each(["x".repeat(2049), "é".repeat(1025)])("caps OIDC consent at 2 KB before creating state", async raw => {
  const { GET } = await import("../../app/api/auth/oidc/start/route");
  const response = await GET(new Request(`${appUrl}/api/auth/oidc/start?consent=${encodeURIComponent(raw)}`, {headers:{"sec-fetch-site":"same-origin","sec-fetch-mode":"navigate","sec-fetch-dest":"document"}}));
  expect(response.status).toBe(413);
  expect(counts.discovery).toBe(0);
  expect(await queryable(db).query("select state_hash from oidc_transactions")).toEqual([]);
});
it("rejects malformed same-origin consent before creating state", async () => {
  const { GET } = await import("../../app/api/auth/oidc/start/route");
  const response = await GET(new Request(`${appUrl}/api/auth/oidc/start?consent=invalid`, {headers:{"sec-fetch-site":"same-origin","sec-fetch-mode":"navigate","sec-fetch-dest":"document"}}));
  expect(response.status).toBe(422);
  expect(await queryable(db).query("select state_hash from oidc_transactions")).toEqual([]);
});
it.each(["cors", "no-cors", "same-origin"])("cross-site %s fetch cannot start OIDC", async mode => {
  const { GET } = await import("../../app/api/auth/oidc/start/route");
  const response = await GET(new Request(`${appUrl}/api/auth/oidc/start?as=staff`, { headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": mode, "sec-fetch-dest": "empty" } }));
  expect(response.status).toBe(403); expect(response.headers.get("set-cookie")).toBeNull();
  expect(await queryable(db).query("select state_hash from oidc_transactions")).toHaveLength(0);
  expect(counts).toEqual({ discovery: 0, token: 0, jwks: 0 });
});
it.each(["POST", "PUT", "DELETE"])("OIDC start rejects %s even with document navigation headers", async method => {
  const { GET } = await import("../../app/api/auth/oidc/start/route");
  const response = await GET(new Request(`${appUrl}/api/auth/oidc/start?as=staff`, { method, headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } }));
  expect(response.status).toBe(403); expect(counts.discovery).toBe(0);
  expect(await queryable(db).query("select state_hash from oidc_transactions")).toHaveLength(0);
});
const X_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/11.14";
const SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const navigation = (ua: string) => ({ headers: { "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "user-agent": ua } });
it.each([
  ["?idp=google&next=%2Fe%2Fai-era%3Fjoin%3D1", "/login?error=inapp&next=%2Fe%2Fai-era%3Fjoin%3D1"],
  ["?as=staff&next=/admin/team", "/login?error=inapp&next=%2Fadmin%2Fteam"],
  ["?idp=google&next=https://evil.test/x", "/login?error=inapp"],
  ["?idp=google&force=0", "/login?error=inapp"],
])("OIDC start inside an in-app browser (%s) returns to the sign-in guidance without creating state", async (query, back) => {
  vi.stubEnv("APP_URL", appUrl);
  const { GET } = await import("../../app/api/auth/oidc/start/route");
  const response = await GET(new Request(`${appUrl}/api/auth/oidc/start${query}`, navigation(X_IOS)));
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(`${appUrl}${back}`);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await queryable(db).query("select state_hash from oidc_transactions")).toHaveLength(0);
  expect(counts.discovery).toBe(0);
});
it.each([
  ["an in-app browser with force=1", X_IOS, "&force=1"],
  ["Safari", SAFARI_IOS, ""],
])("OIDC start proceeds to Didit sign-in from %s", async (_name, ua, force) => {
  vi.stubEnv("APP_URL", appUrl);
  const { GET } = await import("../../app/api/auth/oidc/start/route");
  const response = await GET(new Request(`${appUrl}/api/auth/oidc/start?as=staff&next=/admin/team${force}`, navigation(ua)));
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location")!);
  expect(location.origin + location.pathname).toBe(`${base}/authorize`);
  expect(response.headers.get("set-cookie")).toMatch(/__Host-oidc=/);
  expect(await queryable(db).query("select state_hash from oidc_transactions where consumed_at is null")).toHaveLength(1);
});
it("an in-app browser still cannot start OIDC with a fetch (the navigation policy runs first)", async () => {
  vi.stubEnv("APP_URL", appUrl);
  const { GET } = await import("../../app/api/auth/oidc/start/route");
  const response = await GET(new Request(`${appUrl}/api/auth/oidc/start?as=staff`, { headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty", "user-agent": X_IOS } }));
  expect(response.status).toBe(403);
});
it("OIDC can create a new account for the same verified identity after deletion completes", async () => {
  const b = await begin(), old = await identity.auth.finishOidc(b.callback, b.cookie);
  if (old.principal.principal !== "guest") throw new Error("Guest required");
  await identity.profile.updateProfile(old.principal, { firstName: "Private", lastName: "Old", bio: "old biography" });
  const deletion = await identity.accounts.requestDeletion(old.principal);
  const pending = await begin();
  await expect(identity.auth.finishOidc(pending.callback, pending.cookie)).rejects.toMatchObject({ code: "AccountUnavailable" });
  expect(old.faceLaunch.state).toBe("ready");
  expect(await identity.accounts.finishDeletion(deletion.id)).toMatchObject({state:"complete"});
  const next = await begin("guest", old.cookie), fresh = await identity.auth.finishOidc(next.callback, next.cookie);
  if (fresh.principal.principal !== "guest") throw new Error("Guest required");
  expect(fresh.principal.accountId).not.toBe(old.principal.accountId);
  expect(await identity.accounts.get(fresh.principal.accountId)).toMatchObject({ firstName: "Ana", lastName: "Ruiz", bio: null });
  expect(await queryable(db).query("select account_id,issuer,subject from account_identities")).toEqual([{ account_id: fresh.principal.accountId, issuer: base, subject: "google-subject" }]);
  expect(await identity.sessions.resolve(old.cookie)).toBeNull();
  expect(await identity.profile.isTombstoned({ accountId: old.principal.accountId })).toBe(true);
  expect(await identity.profile.isTombstoned({ email: "ana@example.test" })).toBe(false);
  expect(counts.token).toBe(3);
});

describe("Didit access-token response without id_token", () => {
  beforeEach(() => { tokenMode = "access"; kidless = true; jwtKid = undefined; });
  async function rejected(code: string, reason: string, as: "guest" | "staff" = "guest") {
    const b = await begin(as);
    await expect(identity.auth.finishOidc(b.callback, b.cookie)).rejects.toMatchObject({ code });
    expect(logs).toEqual([JSON.stringify({ event: "auth.oidc_callback_failed", reason })]);
    expect(await queryable(db).query("select id from sessions")).toHaveLength(0);
    expect(await queryable(db).query("select id from accounts")).toHaveLength(0);
    expect(await queryable(db).query("select id from account_identities")).toHaveLength(0);
    return b;
  }
  it("creates a guest from the verified primary email and names, retaining only issuer/sub identity", async () => {
    overrides.identifier = "other@example.test";
    const b = await begin(), result = await identity.auth.finishOidc(b.callback, b.cookie), q = queryable(db);
    expect(result.principal.principal).toBe("guest");
    // The picture is on no Google host, so nothing is fetched and no URL is stored.
    expect(await q.query("select email,first_name,last_name,full_name,photo_url from accounts")).toEqual([{ email: "ana@example.test", first_name: "Ana", last_name: "Ruiz", full_name: "Ana Ruiz", photo_url: null }]);
    expect(await q.query("select issuer,subject from account_identities")).toEqual([{ issuer: base, subject }]);
    expect(userinfoCalls).toBe(1); expect(counts).toEqual({ discovery: 1, token: 1, jwks: 1 }); expect(logs).toEqual([]);
    const stored = JSON.stringify([await q.query("select * from accounts"), await q.query("select * from account_identities"), await q.query("select * from sessions"), await q.query("select * from oidc_transactions"), b.cookie, result]);
    expect(stored).not.toContain(accessToken); expect(stored).not.toContain("fixture-refresh-never-retained");
  });
  it("issues staff sessions only through the active local staff row, independently of the JWT is_staff flag", async () => {
    userinfo = { user_id: subject, email: { email: "employee@didit.me", is_verified: true } };
    await queryable(db).query("insert into staff(email,role) values('employee@didit.me','admin')");
    let b = await begin("staff");
    const staff = await identity.auth.finishOidc(b.callback, b.cookie);
    expect(await identity.auth.requireStaff(staff.cookie)).toMatchObject({ email: "employee@didit.me", role: "admin" });
    b = await begin("guest");
    const guest = await identity.auth.finishOidc(b.callback, b.cookie);
    expect(await identity.auth.requireStaff(guest.cookie)).toMatchObject({ role: "admin" });
    expect(userinfoCalls).toBe(2); expect(logs).toEqual([]);
  });
  it.each([
    ["wrong aud", { aud: "another-client" }], ["multiple aud", { aud: ["fixture-client", "other"] }],
    ["wrong iss", { iss: "https://unexpected.test/" }], ["expired", { exp: 1 }],
    ["wrong client_id", { client_id: "other-client" }], ["missing client_id", { client_id: undefined }],
    ["missing sub", { sub: undefined }], ["empty sub", { sub: "" }], ["missing exp", { exp: undefined }],
    ["missing iat", { iat: undefined }], ["string iat", { iat: "1" }], ["future iat", { iat: 9999999999 }],
  ])("rejects %s before retrieving user data", async (_label, claims) => {
    overrides = claims; await rejected("InvalidAccessToken", "access_token_invalid"); expect(userinfoCalls).toBe(0);
  });
  it("rejects a foreign signature before retrieving user data", async () => {
    badSignature = true; await rejected("InvalidAccessToken", "access_token_invalid"); expect(userinfoCalls).toBe(0);
  });
  it.each([undefined, null, "opaque-provider-token", ""])("rejects missing or malformed access token %s", async token => {
    extraTokens.access_token = token; await rejected("InvalidAccessToken", "access_token_invalid"); expect(userinfoCalls).toBe(0);
  });
  it("allows at most 60 seconds of expiry skew and rejects future iat without skew", async () => {
    overrides.exp = Math.floor(Date.now() / 1000) - 30;
    let b = await begin(); await identity.auth.finishOidc(b.callback, b.cookie);
    overrides.exp = Math.floor(Date.now() / 1000) - 61;
    b = await begin(); await expect(identity.auth.finishOidc(b.callback, b.cookie)).rejects.toMatchObject({ code: "InvalidAccessToken" });
    overrides.exp = Math.floor(Date.now() / 1000) + 300; overrides.iat = Math.floor(Date.now() / 1000) + 30;
    b = await begin(); await expect(identity.auth.finishOidc(b.callback, b.cookie)).rejects.toMatchObject({ code: "InvalidAccessToken" });
    expect(userinfoCalls).toBe(1);
  });
  it("selects the kidless P-256 key among other curves", async () => {
    mixedCurves = true; jwtKid = "didit-key";
    const b = await begin(); await identity.auth.finishOidc(b.callback, b.cookie); expect(userinfoCalls).toBe(1);
  });
  it("tries every published kidless P-256 key (key rotation): accepts when one of them verifies", async () => {
    // Didit publishes kid-less EC keys: we must try each key.
    multipleKeys = true;
    const b = await begin(); await identity.auth.finishOidc(b.callback, b.cookie); expect(userinfoCalls).toBe(1);
  });
  it.each([401, 500, 302])("fails closed on users/retrieve HTTP %s (including redirects)", async status => {
    userinfoStatus = status; await rejected("OidcUserinfoFailed", "userinfo_failed"); expect(userinfoCalls).toBe(1);
  });
  it("fails closed on invalid users/retrieve JSON", async () => {
    invalidUserinfoBody = true; await rejected("OidcUserinfoFailed", "userinfo_failed");
  });
  it.each([null, [], {}, { user_id: "other-user", email: { email: "ana@example.test", is_verified: true } }])("rejects malformed or wrong-subject user data %j", async value => {
    userinfo = value; await rejected("OidcUserinfoFailed", "userinfo_failed");
  });
  it("bounds users/retrieve to 10 seconds and consumes state even on timeout", async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const timer = vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => timeout(ms === 10000 ? 100 : ms));
    userinfoDelay = 250;
    const b = await rejected("OidcUserinfoFailed", "userinfo_failed");
    expect(timer).toHaveBeenCalledWith(10000);
    await expect(identity.auth.finishOidc(b.callback, b.cookie)).rejects.toMatchObject({ code: "InvalidOidcState" });
    expect(counts.token).toBe(1);
  });
  it.each([
    { email: { email: "ana@example.test", is_verified: false } },
    { email: { email: "ana@example.test", is_verified: "true" } },
    { email: { email: "ana@example.test" } }, { email: { is_verified: true } },
    { email: "ana@example.test", email_verified: true },
    { email: { email: "ana@example.test", is_verified: false }, emails: [{ address: "ana@example.test", is_verified: true }] },
    { emails: [{ address: "other@example.test", is_verified: true }] },
    { emails: [{ address: "ana@example.test", is_primary: true, is_verified: false }] },
    { emails: [{ address: "ana@example.test", is_primary: true, is_verified: true }, { address: "other@example.test", is_primary: true, is_verified: true }] },
  ])("requires the selected email to be explicitly verified: %j", async fields => {
    userinfo = { user_id: subject, ...fields }; await rejected("OidcEmailUnverified", "email_unverified");
  });
  it.each([
    { email: { address: "ana@example.test", is_verified: true } },
    { emails: [{ address: "other@example.test", is_verified: true }, { address: "ana@example.test", is_primary: true, is_verified: true }] },
    { emails: [{ address: "ana@example.test", is_primary: false, is_verified: true }] },
  ])("accepts a verified primary or explicitly confirmed email identifier: %j", async fields => {
    userinfo = { user_id: subject, ...fields };
    const b = await begin(); await identity.auth.finishOidc(b.callback, b.cookie);
    expect(await queryable(db).query("select email from accounts")).toEqual([{ email: "ana@example.test" }]);
  });
  it.each([
    ["staff", "ana@example.test"],
    ["guest", "owner@didit.me"], ["staff", "owner@didit.me"],
    ["guest", " Owner@DIDIT.ME "],
  ] as const)("refuses identifier-only %s login for %s even with an idp hint", async (as, email) => {
    userinfo = { user_id: subject }; overrides.identifier = email; overrides.idp = "google";
    const b = await begin(as);
    await expect(identity.auth.finishOidc(b.callback, b.cookie)).rejects.toMatchObject({ code: "OidcEmailUnverified" });
    expect(await queryable(db).query("select id from accounts")).toHaveLength(0);
    expect(await queryable(db).query("select id from sessions")).toHaveLength(0);
  });
  it.each(["google", "apple"])("preserves identifier-only %s guest sign-in with the server's empty approved_data shape", async provider => {
    // approved_data defaults to {}; retrieve adds user_id. Granting read:email alone does not populate it.
    userinfo = { user_id: subject }; overrides.identifier = "ana@example.test"; overrides.idp = provider;
    const b = await begin("guest"), result = await identity.auth.finishOidc(b.callback, b.cookie);
    await expect(identity.auth.requireGuest(result.cookie)).resolves.toHaveProperty("accountId");
    await expect(identity.auth.requireStaff(result.cookie)).rejects.toMatchObject({ status: 403 });
    expect(await queryable(db).query("select email from accounts")).toEqual([{ email: "ana@example.test" }]);
  });
  it.each(["google", "apple"])("keeps verified %s email sign-in working", async provider => {
    overrides.idp = provider;
    userinfo = { user_id: subject, email: { email: "ana@example.test", is_verified: true } };
    const b = await begin();
    await expect(identity.auth.finishOidc(b.callback, b.cookie)).resolves.toHaveProperty("cookie");
  });
  it("does not fall back to the identifier when it is not an email", async () => {
    overrides.identifier_type = "phone"; userinfo = { user_id: subject };
    await rejected("OidcEmailUnverified", "email_unverified");
  });
  it("cannot fall back to a non-email identifier even when an email entry matches", async () => {
    overrides.identifier_type = "phone"; userinfo = { user_id: subject, emails: [{ address: "ana@example.test", is_verified: true }] };
    await rejected("OidcEmailUnverified", "email_unverified");
  });
  it.each(["non-didit", "missing", "disabled"])("rejects %s staff even if the JWT says is_staff", async mode => {
    overrides.is_staff = true;
    userinfo = { user_id: subject, email: { email: mode === "non-didit" ? "ana@example.test" : "employee@didit.me", is_verified: true } };
    if (mode === "disabled") await queryable(db).query("insert into staff(email,disabled_at) values('employee@didit.me',clock_timestamp())");
    const b = await begin("staff");
    const result = await identity.auth.finishOidc(b.callback, b.cookie);
    await expect(identity.auth.requireStaff(result.cookie)).rejects.toMatchObject({ status: 403 });
    expect(await identity.auth.requireGuest(result.cookie)).toBeTruthy();
  });
  it("links only an existing matching email, rotates sessions and rejects account or subject conflicts", async () => {
    const q = queryable(db), [account] = await q.query<{ id: string }>("insert into accounts(email) values('ana@example.test') returning id");
    const old = await identity.sessions.rotate({ principal: "guest", accountId: account!.id, authenticatedAt: new Date(), authMethod: "email_otp" });
    let b = await begin("guest", old.cookie);
    const result = await identity.auth.finishOidc(b.callback, b.cookie);
    expect(await identity.sessions.resolve(old.cookie)).toBeNull();
    userinfo = { user_id: subject, email: { email: "different@example.test", is_verified: true } };
    b = await begin(); await expect(identity.auth.finishOidc(b.callback, b.cookie)).rejects.toMatchObject({ code: "IdentityLinkConflict" });
    overrides.sub = "different-subject"; userinfo = { user_id: "different-subject", email: { email: "different@example.test", is_verified: true } };
    b = await begin("guest", result.cookie); await expect(identity.auth.finishOidc(b.callback, b.cookie)).rejects.toMatchObject({ code: "IdentityLinkConflict" });
    expect(await q.query("select id from accounts")).toHaveLength(1); expect(await q.query("select id from sessions where revoked_at is null")).toHaveLength(1);
    expect(logs.map(line => JSON.parse(line).reason)).toEqual(["identity_link_conflict", "identity_link_conflict"]);
  });
  it.skipIf(!process.env.TEST_DATABASE_URL)("enforces the single-use state gate before concurrent exchanges (Postgres)", async () => {
    expect(db.kind).toBe("postgres");
    const b = await begin(), results = await Promise.allSettled([identity.auth.finishOidc(b.callback, b.cookie), identity.auth.finishOidc(b.callback, b.cookie)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(counts.token).toBe(1); expect(userinfoCalls).toBe(1);
    expect(logs).toEqual([JSON.stringify({ event: "auth.oidc_callback_failed", reason: "state_mismatch" })]);
  });
  it.each(["http", "json", "pkce"])("logs a single token_exchange_failed for %s failure without provider details", async mode => {
    if (mode === "http") tokenStatus = 500;
    if (mode === "json") invalidTokenBody = true;
    const b = await begin();
    if (mode === "pkce") current.searchParams.set("code_challenge", "incorrect");
    await expect(identity.auth.finishOidc(b.callback, b.cookie)).rejects.toMatchObject({ code: "OidcExchangeFailed" });
    expect(logs).toEqual([JSON.stringify({ event: "auth.oidc_callback_failed", reason: "token_exchange_failed" })]); expect(userinfoCalls).toBe(0);
  });
  it.each([null, "", "broken.jwt.value"])("never downgrades a present invalid ID token %s to an access token", async idToken => {
    extraTokens.id_token = idToken; await rejected("InvalidIdToken", "id_token_invalid"); expect(userinfoCalls).toBe(0);
  });
  it("preserves full ID-token validation when both tokens are returned", async () => {
    tokenMode = "both"; overrides.nonce = "wrong-nonce";
    await rejected("InvalidIdToken", "id_token_invalid"); expect(userinfoCalls).toBe(0);
  });
  it("still accepts a valid ID token without fetching user data", async () => {
    tokenMode = "both"; userinfoStatus = 500;
    const b = await begin(); await identity.auth.finishOidc(b.callback, b.cookie);
    expect(userinfoCalls).toBe(0); expect(logs).toEqual([]);
  });
  it("keeps the callback response generic and clears state on an access-token failure", async () => {
    vi.stubEnv("APP_URL", appUrl); overrides.aud = "wrong";
    const b = await begin(), { GET } = await import("../../app/api/auth/oidc/callback/route");
    const response = await GET(new Request(b.callback, { headers: { cookie: `__Host-oidc=${b.cookie}`, "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } }));
    // Back to our own sign-in screen with a calm notice (2026-10-02), never a raw error page.
    expect(response.status).toBe(307); expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    expect(new URL(response.headers.get("location")!).searchParams.get("error")).toBe("google_failed");
    expect(response.headers.get("set-cookie")).toContain("__Host-oidc=;"); expect(response.headers.get("set-cookie")).not.toContain("__Host-sid=");
    expect(logs).toEqual([JSON.stringify({ event: "auth.oidc_callback_failed", reason: "access_token_invalid" })]);
  });
  it("a cancelled Google sign-in (access_denied with the verified state) returns to the sign-in screen with google_cancelled", async () => {
    vi.stubEnv("APP_URL", appUrl);
    const b = await begin(), { GET } = await import("../../app/api/auth/oidc/callback/route");
    const url = new URL(b.callback); url.searchParams.delete("code"); url.searchParams.set("error", "access_denied");
    const response = await GET(new Request(url.toString(), { headers: { cookie: `__Host-oidc=${b.cookie}`, "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } }));
    expect(response.status).toBe(307);
    const back = new URL(response.headers.get("location")!);
    expect(back.pathname).toBe("/login"); expect(back.searchParams.get("error")).toBe("google_cancelled");
    expect(response.headers.get("set-cookie")).toContain("__Host-oidc=;"); expect(response.headers.get("set-cookie")).not.toContain("__Host-sid=");
    expect(counts.token).toBe(0);
  });
  it("logs route-policy rejection once without exchanging tokens", async () => {
    vi.stubEnv("APP_URL", appUrl);
    const b = await begin(), { GET } = await import("../../app/api/auth/oidc/callback/route");
    const response = await GET(new Request(b.callback, { method: "POST", headers: { cookie: `__Host-oidc=${b.cookie}` } }));
    expect(response.status).toBe(403); expect(counts.token).toBe(0);
    expect(logs).toEqual([JSON.stringify({ event: "auth.oidc_callback_failed", reason: "callback_failed" })]);
  });
  it("uses every production pin with discovery unavailable and completes a staff callback on the standalone bind host", async () => {
    for (const name of ["ISSUER", "AUTHORIZE_URL", "TOKEN_URL", "JWKS_URL"]) vi.stubEnv(`DIDIT_OIDC_${name}`, "");
    discoveryStatus = 500; overrides.iss = "https://auth.didit.me/";
    userinfo = { user_id: subject, email: { email: "employee@didit.me", is_verified: true } };
    appUrl = "https://events.didit.me";
    vi.stubEnv("APP_URL", appUrl); vi.stubEnv("SESSION_SECRET", "fixture-secret-over-thirty-two-characters");
    const endpoints: Record<string, string> = { [DISCOVERY]: "/discovery", "https://apx.didit.me/auth/oidc/token": "/token", "https://apx.didit.me/auth/config/jwks": "/jwks", [userinfoUrl]: "/auth/v2/users/retrieve/" };
    const requests: string[] = [];
    const transport: typeof fetch = async (input, init) => {
      const url = String(input); requests.push(url);
      if (!endpoints[url]) throw new Error("Unexpected endpoint");
      if (url === userinfoUrl) expect(init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
      return fetch(`${base}${endpoints[url]}`, init);
    };
    identity = createIdentityServices({ db, didit: new DiditClient({apiKey:"fake",fetch:fake.fetch}), secret: "fixture-secret-over-thirty-two-characters", appUrl, oidc: createOidcAdapter({ fetch: transport, clientId: "fixture-client", clientSecret: () => "fixture-secret" }) });
    await queryable(db).query("insert into staff(email,role) values('employee@didit.me','admin')");
    const b = await begin("staff"), { GET } = await import("../../app/api/auth/oidc/callback/route");
    const callback = new URL(b.callback); callback.protocol = "http:"; callback.host = "0.0.0.0:3000";
    const response = await GET(new Request(callback, { headers: { cookie: `__Host-oidc=${b.cookie}`, "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } }));
    expect(response.status).toBe(307); expect(response.headers.get("location")).toBe(`${appUrl}/onboarding?returnTo=%2Fme%2Fevents`);
    expect(response.headers.get("set-cookie")).toContain("__Host-sid="); expect(response.headers.get("set-cookie")).toContain("__Host-oidc=;");
    expect(requests).toEqual(Object.keys(endpoints)); expect(userinfoCalls).toBe(1); expect(logs).toEqual([]);
    expect(await queryable(db).query("select principal,auth_method,staff_email from sessions")).toEqual([{ principal: "guest", auth_method: "oidc_google", staff_email: null }]);
  });
});


it.each(["id", "access"] as const)("uses DIDIT_OIDC_CLIENT_ID for authorization, exchange and %s audience checks", async mode => {
  vi.stubEnv("DIDIT_OIDC_CLIENT_ID", "fixture-client");
  tokenMode = mode;
  identity = createIdentityServices({ db, didit: new DiditClient({ apiKey: "fake", fetch: fake.fetch }), secret: "fixture-secret-over-thirty-two-characters", appUrl,
    oidc: createOidcAdapter({ fetch: fixtureFetch, discoveryUrl: `${base}/discovery`, clientSecret: () => "fixture-secret", allowLocalTest: true }) });
  const b = await begin();
  expect(current.searchParams.get("client_id")).toBe("fixture-client");
  await expect(identity.auth.finishOidc(b.callback, b.cookie)).resolves.toHaveProperty("cookie");
});

it("refuses Google sign-in when no OIDC client is configured", async () => {
  vi.stubEnv("DIDIT_OIDC_CLIENT_ID", undefined);
  let requests = 0;
  const adapter = createOidcAdapter({ fetch: async () => { requests++; return new Response(null, { status: 503 }); }, allowLocalTest: true });
  await expect(adapter.authorize({ state: "state", nonce: "nonce", challenge: "challenge", redirectUri: "https://fork.test/callback" })).rejects.toMatchObject({ code: "OidcClientNotConfigured", status: 503 });
  expect(requests).toBe(0);
});

it.each(["fork.test", "second.test"])("refuses identifier-only login for configured staff domain %s and accepts a verified invited account", async domain => {
  vi.stubEnv("STAFF_EMAIL_DOMAIN", "fork.test,second.test");
  tokenMode = "access";
  const email = `owner@${domain}`;
  userinfo = { user_id: subject }; overrides.identifier = email;
  const unverified = await begin("guest");
  await expect(identity.auth.finishOidc(unverified.callback, unverified.cookie)).rejects.toMatchObject({ code: "OidcEmailUnverified" });
  userinfo = { user_id: subject, email: { email, is_verified: true } };
  await queryable(db).query("insert into staff(email,role) values($1,'owner')", [email]);
  const verified = await begin("staff");
  const result = await identity.auth.finishOidc(verified.callback, verified.cookie);
  expect(await identity.auth.requireStaff(result.cookie)).toMatchObject({ email, role: "owner" });
});
