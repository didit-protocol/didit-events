import { accountSession } from "@didit-events/core/testing/account-session";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createIdentityServices } from "@didit-events/core/identity";
import { testDatabase, resetDatabase } from "@didit-events/core/testing/database";
import { queryable } from "@didit-events/core/db/tx";
import { csrfToken } from "../../../src/auth/browser";
import { inviteStaffAction, disableStaffAction, resendInviteAction, restoreStaffAction } from "./actions";
import { INVITE_ERRORS } from "../../../src/admin/team/policy";
import { createTools } from "../../../src/mcp/tools";
import { findMember, getTeam } from "./data";
import { getStaff } from "../data";
import LoginPage from "../login/page";
import { signOutAction } from "../../me/settings/actions";

const state = vi.hoisted(() => ({ identity: undefined as ReturnType<typeof createIdentityServices> | undefined, cookie: "", csrf: "", origin: "https://events.didit.me" }));
vi.mock("../../../src/auth/runtime", () => ({ get identity() { return state.identity!; } }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({ forbidden: () => { throw Object.assign(new Error("Forbidden"), { status: 403 }); }, redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => name === "__Host-sid" && state.cookie ? { value: state.cookie } : undefined, set: (name: string, value: string) => { if (name === "__Host-sid") state.cookie = value; if (name === "__Host-csrf") state.csrf = value; } }),
  headers: async () => new Headers({ origin: state.origin, cookie: `__Host-sid=${state.cookie}; __Host-csrf=${state.csrf}` }),
}));
const secret = "team-boundary-fixture-secret-over-32-characters", origin = "https://events.didit.me";
const kinds = ["pglite", ...(process.env.TEST_DATABASE_URL ? ["postgres"] : [])] as ("pglite" | "postgres")[];
for (const kind of kinds) describe(`team action boundaries ${kind}`, () => {
  let database: Awaited<ReturnType<typeof testDatabase>>;
  const q = () => queryable(database.db);
  beforeAll(async () => { database = await testDatabase(kind); }, 60_000);
  beforeEach(async () => {
    await resetDatabase(database.db);
    state.identity = createIdentityServices({ db: database.db, secret, appUrl: origin });
    state.cookie = ""; state.csrf = ""; state.origin = origin;
    vi.stubEnv("APP_URL", origin); vi.stubEnv("SESSION_SECRET", secret);
    await q().query("insert into staff(email,role) values('owner@didit.me','owner'),('admin@didit.me','admin'),('staff@didit.me','staff'),('target@didit.me','staff')");
    await login("admin");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => { await database?.close(); });
  async function login(role: "owner" | "admin" | "staff") {
    const result = await accountSession(state.identity!, database.db, `${role}@didit.me`);
    state.cookie = result.cookie; state.csrf = csrfToken(result.cookie, secret);
    return result.session;
  }
  const form = (email: string, role = "staff") => {
    const f = new FormData(); f.set("csrf", state.csrf); f.set("email", email); f.set("role", role); return f;
  };
  const invite = (email: string, role = "staff") => inviteStaffAction({ status: "idle" }, form(email, role));
  async function unchangedTeam() {
    expect(await q().query("select email,role,disabled_at from staff order by email")).toEqual([
      { email: "admin@didit.me", role: "admin", disabled_at: null }, { email: "owner@didit.me", role: "owner", disabled_at: null },
      { email: "staff@didit.me", role: "staff", disabled_at: null }, { email: "target@didit.me", role: "staff", disabled_at: null },
    ]);
    for (const table of ["audit", "outbox", "spend"]) expect(await q().query(`select id from ${table}`)).toHaveLength(0);
  }
  it.each(["outsider@example.test", "person@didit.me.evil.test", "person@notdidit.me"])("rejects non-staff domain %s server-side", async email => {
    expect(await invite(email)).toMatchObject({ status: "invalid", errors: { email: "Use a @didit.me address." } });
    await unchangedTeam();
  });
  it.each(["owner", "admin"])("staff cannot invite or promote anyone to %s", async role => {
    await login("staff");
    for (const email of ["new@didit.me", "target@didit.me"]) await expect(invite(email, role)).rejects.toMatchObject({ status: 403 });
    await unchangedTeam();
  });
  it("admin cannot mint an owner or promote an existing staff member to owner", async () => {
    for (const email of ["new@didit.me", "target@didit.me"]) expect(await invite(email, "owner")).toMatchObject({ status: "invalid", errors: { role: "Choose a role." } });
    await unchangedTeam();
  });
  it("disabled staff cannot invite, disable or restore using a still-signed session cookie", async () => {
    await q().query("update staff set disabled_at=clock_timestamp() where email='admin@didit.me'");
    expect(await getStaff()).toBeNull();
    await expect(invite("new@didit.me", "admin")).rejects.toThrow("REDIRECT:/admin/forbidden?next=%2Fadmin%2Fteam");
    await expect(disableStaffAction("target@didit.me", state.csrf)).rejects.toThrow("REDIRECT:/admin/forbidden?next=%2Fadmin%2Fteam");
    await expect(restoreStaffAction(form("target@didit.me"))).rejects.toThrow("REDIRECT:/admin/forbidden?next=%2Fadmin%2Fteam");
    expect(await q().query("select email from staff where disabled_at is not null")).toEqual([{ email: "admin@didit.me" }]);
    expect(await q().query("select email from staff where email='new@didit.me'")).toHaveLength(0);
    expect(await q().query("select id from audit")).toHaveLength(0);
    expect(await q().query("select id from outbox")).toHaveLength(0);
  });
  it("enforces CSRF and exact Origin before any team mutation", async () => {
    const f = form("new@didit.me"); f.delete("csrf");
    await expect(inviteStaffAction({ status: "idle" }, f)).rejects.toMatchObject({ status: 403 });
    await expect(disableStaffAction("target@didit.me", "wrong")).rejects.toMatchObject({ status: 403 });
    state.origin = "https://attacker.test";
    await expect(invite("new@didit.me")).rejects.toMatchObject({ status: 403 });
    await unchangedTeam();
  });
  it("creates a normalized staff invitation and retains the existing-member response", async () => {
    expect(await invite("  NEW@DIDIT.ME  ")).toEqual({ status: "sent", email: "new@didit.me" });
    expect(await q().query("select role,invited_by from staff where email='new@didit.me'")).toEqual([{ role: "staff", invited_by: "admin@didit.me" }]);
    expect(await invite("NEW@DIDIT.ME")).toMatchObject({ status: "invalid", errors: { email: "new@didit.me is already on the team." } });
    expect(await q().query("select action from audit")).toEqual([{ action: "staff.invited_or_role_changed" }]);
  });
  const inviteEmails = () => q().query<{ payload: { to: string; data: { role: string } } }>("select payload from outbox where kind='email:T-01' order by created_at,id");
  it("Send invite queues the T-01 email before reporting sent; a failure saves nothing and says so", async () => {
    expect(await invite("uma.bramwell@didit.me", "admin")).toEqual({ status: "sent", email: "uma.bramwell@didit.me" });
    expect((await inviteEmails()).map(r => [r.payload.to, r.payload.data.role])).toEqual([["uma.bramwell@didit.me", "admin"]]);
    const spy = vi.spyOn(state.identity!.auth, "inviteStaff").mockRejectedValueOnce(new Error("outbox down"));
    expect(await invite("next@didit.me")).toEqual({ status: "failed", email: "next@didit.me", role: "staff", message: INVITE_ERRORS.failed("next@didit.me") });
    spy.mockRestore();
    expect(await q().query("select email from staff where email='next@didit.me'")).toHaveLength(0);
    expect(await inviteEmails()).toHaveLength(1);
  });
  it("Resend invite emails a pending member again with a one-minute cooldown, never a signed-in one", async () => {
    await invite("new@didit.me");
    expect(await resendInviteAction("new@didit.me", state.csrf)).toEqual({ error: "cooldown" });
    await q().query("update outbox set created_at=created_at-interval '61 seconds'");
    expect(await resendInviteAction("new@didit.me", state.csrf)).toEqual({ ok: true });
    expect(await resendInviteAction("new@didit.me", state.csrf)).toEqual({ error: "cooldown" });
    expect((await inviteEmails()).map(r => r.payload.to)).toEqual(["new@didit.me", "new@didit.me"]);
    await accountSession(state.identity!, database.db, "target@didit.me");
    expect(await resendInviteAction("target@didit.me", state.csrf)).toEqual({ error: "signed_in" });
    expect(await resendInviteAction("owner@didit.me", state.csrf)).toEqual({ error: "forbidden" }); // admins never resend to owners
    expect(await resendInviteAction("ghost@didit.me", state.csrf)).toEqual({ error: "not_found" });
    await expect(resendInviteAction("new@didit.me", "wrong")).rejects.toMatchObject({ status: 403 });
    await login("staff");
    await expect(resendInviteAction("new@didit.me", state.csrf)).rejects.toMatchObject({ status: 403 });
    expect(await inviteEmails()).toHaveLength(2);
  });
  it("MCP team_invite queues the same invite email", async () => {
    const actor = await state.identity!.auth.requireStaff(state.cookie);
    await createTools(database.db).call("team_invite", { email: "mcp@didit.me", role: "staff" }, { ...actor, tokenName: "test" } as never);
    expect((await inviteEmails()).map(r => r.payload.to)).toEqual(["mcp@didit.me"]);
  });
  it("an owner can invite an owner; admin cannot disable an owner or themselves", async () => {
    expect(await disableStaffAction("owner@didit.me", state.csrf)).toEqual({ error: "forbidden" });
    expect(await disableStaffAction("admin@didit.me", state.csrf)).toEqual({ error: "forbidden" });
    await unchangedTeam();
    await login("owner");
    expect(await invite("second-owner@didit.me", "owner")).toMatchObject({ status: "sent" });
    expect(await q().query("select role from staff where email='second-owner@didit.me'")).toEqual([{ role: "owner" }]);
  });
  it("disable removes staff access and restore restores it without ending the account session", async () => {
    const target = await accountSession(state.identity!, database.db, "target@didit.me");
    expect(await disableStaffAction(" TARGET@didit.me ", state.csrf)).toEqual({ ok: true });
    expect(await findMember("target@didit.me")).toMatchObject({ disabledAt: expect.any(String) });
    expect(await state.identity!.auth.requireGuest(target.cookie)).toBeTruthy();
    await restoreStaffAction(form("target@didit.me"));
    expect(await findMember("target@didit.me")).toMatchObject({ role: "staff", disabledAt: null });
    expect(await state.identity!.auth.requireStaff(target.cookie)).toMatchObject({ role: "staff" });
    expect(await q().query("select action from audit order by created_at")).toEqual([{ action: "staff.disabled" }, { action: "staff.restored" }]);
  });
  it("staff logout revokes the real session and clears its browser cookies", async () => {
    const cookie = state.cookie;
    expect(await getStaff()).toMatchObject({ email: "admin@didit.me", role: "admin" });
    await expect(signOutAction(form(""))).rejects.toThrow("REDIRECT:/events");
    expect(await state.identity!.sessions.resolve(cookie)).toBeNull();
    expect(state.cookie).toBe(""); expect(state.csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(LoginPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/login?next=%2Fadmin");
    expect(await q().query("select id from sessions where revoked_at is not null")).toHaveLength(1);
  });
  it("staff viewers retain read-only team access but get 403 for all four management actions", async () => {
    await login("staff"); expect(await getTeam()).toHaveLength(4);
    await expect(invite("new@didit.me")).rejects.toMatchObject({ status: 403 });
    await expect(disableStaffAction("target@didit.me", state.csrf)).rejects.toMatchObject({ status: 403 });
    await expect(restoreStaffAction(form("target@didit.me"))).rejects.toMatchObject({ status: 403 });
    await expect(resendInviteAction("target@didit.me", state.csrf)).rejects.toMatchObject({ status: 403 });
    await unchangedTeam();
  });
});
