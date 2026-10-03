import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/index.ts";
import { queryable } from "../db/tx.ts";
import type { StaffPrincipal } from "../domain/services.ts";
import { renderEmail } from "../email/index.ts";
import { ROLE_CAN, ROLE_SUMMARY } from "./staff-roles.ts";
import { registerEmailHandlers } from "../notifications/email.ts";
import { startFakeResend, type FakeResend } from "../notifications/fake-resend.ts";
import { dispatchOutbox, OutboxRegistry } from "../outbox.ts";
import { accountSession } from "../testing/account-session.ts";
import { resetDatabase, testDatabase } from "../testing/database.ts";
import { createIdentityServices } from "./index.ts";
import { INVITE_RESEND_COOLDOWN_SEC } from "./team.ts";

const BASE = "https://events.didit.me";
const kinds = ["pglite", ...(process.env.TEST_DATABASE_URL ? ["postgres"] : [])] as ("pglite" | "postgres")[];
for (const kind of kinds) describe(`T-01 team invite email ${kind}`, () => {
  let db: Db, close: () => Promise<void>, resend: FakeResend, identity: ReturnType<typeof createIdentityServices>, registry: OutboxRegistry;
  const q = () => queryable(db);
  const as = async (email: string): Promise<StaffPrincipal> => identity.auth.requireStaff((await accountSession(identity, db, email)).cookie);
  let owner: StaffPrincipal, admin: StaffPrincipal;
  const invites = () => q().query<{ dedupe_key: string; payload: { to: string; data: Record<string, unknown> }; status: string }>("select dedupe_key,payload,status from outbox where kind='email:T-01' order by created_at,id");
  const drain = async () => { while (await dispatchOutbox(db, registry)); };
  beforeAll(async () => { ({ db, close } = await testDatabase(kind)); resend = await startFakeResend(); }, 60_000);
  beforeEach(async () => {
    await resetDatabase(db); resend.reset();
    identity = createIdentityServices({ db, secret: "team-invite-fixture-secret-over-32-characters", appUrl: BASE });
    registry = new OutboxRegistry();
    registerEmailHandlers(registry, { baseUrl: BASE, resend: { apiKey: "local-fake-only", apiUrl: resend.url }, db });
    await q().query("insert into staff(email,role) values('owner@didit.me','owner'),('admin@didit.me','admin')");
    await q().query("insert into accounts(email,first_name,last_name) values('admin@didit.me','Alberto','Rosas')");
    owner = await as("owner@didit.me"); admin = await as("admin@didit.me");
  });
  afterEach(() => resend.reset());
  afterAll(async () => { await resend?.close(); await close?.(); });

  it("a new invite queues one T-01 email in the same transaction and it reaches Resend with sender, reply-to, HTML and text", async () => {
    await identity.auth.inviteStaff(admin, " Uma.Bramwell@didit.me ", "staff");
    const [row] = await invites();
    expect(row!.dedupe_key).toMatch(/^email:T-01:uma\.bramwell@didit\.me:invite:\d+$/);
    expect(row!.payload).toMatchObject({ code: "T-01", to: "uma.bramwell@didit.me", data: { role: "staff", adminUrl: "/admin", inviteeEmail: "uma.bramwell@didit.me", inviter: { name: "Alberto Rosas", email: "admin@didit.me" } } });
    await drain();
    expect(resend.calls).toHaveLength(1);
    const { headers, body } = resend.calls[0]!;
    expect(headers["idempotency-key"]).toBe(row!.dedupe_key);
    expect(body).toMatchObject({ from: "Didit Events <events@updates.didit.me>", to: ["uma.bramwell@didit.me"], reply_to: "events@example.com", subject: "Alberto Rosas invited you to Didit Events", tags: [{ name: "code", value: "T_01" }] });
    expect(body.html).toContain(`href="${BASE}/admin"`);
    expect(body.html).toContain("Open Didit Events admin");
    expect(body.text).toContain(`Open Didit Events admin: ${BASE}/admin`);
    expect(body.text).toContain(ROLE_SUMMARY.staff);
    for (const line of ROLE_CAN.staff) expect(body.text).toContain(line);
    expect((await invites())[0]!.status).toBe("sent");
  });

  it("is idempotent per invite: a repeated invite or a role change on an existing member sends nothing new", async () => {
    await identity.auth.inviteStaff(owner, "new@didit.me", "staff");
    await identity.auth.inviteStaff(owner, "new@didit.me", "admin");
    await identity.auth.inviteStaff(owner, "admin@didit.me", "staff");
    expect(await invites()).toHaveLength(1);
    await drain(); await drain();
    expect(resend.calls).toHaveLength(1);
  });

  it("a failed invite saves neither the staff row nor the email", async () => {
    await expect(identity.auth.inviteStaff(admin, "boss@didit.me", "owner")).rejects.toMatchObject({ code: "OwnerRequired" });
    expect(await q().query("select email from staff where email='boss@didit.me'")).toHaveLength(0);
    expect(await invites()).toHaveLength(0);
  });

  it("resend: a pending member gets the email again, once a minute at most", async () => {
    await identity.auth.inviteStaff(admin, "new@didit.me", "staff");
    await expect(identity.team.resendStaffInvite(admin, "new@didit.me")).rejects.toMatchObject({ code: "InviteCooldown", status: 429 });
    await q().query("update outbox set created_at=created_at-$1 * interval '1 second'", [INVITE_RESEND_COOLDOWN_SEC + 1]);
    await identity.team.resendStaffInvite(admin, " NEW@didit.me ");
    await expect(identity.team.resendStaffInvite(admin, "new@didit.me")).rejects.toMatchObject({ code: "InviteCooldown" });
    const rows = await invites();
    expect(rows).toHaveLength(2);
    expect(rows[1]!.dedupe_key).toMatch(/^email:T-01:new@didit\.me:resend:\d+$/);
    expect(await q().query("select action from audit where target='new@didit.me' order by created_at")).toEqual([{ action: "staff.invited_or_role_changed" }, { action: "staff.invite_resent" }]);
    await drain();
    expect(resend.calls.map(c => c.body.to)).toEqual([["new@didit.me"], ["new@didit.me"]]);
  });

  it("resend refuses signed-in, disabled, unknown and owner targets for admins, and staff callers", async () => {
    await q().query("insert into staff(email,role) values('seen@didit.me','staff'),('gone@didit.me','staff'),('boss@didit.me','owner'),('plain@didit.me','staff')");
    await q().query("update staff set disabled_at=clock_timestamp() where email='gone@didit.me'");
    const [account] = await q().query<{ id: string }>("insert into accounts(email) values('seen@didit.me') returning id");
    await q().query("insert into sessions(token_hash,principal,auth_method,account_id,expires_at) values('h-seen','guest','email_otp',$1,clock_timestamp()+interval '1 day')", [account!.id]);
    await expect(identity.team.resendStaffInvite(admin, "seen@didit.me")).rejects.toMatchObject({ code: "AlreadySignedIn" });
    await expect(identity.team.resendStaffInvite(admin, "gone@didit.me")).rejects.toMatchObject({ code: "StaffNotFound" });
    await expect(identity.team.resendStaffInvite(admin, "nobody@didit.me")).rejects.toMatchObject({ code: "StaffNotFound" });
    await expect(identity.team.resendStaffInvite(admin, "boss@didit.me")).rejects.toMatchObject({ code: "OwnerRequired" });
    await expect(identity.team.resendStaffInvite(await as("plain@didit.me"), "boss@didit.me")).rejects.toMatchObject({ code: "StaffForbidden" });
    await identity.team.resendStaffInvite(owner, "boss@didit.me");
    expect((await invites()).map(r => r.payload.to)).toEqual(["boss@didit.me"]);
  });
});

describe("T-01 template", () => {
  const data = { baseUrl: BASE, inviteeEmail: "uma.bramwell@didit.me", inviter: { email: "events.owner@didit.me" }, role: "admin" as const, adminUrl: `${BASE}/admin` };
  it("falls back to the inviter's email and describes the role with the Team page lines", () => {
    const out = renderEmail("T-01", data);
    expect(out.from).toEqual({ name: "Didit Events", address: "events@example.com" });
    expect(out.subject).toBe("events.owner@didit.me invited you to Didit Events");
    expect(out.text).toContain("events.owner@didit.me invited you to the Didit Events admin as Admin.");
    expect(out.text).toContain(ROLE_SUMMARY.admin);
    for (const line of ROLE_CAN.admin) expect(out.text).toContain(line);
    expect(out.text).toContain("Sign in: Google, as uma.bramwell@didit.me");
    expect(out.html).toContain('width="100%"');
    expect(out.html).toMatch(/<a href="https:\/\/events\.didit\.me\/admin"[^>]*>Open Didit Events admin<\/a>/);
  });
  it("escapes an inviter name", () => {
    const out = renderEmail("T-01", { ...data, inviter: { name: "<b>Eve</b> & co", email: "eve@didit.me" } });
    expect(out.html).not.toContain("<b>Eve</b>");
    expect(out.html).toContain("&lt;b&gt;Eve&lt;/b&gt; &amp; co");
  });
});
