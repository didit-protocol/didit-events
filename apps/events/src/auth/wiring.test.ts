import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { testDatabase, resetDatabase } from "@didit-events/core/testing/database";
import { queryable } from "@didit-events/core/db/tx";
import { createIdentityServices } from "@didit-events/core/identity";
import { DiditClient } from "@didit-events/core/didit";
import { fakeDiditServer } from "@didit-events/core/didit/fake-server";
import { randomToken, signToken } from "@didit-events/core/identity/shared";
import { csrfToken } from "./browser";
import { readFile } from "node:fs/promises";
import { GET as getPhoto } from "../../app/api/me/photo/route";
import { signInAction } from "../../app/login/actions";
import { type Db } from "@didit-events/core/db";
import { saveProfileAction } from "../../app/me/profile/edit/actions";
import { changeVerifiedName, saveProfile } from "../../app/me/profile/edit/data";
import { saveOnboardingProfile } from "../../app/onboarding/actions";
import { saveRegistrationProfile } from "./profile";
import { toggleMarketingAction, disconnectGoogleAction } from "../../app/me/settings/actions";
import { deleteAccountAction } from "../../app/me/settings/delete/actions";
import { guardAction } from "./actions";
import { requestAction, subscribeAction, verifyAction } from "../../app/e/[slug]/actions";
import { startFromLinkAction } from "../../app/e/[slug]/v/[token]/actions";
import { acceptInviteAction } from "../../app/i/[token]/actions";
import { registerAction, profileAction, requestWithProfileAction, joinWaitlistAction } from "../../app/e/[slug]/register/actions";
import { cancelAction } from "../../app/me/events/[slug]/cancel/actions";
import { renewAction, newLinkAction } from "../../app/me/events/[slug]/actions";
import { changeNameAction } from "../../app/me/profile/edit/actions";
import { removePhotoAction, savePhotoAction, uploadPhotoAction } from "../../app/me/profile/photo/actions";
import { deleteVerificationAction } from "../../app/me/profile/verification/actions";
import { reproveAction } from "../../app/me/reauth/actions";
import { seal } from "@didit-events/core/identity/shared";
import { pendingAccountAction } from "./fresh-action";
import { signOutAllAction } from "../../app/me/settings/actions";
import { signOutAction } from "../../app/me/settings/actions";
import { inviteStaffAction, disableStaffAction } from "../../app/admin/team/actions";

const state = vi.hoisted(() => ({ jar: new Map<string, string>(), origin: "https://events.test", identity: undefined as ReturnType<typeof createIdentityServices> | undefined }));
vi.mock("./runtime", () => ({ get identity() { return state.identity!; } }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => state.jar.has(name) ? { value: state.jar.get(name)! } : undefined, set: (name: string, value: string) => { state.jar.set(name, value); } }),
  headers: async () => new Headers({ origin: state.origin, cookie: [...state.jar.entries()].map(([key, value]) => `${key}=${value}`).join("; "), "x-forwarded-for": "192.0.2.8" }),
}));
let db: Db, close: () => Promise<void>, fake: Awaited<ReturnType<typeof fakeDiditServer>>;
const secret = "test-secret-over-thirty-two-characters", q = () => queryable(db);
beforeAll(async () => { ({ db, close } = await testDatabase(process.env.TEST_DATABASE_URL ? "postgres" : "pglite")); (globalThis as typeof globalThis & { __diditEventsDb?: Db }).__diditEventsDb = db; }, 60000);
beforeEach(async () => {
  await fake?.close(); await resetDatabase(db); await q().query("truncate otp_challenges,otp_deliveries");
  fake = await fakeDiditServer();
  state.identity = createIdentityServices({ db, secret, didit: new DiditClient({ apiKey: "fixture-only", fetch: fake.fetch }), totalCapUsd: 10, dailyCapUsd: 10 });
  state.jar.clear(); state.origin = "https://events.test";
  vi.stubEnv("DIDIT_API_KEY", "fixture-only"); vi.stubEnv("DIDIT_WORKFLOW_ID", "10000000-0000-4000-8000-000000000001"); vi.stubEnv("DIDIT_API_URL", fake.url);
  vi.stubEnv("APP_URL", state.origin); vi.stubEnv("SESSION_SECRET", secret);
  const anon = signToken(randomToken(), secret, "anonymous");
  state.jar.set("__Host-anon", anon); state.jar.set("__Host-csrf", csrfToken(anon, secret));
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); }); afterAll(async () => { await fake?.close(); delete (globalThis as typeof globalThis & { __diditEventsDb?: Db }).__diditEventsDb; await close?.(); });
function form(values: Record<string, string>) { const f = new FormData(); f.set("csrf", state.jar.get("__Host-csrf") ?? ""); f.set("onboardingConsent", JSON.stringify({disclosureVersion:"events-profile-v2",shareProfileWithHosts:true,eventConsentAccepted:false,acceptedChecks:["face"]})); for (const [key, value] of Object.entries(values)) f.set(key, value); return f; }
async function login() {
  const next = await signInAction({ step: "choose" }, form({ intent: "send", email: "ana@example.test" }));
  expect(next).toMatchObject({ step: "code", status: "sent" }); expect(state.jar.get("__Host-otp")).toBeTruthy();
  await expect(signInAction(next, form({ intent: "verify", email: "ana@example.test", code: "481903", next: "/me/profile" }))).rejects.toThrow("REDIRECT:/onboarding?returnTo=%2Fme%2Fprofile");
  return state.identity!.auth.requireGuest(state.jar.get("__Host-sid")!);
}
it("login action binds the code cookie, creates a real account/session, and rotates CSRF", async () => {
  const oldCsrf = state.jar.get("__Host-csrf"), principal = await login();
  expect(state.jar.get("__Host-csrf")).not.toBe(oldCsrf); expect(state.jar.get("__Host-otp")).toBe("");
  expect(await q().query("select id from accounts")).toEqual([{ id: principal.accountId }]);
  expect(await q().query("select id from sessions")).toEqual([{ id: principal.sessionId }]);
  expect(fake.counts).toEqual({ send: 1, check: 1, delete: 0 });
});
it("flow v3: sign-in from the join modal returns to the modal (no onboarding page) and records the consent receipt without a checkbox", async () => {
  const sent = await signInAction({ step: "choose" }, form({ intent: "send", email: "join@example.test" }));
  await expect(signInAction(sent, form({ intent: "verify", email: "join@example.test", code: "481903", next: "/e/ai-era?join=1" }))).rejects.toThrow("REDIRECT:/e/ai-era?join=1");
  const [account] = await q().query<{ email_verified_at: Date | null }>("select email_verified_at from accounts where email='join@example.test'");
  expect(account?.email_verified_at).toBeTruthy();
  const [op] = await q().query<{ consent: { disclosureVersion: string; shareProfileWithHosts: boolean; acceptedChecks: string[]; acceptedAt: string } }>("select consent from verification_ops");
  expect(op?.consent).toMatchObject({ disclosureVersion: "events-profile-v2", shareProfileWithHosts: true, acceptedChecks: ["face"] });
  expect(Number.isFinite(Date.parse(op!.consent.acceptedAt))).toBe(true);
  // The old /register links land in the modal too.
  const again = await signInAction({ step: "choose" }, form({ intent: "send", email: "join2@example.test" }));
  await expect(signInAction(again, form({ intent: "verify", email: "join2@example.test", code: "481903", next: "/e/ai-era/register" }))).rejects.toThrow("REDIRECT:/e/ai-era?join=1");
});
it("the photo route returns the signed-in account's JPEG bytes in an image Response", async () => {
  const principal=await login();
  const photo=await readFile(new URL("../../../../packages/core/src/identity/fixtures/photo.jpg",import.meta.url));
  await q().query("update accounts set photo=$2 where id=$1",[principal.accountId,photo]);
  const request=()=>new Request(`${state.origin}/api/me/photo`,{headers:{cookie:`__Host-sid=${state.jar.get("__Host-sid")}`,"sec-fetch-site":"same-origin"}});
  const response=await getPhoto(request());
  expect(response).toBeInstanceOf(Response);expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/jpeg");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(Buffer.from(await response.arrayBuffer())).toEqual(photo);
  await q().query("update accounts set photo=null where id=$1",[principal.accountId]);
  expect((await getPhoto(request())).status).toBe(404);
});
it("mid-deletion login shows the same neutral code-sent state without another paid send", async () => {
  const principal = await login();
  await state.identity!.accounts.requestDeletion(principal);
  const anon = signToken(randomToken(), secret, "anonymous");
  state.jar.clear(); state.jar.set("__Host-anon", anon); state.jar.set("__Host-csrf", csrfToken(anon, secret));
  const next = await signInAction({ step: "choose" }, form({ intent: "send", email: "ana@example.test" }));
  expect(next).toMatchObject({ step: "code", status: "sent" });
  expect(state.jar.get("__Host-otp")).toBeTruthy();
  expect(fake.counts).toEqual({ send: 1, check: 1, delete: 0 });
  expect(await q().query("select id from spend")).toHaveLength(2);
  expect(await q().query("select id from otp_challenges where redeemed_at is null and synthetic")).toHaveLength(1);
});
it.each(["existing", "unknown", "deleting"])("%s email presents identical sent/wrong/locked states and attemptsLeft", async accountState => {
  const email = `${accountState}@example.test`;
  if (accountState !== "unknown") await q().query("insert into accounts(email,deleting_at) values($1,$2)", [email, accountState === "deleting" ? new Date() : null]);
  const sent = await signInAction({ step: "choose" }, form({ intent: "send", email }));
  expect(sent).toMatchObject({ step: "code", status: "sent", attemptsLeft: 3 });
  for (const attemptsLeft of [2, 1]) {
    expect(await signInAction(sent, form({ intent: "verify", email, code: "111111" }))).toMatchObject({ step: "code", status: "wrong", attemptsLeft });
  }
  expect(await signInAction(sent, form({ intent: "verify", email, code: "111111" }))).toMatchObject({ step: "locked", scope: "email" });
  expect(await q().query("select attempts,redeemed_at from otp_challenges")).toEqual([{ attempts: 3, redeemed_at: null }]);
  expect(await q().query("select id from sessions")).toHaveLength(0);
  expect(fake.counts).toEqual({ send: accountState === "deleting" ? 0 : 1, check: accountState === "deleting" ? 0 : 3, delete: 0 });
});
it("the action adapter rejects missing CSRF and foreign Origin before any spend or provider call", async () => {
  const f = form({ intent: "send", email: "ana@example.test" }); f.delete("csrf");
  await expect(signInAction({ step: "choose" }, f)).rejects.toMatchObject({ status: 403 });
  state.origin = "https://evil.test";
  await expect(signInAction({ step: "choose" }, form({ intent: "send", email: "ana@example.test" }))).rejects.toMatchObject({ status: 403 });
  expect(fake.counts.send).toBe(0); expect(await q().query("select id from spend")).toHaveLength(0);
});
it("a posted email different from the cookie challenge never checks Didit or creates a session", async () => {
  const sent = await signInAction({ step: "choose" }, form({ intent: "send", email: "ana@example.test" }));
  expect(await signInAction(sent, form({ intent: "verify", email: "other@example.test", code: "481903" }))).toMatchObject({ status: "expired" });
  expect(fake.counts.check).toBe(0); expect(await q().query("select id from sessions")).toHaveLength(0);
});
it("registration/profile/preferences/disconnect and deletion actions persist through their real services", async () => {
  const principal = await login();
  await saveRegistrationProfile({ fullName: "Ana Ruiz", company: "Company", role: "Engineer" });
  expect(await saveProfileAction({}, form({ fullName: "Ana Ruiz", headline: "Barcelona", bio: "Hello", linkedin: "linkedin.com/in/ana", website: "example.test" }))).toMatchObject({ saved: true });
  await expect(toggleMarketingAction(form({ on: "1" }))).rejects.toThrow("REDIRECT:/me/settings");
  expect(await state.identity!.accounts.get(principal.accountId)).toMatchObject({ firstName: "Ana", lastName: "Ruiz", company: "Company", jobRole: "Engineer", headline: "Barcelona", marketingOptIn: true });
  await q().query("insert into account_identities(account_id,issuer,subject) values($1,'https://issuer.test','google')", [principal.accountId]);
  await expect(disconnectGoogleAction(form({}))).rejects.toThrow("REDIRECT:/me/settings");
  expect(await q().query("select id from account_identities")).toHaveLength(0);
  // The browser cookie was cleared; restore the still-valid email-OTP cookie by a fresh sign-in.
  fake.challenges.get("ana@example.test")!.expired = true;
  const anon = signToken(randomToken(), secret, "anonymous"); state.jar.set("__Host-anon", anon); state.jar.delete("__Host-sid"); state.jar.set("__Host-csrf", csrfToken(anon, secret));
  await login();
  await expect(deleteAccountAction({}, form({ confirm: "DELETE" }))).rejects.toThrow("REDIRECT:/events?deleted=1");
  expect(await q().query("select id from accounts where deleting_at is not null")).toHaveLength(1);
  // v5 grace period: this browser's session stays (inert: it resolves for nothing but "Keep my account").
  expect(await q().query("select id from sessions where revoked_at is null")).toHaveLength(1);
  expect(await state.identity!.sessions.resolve(state.jar.get("__Host-sid")!)).toBeNull();
  expect(await state.identity!.profile.pendingDeletion(state.jar.get("__Host-sid")!)).toMatchObject({ accountId: expect.any(String) });
});
it("multipart action size limits include uploaded bytes", async () => {
  await login(); const f = form({}); f.set("photo", new Blob([new Uint8Array(311 * 1024)]), "photo.jpg");
  await expect(guardAction(f, { maxBytes: 310 * 1024 })).rejects.toMatchObject({ status: 413 });
});

const publicActions = [
  ["requestAction", (f: FormData) => requestAction({ status: "idle" }, f)],
  ["subscribeAction", subscribeAction], ["verifyAction", verifyAction],
  ["acceptInviteAction", acceptInviteAction], ["startFromLinkAction", startFromLinkAction],
  ["signInAction", (f: FormData) => signInAction({ step: "choose" }, f)],
  ["registerAction", (f: FormData) => registerAction({ step: "form", values: {} }, f)],
] as const;
const guestActions = [
  ["profileAction", (f: FormData) => profileAction({ values: {} }, f)],
  ["requestWithProfileAction", requestWithProfileAction], ["joinWaitlistAction", joinWaitlistAction],
  ["cancelAction", (f: FormData) => cancelAction({}, f)],
  ["renewAction", renewAction], ["newLinkAction", newLinkAction],
  ["saveProfileAction", (f: FormData) => saveProfileAction({}, f)],
  ["changeNameAction", (f: FormData) => changeNameAction({}, f)],
  ["uploadPhotoAction", (f: FormData) => uploadPhotoAction({}, f)],
  ["savePhotoAction", (f: FormData) => savePhotoAction({}, f)],
  ["removePhotoAction", (f: FormData) => removePhotoAction({}, f)],
  ["deleteVerificationAction", deleteVerificationAction],
  ["signOutAction", signOutAction], ["toggleMarketingAction", toggleMarketingAction],
  ["disconnectGoogleAction", disconnectGoogleAction],
  ["deleteAccountAction", (f: FormData) => deleteAccountAction({}, f)],
] as const;
const staffActions = [
  ["inviteStaffAction", (f: FormData) => inviteStaffAction({ status: "idle" }, f)],
  ["disableStaffAction", (f: FormData) => disableStaffAction(String(f.get("email") ?? ""), String(f.get("csrf") ?? ""))],
] as const;
async function expectNoEffects() {
  for (const table of ["accounts", "sessions", "registrations", "spend", "outbox", "audit", "staff"]) expect(await q().query(`select * from ${table}`)).toHaveLength(0);
  expect(fake.counts).toEqual({ send: 0, check: 0, delete: 0 });
}
it("G-01 reaches sign-in with only anonymous binding and CSRF; no identity is fabricated", async () => {
  expect([...state.jar.keys()].sort()).toEqual(["__Host-anon", "__Host-csrf"]);
  await expect(requestAction({ status: "idle" }, form({ slug: "barcelona-office-opening", firstName: "Ana", lastName: "Ruiz", email: "ana@example.test", company: "Didit" }))).rejects.toThrow("REDIRECT:/login?next=%2Fe%2Fbarcelona-office-opening%2Fregister");
  // Unauthenticated form details do not establish a guest identity.
  await expectNoEffects();
});
it.each([
  ["verifyAction", verifyAction, { slug: "ai-era" }, "/login?next=%2Fe%2Fai-era"],
  ["subscribeAction", subscribeAction, { slug: "ai-era" }, "/login?next=%2Fe%2Fai-era"],
  ["acceptInviteAction", acceptInviteAction, { token: "demo" }, "/login?next=%2Fi%2Fdemo"],
] as const)("%s preserves its signed-out login destination through the real guard", async (_name, action, fields, destination) => {
  await expect(action(form(fields))).rejects.toThrow(`REDIRECT:${destination}`);
  await expectNoEffects();
});
it.each(["demo", "demo-expired", "demo-revoked", "demo-verified", "demo-in-review", "unknown"])("signed-out personal link %s follows its token policy", async token => {
  const slug = "barcelona-office-opening";
  const destination = `/e/${slug}/v/${token}`;
  await expect(startFromLinkAction(form({ slug, token }))).rejects.toThrow(`REDIRECT:${destination}`);
  await expectNoEffects();
});
it("personal demo tokens cannot start verification in production", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("FRAMES", "");
  await expect(startFromLinkAction(form({ slug: "ai-era", token: "demo" }))).rejects.toThrow("REDIRECT:/e/ai-era/v/demo");
  await expectNoEffects();
});
it.each(publicActions)("%s rejects foreign Origin and missing/mismatched CSRF before domain work", async (_name, action) => {
  const fields = { slug: "ai-era", token: "demo", intent: "send", email: "ana@example.test" };
  const missing = form(fields); missing.delete("csrf");
  await expect(action(missing)).rejects.toMatchObject({ status: 403 });
  await expect(action(form({ ...fields, csrf: "wrong" }))).rejects.toMatchObject({ status: 403 });
  state.origin = "https://evil.test";
  await expect(action(form(fields))).rejects.toMatchObject({ status: 403 });
  await expectNoEffects();
});
it.each([...guestActions, ...staffActions])("%s refuses an anonymous browser even with matching CSRF", async (_name, action) => {
  if (["signOutAction", "profileAction", "requestWithProfileAction", "joinWaitlistAction"].includes(_name)) await expect(action(form({ slug: "ai-era" }))).rejects.toMatchObject({ status: 403 });
  else await expect(action(form({ slug: "ai-era" }))).rejects.toThrow(/REDIRECT:.*login\?next=/);
  await expectNoEffects();
});
it.each(guestActions)("%s checks the real guest principal after the browser guard", async (_name, action) => {
  const principal = await login();
  await state.identity!.sessions.revoke(principal.sessionId);
  if (["profileAction", "requestWithProfileAction", "joinWaitlistAction"].includes(_name)) await expect(action(form({ slug: "ai-era" }))).rejects.toMatchObject({ status: 401 });
  else if (_name === "signOutAction") await expect(action(form({}))).rejects.toThrow("REDIRECT:/events");
  else await expect(action(form({ slug: "ai-era" }))).rejects.toThrow(/REDIRECT:\/login\?next=/);
  expect(await q().query("select id from sessions where revoked_at is null")).toHaveLength(0);
  expect(await q().query("select id from deletions")).toHaveLength(0);
  expect(fake.counts).toEqual({ send: 1, check: 1, delete: 0 });
});
it.each(staffActions)("%s refuses a real guest session", async (_name, action) => {
  await login();
  await expect(action(form({ email: "employee@didit.me", role: "admin" }))).rejects.toThrow("REDIRECT:/admin/forbidden?next=%2Fadmin%2Fteam");
  expect(await q().query("select * from staff")).toHaveLength(0);
  expect(fake.counts).toEqual({ send: 1, check: 1, delete: 0 });
});
it("registration starts signed-out and establishes a real session before saving the profile", async () => {
  await q().query("insert into events(slug,name,starts_at,ends_at,capacity,status,registration_mode) values('ai-era','Real registration',clock_timestamp()+interval '48 hours',clock_timestamp()+interval '52 hours',3,'published','request')");
  const fields = { slug: "ai-era", fullName: "Ana Ruiz", email: "ana@example.test", company: "Didit", consent: "on" };
  const sent = await registerAction({ step: "form", values: {} }, form({ ...fields, intent: "details" }));
  expect(sent).toMatchObject({ step: "code", status: "sent" });
  expect(await q().query("select email,redeemed_at from otp_challenges")).toEqual([{ email: "ana@example.test", redeemed_at: null }]);
  expect(await q().query("select id from registrations")).toHaveLength(0);
  expect(fake.counts).toEqual({ send: 1, check: 0, delete: 0 });
  await expect(registerAction(sent, form({ ...fields, intent: "verify", code: "481903" }))).rejects.toThrow("REDIRECT:/e/ai-era?join=1");
  expect(await q().query("select email,first_name,last_name from accounts")).toEqual([{ email: "ana@example.test", first_name: "Ana", last_name: "Ruiz" }]);
  expect(await q().query("select principal,auth_method from sessions")).toEqual([{ principal: "guest", auth_method: "email_otp" }]);
  expect(await q().query("select admission from registrations")).toEqual([]);
  expect(await q().query("select kind from outbox where kind like 'email:%'")).toEqual([{ kind: "email:M-28" }]); // only the v6 welcome; no request email
  expect(fake.counts).toEqual({ send: 1, check: 1, delete: 0 });
});

it("profile name locking comes from the stored identity, never a posted flag", async () => {
  const principal = await login();
  const result = await profileAction({ values: {} }, form({ slug: "ai-era", fullName: "", nameLocked: "1", company: "Example" }));
  expect(result.errors).toEqual({ fullName: "Enter your full name", consent: "Tick the box to continue" });
  expect(await q().query("select first_name,last_name from accounts where id=$1", [principal.accountId])).toEqual([{ first_name: null, last_name: null }]);
  expect(await q().query("select id from registrations")).toHaveLength(0);
  expect(fake.counts).toEqual({ send: 1, check: 1, delete: 0 });
});
it("Google-linked profile edits use the posted name and return to onboarding without creating a request", async () => {
  const principal = await login();
  await q().query("update accounts set first_name='Ana',last_name='Ruiz' where id=$1", [principal.accountId]);
  await q().query("insert into account_identities(account_id,issuer,subject) values($1,'https://issuer.test','google')", [principal.accountId]);
  await q().query("insert into events(slug,name,starts_at,ends_at,capacity,status) values('ai-era','Real profile',clock_timestamp()+interval '48 hours',clock_timestamp()+interval '52 hours',3,'published')");
  await expect(profileAction({ values: {} }, form({ slug: "ai-era", fullName: "Someone Else", consent: "on" }))).rejects.toThrow("REDIRECT:/e/ai-era?join=1");
  expect(await q().query("select first_name,last_name from accounts where id=$1", [principal.accountId])).toEqual([{ first_name: "Someone", last_name: "Else" }]);
  expect(await q().query("select admission from registrations")).toEqual([]);
  expect(await q().query("select kind from outbox where kind like 'email:%'")).toEqual([{ kind: "email:M-28" }]); // only the v6 welcome; no request email
  expect(fake.counts).toEqual({ send: 1, check: 1, delete: 0 });
});

it.each([
  ["delete-account", (f: FormData) => deleteAccountAction({}, f), { confirm: "DELETE" }, "/events?deleted=1"],
  ["delete-verification", deleteVerificationAction, {}, "/me/profile"],
  ["disconnect-google", disconnectGoogleAction, {}, "/me/settings"],
  ["sign-out-all", signOutAllAction, {}, "/events"],
  ["change-name", (f: FormData) => changeNameAction({}, f), { fullName: "Confirmed Name" }, "/me/profile/edit"],
  ["save-profile", (f: FormData) => saveProfileAction({}, f), { fullName: "Confirmed Name", headline: "Host", linkedin: "linkedin.com/in/example" }, "/me/profile/edit"],
] as const)("re-proves a stale session then completes %s with its original values", async (operation, action, values, target) => {
  const principal = await login();
  await q().query("update sessions set authenticated_at=clock_timestamp()-interval '16 minutes' where id=$1", [principal.sessionId]);
  await expect(action(form(values))).rejects.toThrow("REDIRECT:/me/reauth");
  expect(await pendingAccountAction()).toMatchObject({ operation, accountId: principal.accountId });
  expect(await q().query("select deleting_at from accounts where id=$1", [principal.accountId])).toEqual([{ deleting_at: null }]);
  expect(await reproveAction({}, form({ intent: "send", email: "attacker@example.test" }))).toMatchObject({ sent: true });
  expect(await reproveAction({}, form({ intent: "verify", code: "000000" }))).toHaveProperty("error");
  await expect(reproveAction({}, form({ intent: "verify", code: "481903", fullName: "Injected Name" }))).rejects.toThrow(`REDIRECT:${target}`);
  expect(state.jar.get("__Host-reauth")).toBe("");
  if (operation === "change-name" || operation === "save-profile") {
    expect(await q().query("select full_name from accounts where id=$1", [principal.accountId])).toEqual([{ full_name: "Confirmed Name" }]);
    await expect(state.identity!.auth.requireGuest(state.jar.get("__Host-sid")!, 900)).resolves.toBeTruthy();
  }
  if (operation === "delete-account") expect((await q().query("select deleting_at from accounts where id=$1", [principal.accountId]))[0]!.deleting_at).toBeInstanceOf(Date);
  if (operation === "sign-out-all") expect(await q().query("select id from sessions where account_id=$1 and revoked_at is null", [principal.accountId])).toHaveLength(0);
});
it.each(["tampered", "expired", "other-account"])("rejects %s re-proof intents before requesting a code", async mode => {
  const principal = await login();
  const pending = { purpose: "account-action", accountId: mode === "other-account" ? "10000000-0000-4000-8000-000000000001" : principal.accountId, expires: Date.now() + (mode === "expired" ? -1 : 900000), next: "/me/settings", operation: "sign-out-all", fields: {} };
  state.jar.set("__Host-reauth", mode === "tampered" ? "invalid" : seal(pending, secret));
  await expect(reproveAction({}, form({ intent: "send" }))).rejects.toMatchObject({ code: "InvalidPendingAction" });
  expect(fake.counts.send).toBe(1);
});

it("the JSON name-change route preserves the submitted profile through email re-proof", async () => {
  const principal = await login(), account = (await state.identity!.accounts.get(principal.accountId))!;
  await q().query("update sessions set authenticated_at=clock_timestamp()-interval '16 minutes' where id=$1", [principal.sessionId]);
  const { PATCH } = await import("../../app/api/me/profile/route");
  const response = await PATCH(new Request(`${state.origin}/api/me/profile`, { method: "PATCH", headers: { origin: state.origin, cookie: [...state.jar].map(([k, v]) => `${k}=${v}`).join("; "), "content-type": "application/json", "x-csrf": state.jar.get("__Host-csrf")! }, body: JSON.stringify({ expectedProfileVersion: account.profileVersion, fullName: "API Name" }) }));
  expect(response.status).toBe(401); expect(response.headers.get("x-account-reproof")).toBe("/me/reauth");
  expect((await state.identity!.accounts.get(principal.accountId))!.fullName).not.toBe("API Name");
  await reproveAction({}, form({ intent: "send" }));
  await expect(reproveAction({}, form({ intent: "verify", code: "481903" }))).rejects.toThrow("REDIRECT:/me/profile/edit");
  expect((await state.identity!.accounts.get(principal.accountId))!.fullName).toBe("API Name");
});

async function patchProfile(body: unknown) {
  const { PATCH } = await import("../../app/api/me/profile/route");
  return PATCH(new Request(`${state.origin}/api/me/profile`, { method: "PATCH", headers: {
    origin: state.origin, cookie: [...state.jar].map(([k, v]) => `${k}=${v}`).join("; "),
    "content-type": "application/json", "x-csrf": state.jar.get("__Host-csrf")!,
  }, body: JSON.stringify(body) }));
}
it.each(["form", "data", "json", "onboarding", "changeNameAction", "changeVerifiedName", "registration", "registrationAction"] as const)("%s profile saves skip re-proof for unchanged names, including whitespace, but preserve case", async entry => {
  const principal = await login();
  await q().query("update accounts set full_name=' Ana   Ruiz ',first_name='Ana',last_name='Ruiz' where id=$1", [principal.accountId]);
  await q().query("update sessions set authenticated_at=clock_timestamp()-interval '16 minutes' where id=$1", [principal.sessionId]);
  const submit = async (fullName: string) => {
    const values = { fullName, headline: "Host", bio: "", linkedin: "", website: "" };
    const expectedProfileVersion = (await state.identity!.accounts.get(principal.accountId))!.profileVersion;
    if (entry === "form") return saveProfileAction({}, form(values));
    if (entry === "data") return saveProfile(values);
    if (entry === "changeVerifiedName") return changeVerifiedName(fullName);
    if (entry === "registration") return saveRegistrationProfile({ fullName, company: "Company", role: "Host" });
    if (entry === "changeNameAction" || entry === "registrationAction") {
      try {
        if (entry === "changeNameAction") await changeNameAction({}, form({ fullName }));
        else await profileAction({ values: {} }, form({ fullName, slug: "ai-era", company: "Company", role: "Host", consent: "on" }));
      } catch (error) {
        const target = entry === "changeNameAction" ? "/me/profile/edit" : "/e/ai-era?join=1";
        if (!(error instanceof Error) || error.message !== `REDIRECT:${target}`) throw error;
      }
      return;
    }
    if (entry === "onboarding") return saveOnboardingProfile(form({ profile: JSON.stringify({ fullName, headline: "Host", expectedProfileVersion }) }));
    const response = await patchProfile({ fullName, headline: "Host", expectedProfileVersion });
    if (response.status === 401) throw new Error("REDIRECT:/me/reauth");
    expect(response.status).toBe(200);
  };
  for (const name of ["Ana Ruiz", "  Ana    Ruiz  "]) {
    await submit(name);
    expect(state.jar.has("__Host-reauth")).toBe(false);
    const account = (await state.identity!.accounts.get(principal.accountId))!;
    expect(account).toMatchObject({ fullName: "Ana Ruiz", firstName: "Ana", lastName: "Ruiz" });
    if (["form", "data", "json", "onboarding"].includes(entry)) expect(account.headline).toBe("Host");
    if (entry === "registration" || entry === "registrationAction") expect(account).toMatchObject({ company: "Company", jobRole: "Host" });
  }
  if (entry === "data" || entry === "changeVerifiedName") await expect(submit("ana Ruiz")).rejects.toMatchObject({ code: "FreshAuthenticationRequired" });
  else await expect(submit("ana Ruiz")).rejects.toThrow("REDIRECT:/me/reauth");
  expect((await state.identity!.accounts.get(principal.accountId))!.fullName?.trim().replace(/\s+/g, " ")).toBe("Ana Ruiz");
  if (entry !== "data" && entry !== "changeVerifiedName") {
    expect((await pendingAccountAction()).fields.fullName).toBe("ana Ruiz");
    await reproveAction({}, form({ intent: "send" }));
    await expect(reproveAction({}, form({ intent: "verify", code: "481903" }))).rejects.toThrow("REDIRECT:/me/profile/edit");
    expect(await state.identity!.accounts.get(principal.accountId)).toMatchObject({ fullName: "ana Ruiz", firstName: "ana", lastName: "Ruiz" });
  }
});

it.each(["json", "onboarding"] as const)("%s keeps maximum legal profile payloads outside the pending cookie and completes the name after re-proof", async entry => {
  const principal = await login(), account = (await state.identity!.accounts.get(principal.accountId))!;
  await q().query("update sessions set authenticated_at=clock_timestamp()-interval '16 minutes' where id=$1", [principal.sessionId]);
  const profile = {
    expectedProfileVersion: account.profileVersion, fullName: "😀".repeat(240), headline: "😀".repeat(80),
    company: "😀".repeat(120), jobRole: "😀".repeat(120), bio: "😀".repeat(160),
    links: Array.from({ length: 8 }, (_, i) => ({ kind: "website", label: "😀".repeat(40), href: `https://example.test/${i}/`.padEnd(2048, "x") })),
  };
  expect(Buffer.byteLength(JSON.stringify(profile))).toBeGreaterThan(20_000);
  if (entry === "json") expect((await patchProfile(profile)).status).toBe(401);
  else await expect(saveOnboardingProfile(form({ profile: JSON.stringify(profile) }))).rejects.toThrow("REDIRECT:/me/reauth");
  expect(Buffer.byteLength(state.jar.get("__Host-reauth")!)).toBeLessThan(3800);
  const saved = (await state.identity!.accounts.get(principal.accountId))!;
  expect(saved.fullName).not.toBe(profile.fullName);
  expect(saved.profileLinks).toEqual(profile.links);
  expect(await pendingAccountAction()).toMatchObject({ fields: { fullName: profile.fullName, expectedProfileVersion: String(saved.profileVersion) } });
  await reproveAction({}, form({ intent: "send" }));
  await expect(reproveAction({}, form({ intent: "verify", code: "481903" }))).rejects.toThrow("REDIRECT:/me/profile/edit");
  expect(await state.identity!.accounts.get(principal.accountId)).toMatchObject({ fullName: profile.fullName, headline: profile.headline, bio: profile.bio, profileLinks: profile.links });
});

it("form saves retain non-name Unicode edits while the cookie holds only the changed name", async () => {
  const principal = await login();
  await q().query("update sessions set authenticated_at=clock_timestamp()-interval '16 minutes' where id=$1", [principal.sessionId]);
  const values = { fullName: "名".repeat(120), headline: "名".repeat(80), bio: "名".repeat(160), linkedin: "https://linkedin.com/".padEnd(200, "x"), website: "https://example.test/".padEnd(200, "x") };
  await expect(saveProfileAction({}, form(values))).rejects.toThrow("REDIRECT:/me/reauth");
  expect((await pendingAccountAction()).fields).toEqual({ fullName: values.fullName });
  expect(Buffer.byteLength(state.jar.get("__Host-reauth")!)).toBeLessThan(3800);
  await reproveAction({}, form({ intent: "send" }));
  await expect(reproveAction({}, form({ intent: "verify", code: "481903" }))).rejects.toThrow("REDIRECT:/me/profile/edit");
  expect(await state.identity!.accounts.get(principal.accountId)).toMatchObject({ fullName: values.fullName, headline: values.headline, bio: values.bio });
});
