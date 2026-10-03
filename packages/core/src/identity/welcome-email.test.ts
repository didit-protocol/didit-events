// v6 welcome email (M-28): queued once, in the transaction that creates a guest account (email code or Google as a
// guest); never on a later sign-in, a staff login or a sign-up whose transaction fails. Rendered at send time.
import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
import type { Db } from "../db/index.ts";
import { queryable,withTx } from "../db/tx.ts";
import { DiditClient } from "../didit/client.ts";
import { fakeDiditServer } from "../didit/fake-server.ts";
import type { ConsentInput } from "../domain/event-model.ts";
import { emailHandler } from "../notifications/email.ts";
import { startFakeResend,type FakeResend } from "../notifications/fake-resend.ts";
import type { OutboxMessage } from "../outbox.ts";
import { resetDatabase,testDatabase } from "../testing/database.ts";
import { authFlows } from "./auth.ts";
import { createIdentityServices } from "./index.ts";
import { sessionServices } from "./sessions.ts";
import { context,type IdentityOptions,type OidcClaims } from "./shared.ts";

const consent: ConsentInput = { disclosureVersion: "events-profile-v2", shareProfileWithHosts: true, eventConsentAccepted: true, acceptedChecks: ["face"] };
const CODE = "481903", BASE = "https://events.test";

describe("welcome email M-28 (pglite)", () => {
  let db: Db, close: () => Promise<void>, fake: Awaited<ReturnType<typeof fakeDiditServer>>, resend: FakeResend;
  let options: IdentityOptions, identity: ReturnType<typeof createIdentityServices>, claims: OidcClaims;
  const q = () => queryable(db);
  beforeAll(async () => { ({ db, close } = await testDatabase("pglite")); resend = await startFakeResend(); }, 60000);
  beforeEach(async () => {
    await fake?.close(); await resetDatabase(db); await q().query("truncate otp_challenges,otp_deliveries,oidc_transactions,sessions"); resend.reset();
    fake = await fakeDiditServer();
    claims = { issuer: "https://auth.didit.me/", subject: `google-${Math.random()}`, email: "ana@example.test", firstName: "Ana", lastName: "Ruiz", fullName: "Ana Ruiz" };
    options = { db, secret: "test-secret-that-is-over-thirty-two-characters", didit: new DiditClient({ apiKey: "local-fixture-only", fetch: fake.fetch }), appUrl: BASE, totalCapUsd: 100, dailyCapUsd: 100,
      oidc: { authorize: async ({ state }) => `https://apx.didit.test/authorize?state=${state}&idp=google`, exchange: async () => claims } };
    identity = createIdentityServices(options);
  });
  afterAll(async () => { await fake?.close(); await resend?.close(); await close?.(); });

  const welcomes = () => q().query<OutboxMessage & { account: string } & Record<string, unknown>>("select *,payload->>'accountId' account from outbox where kind='email:M-28' order by created_at");
  async function otpSignIn(email: string) {
    const sent = await identity.auth.sendOtp(email, "ip");
    return identity.auth.checkOtp(sent.challengeId, CODE, { consent, otpCookie: sent.cookie });
  }
  async function google(principal: "guest" | "staff") {
    const start = await identity.auth.beginOidc(principal, "/me/events");
    return identity.auth.finishOidc(`${BASE}/api/auth/oidc/callback?state=${new URL(start.url).searchParams.get("state")}&code=fixture`, start.cookie);
  }

  it("an email-code sign-up queues one M-28 for the new account; a second sign-in queues nothing", async () => {
    const first = await otpSignIn("new@example.test");
    expect(first.isNew).toBe(true);
    const queued = await welcomes();
    expect(queued.map(r => [r.dedupe_key, r.payload])).toEqual([[`email:M-28:${first.principal.accountId}`, { code: "M-28", accountId: first.principal.accountId }]]);
    const again = await otpSignIn("new@example.test");
    expect(again.isNew).toBe(false);
    expect(await welcomes()).toHaveLength(1);
  });

  it("a Google sign-up as a guest queues one M-28; signing in with Google again does not", async () => {
    const result = await google("guest");
    expect((await welcomes()).map(r => r.account)).toEqual([result.principal.accountId]);
    await google("guest");
    expect(await welcomes()).toHaveLength(1);
    // An existing account signing in through the email code is not new either.
    await otpSignIn("ana@example.test");
    expect(await welcomes()).toHaveLength(1);
  });

  it("staff logins (staff email code, Google as staff) never send a welcome", async () => {
    await q().query("insert into staff(email,role) values('ops@didit.me','admin'),('ana@didit.me','staff')");
    const sent = await identity.auth.sendStaffOtp("ops@didit.me", "ip");
    await identity.auth.checkStaffOtp(sent.challengeId, CODE, { consent, otpCookie: sent.cookie });
    claims = { ...claims, email: "ana@didit.me" };
    await google("staff").catch(() => undefined);
    expect(await q().query("select count(*)::int n from accounts")).not.toEqual([{ n: 0 }]);
    expect(await welcomes()).toHaveLength(0);
  });

  it("a sign-up whose transaction fails sends nothing (the outbox row rolls back with the account)", async () => {
    const flows = authFlows(context(options), sessionServices(context(options)));
    await expect(withTx(async tx => {
      await flows.guestLogin(tx, "rollback@example.test", undefined, undefined, undefined, true);
      expect((await tx.query("select 1 from outbox where kind='email:M-28'")).length).toBe(1);
      throw new Error("later step failed");
    }, db)).rejects.toThrow("later step failed");
    expect(await q().query("select 1 from accounts where email='rollback@example.test'")).toEqual([]);
    expect(await welcomes()).toHaveLength(0);
  });

  it("renders at send time: first name, Explore events, and the profile link only while the profile is incomplete", async () => {
    const result = await google("guest");
    const [row] = await welcomes();
    const send = () => emailHandler({ baseUrl: BASE, resend: { apiKey: "re_test", apiUrl: resend.url }, db })(row!, { signal: new AbortController().signal });
    await send();
    const body = resend.calls[0]!.body as { to: string[]; subject: string; html: string; text: string };
    expect(body.to).toEqual(["ana@example.test"]);
    expect(body.subject).toBe("Welcome to Didit Events");
    expect(body.text).toContain("Welcome, Ana");
    expect(body.text).toContain("Hosts see your profile, never your selfie.");
    expect(body.html).toContain(`href="${BASE}/events"`);
    expect(body.html).toContain(`href="${BASE}/me/profile/edit"`);
    expect(body.html).toContain(`href="${BASE}/me/settings"`); // Email preferences
    expect(body.text).not.toMatch(/—/);
    // A completed profile drops the link; no name falls back to "Welcome".
    await q().query(`update accounts set first_name=null,full_name='Ana Ruiz',headline='Builder',company='Acme',job_role='Founder',
      profile_links='[{"kind":"linkedin","label":"LinkedIn","href":"https://www.linkedin.com/in/ana"}]'::jsonb,profile_completed_at=clock_timestamp() where id=$1`, [result.principal.accountId]);
    resend.reset();
    await send();
    const second = resend.calls[0]!.body as { html: string; text: string };
    expect(second.text).toMatch(/\nWelcome\n/);
    expect(second.html).not.toContain("/me/profile/edit");
    expect(second.text).not.toContain("Complete your profile");
  });
});
