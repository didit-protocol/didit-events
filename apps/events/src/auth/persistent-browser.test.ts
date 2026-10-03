import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createIdentityServices } from "@didit-events/core/identity";
import { queryable } from "@didit-events/core/db/tx";
import { testDatabase, resetDatabase } from "@didit-events/core/testing/database";
import { accountSession } from "@didit-events/core/testing/account-session";
import { skipPostgres } from "@didit-events/core/testing/postgres";
import { SESSION_TTL_SECONDS } from "@didit-events/core/identity/shared";
import { proxy } from "../../proxy";
import { guardBrowser } from "./browser";

const state = vi.hoisted(() => ({ identity: undefined as ReturnType<typeof createIdentityServices> | undefined }));
vi.mock("./runtime", () => ({ get identity() { return state.identity!; } }));
const origin = "https://events.test", secret = "browser-session-test-secret-longer-than-32-characters";
describe.skipIf(skipPostgres)("persistent browser request adapter (Postgres, no browser)", () => {
  let database: Awaited<ReturnType<typeof testDatabase>>;
  const q = () => queryable(database.db);
  beforeAll(async () => { database = await testDatabase("postgres"); }, 60000);
  beforeEach(async () => {
    await resetDatabase(database.db);
    vi.stubEnv("SESSION_SECRET", secret); vi.stubEnv("APP_URL", origin);
    state.identity = createIdentityServices({ db: database.db, secret });
  });
  afterEach(() => vi.unstubAllEnvs()); afterAll(async () => database?.close());
  const request = (path: string, sid?: string, csrf?: string, method = "GET") => new NextRequest(`${origin}${path}`, { method, headers: sid ? { cookie: `__Host-sid=${sid}; __Host-csrf=${csrf ?? ""}` } : {} });
  it.each(["GET", "HEAD"])("%s refresh sets 400-day host cookies once daily, passes the successor to SSR and preserves open-form CSRF", async method => {
    const issued = await accountSession(state.identity!, database.db, "ops@didit.me");
    await q().query("update sessions set created_at=clock_timestamp()-interval '2 days' where id=$1", [issued.session.id]);
    const requests = [request("/events", issued.cookie, undefined, method), request("/events", issued.cookie, undefined, method)] as const;
    const [one, two] = await Promise.all([proxy(requests[0]), proxy(requests[1])]);
    const sid = one.cookies.get("__Host-sid")!, csrf = one.cookies.get("__Host-csrf")!;
    expect(sid.value).not.toBe(issued.cookie); expect(sid.value).toBe(two.cookies.get("__Host-sid")?.value);
    expect(sid).toMatchObject({ maxAge: SESSION_TTL_SECONDS, secure: true, httpOnly: true, sameSite: "lax", path: "/" });
    expect(csrf).toMatchObject({ maxAge: SESSION_TTL_SECONDS, value: issued.session.csrfToken, secure: true, httpOnly: false });
    const successors = await q().query<{ id: string }>("select id from sessions where rotated_from=$1", [issued.session.id]);
    expect(successors).toHaveLength(1);
    for (const req of requests) {
      expect(req.cookies.get("__Host-sid")?.value).toBe(sid.value);
      expect(await state.identity!.auth.requireGuest(req.cookies.get("__Host-sid")!.value)).toMatchObject({ sessionId: successors[0]!.id, accountId: issued.session.accountId });
    }
    const next = await proxy(request("/events", sid.value, csrf.value));
    expect(next.cookies.get("__Host-sid")).toBeUndefined(); expect(next.cookies.get("__Host-csrf")).toBeUndefined();
    const mutation = new Request(`${origin}/me/settings`, { method: "POST", body: "{}", headers: { origin, cookie: `__Host-sid=${sid.value}; __Host-csrf=${csrf.value}`, "x-csrf": csrf.value } });
    expect((await guardBrowser(mutation)).sessionCookie).toBe(sid.value);
  });
  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])("%s leaves a due session and incoming CSRF proof intact without setting cookies", async method => {
    const issued = await accountSession(state.identity!, database.db, "guest@example.test");
    await q().query("update sessions set created_at=clock_timestamp()-interval '2 days' where id=$1", [issued.session.id]);
    const req = new NextRequest(`${origin}/me/settings`, { method, headers: { origin, cookie: `__Host-sid=${issued.cookie}; __Host-csrf=${issued.session.csrfToken}`, "x-csrf": issued.session.csrfToken! } });
    const response = await proxy(req);
    expect(req.cookies.get("__Host-sid")?.value).toBe(issued.cookie);
    expect(req.cookies.get("__Host-csrf")?.value).toBe(issued.session.csrfToken);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.cookies.get("__Host-sid")).toBeUndefined();
    expect(response.cookies.get("__Host-csrf")).toBeUndefined();
    expect(await q().query("select id from sessions where rotated_from=$1", [issued.session.id])).toHaveLength(0);
    expect(await q().query("select rotated_at,revoked_at from sessions where id=$1", [issued.session.id])).toEqual([{ rotated_at: null, revoked_at: null }]);
    if (method !== "OPTIONS") expect((await guardBrowser(req)).sessionCookie).toBe(issued.cookie);
    expect(await state.identity!.auth.requireGuest(issued.cookie)).toMatchObject({ sessionId: issued.session.id, accountId: issued.session.accountId });
  });
  it("POST guards resolve the presented token during rotation grace without proxy cookies", async () => {
    const issued = await accountSession(state.identity!, database.db, "guest@example.test");
    await q().query("update sessions set created_at=clock_timestamp()-interval '2 days' where id=$1", [issued.session.id]);
    const rotated = (await state.identity!.sessions.refresh(issued.cookie))!;
    const req = new NextRequest(`${origin}/me/settings`, { method: "POST", headers: { origin, cookie: `__Host-sid=${issued.cookie}; __Host-csrf=${issued.session.csrfToken}`, "x-csrf": issued.session.csrfToken! } });
    const response = await proxy(req);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect((await guardBrowser(req)).sessionCookie).toBe(issued.cookie);
    expect(await state.identity!.auth.requireGuest(issued.cookie)).toMatchObject({ sessionId: rotated.session.id, accountId: issued.session.accountId });
  });
  it("GET recovers a lost rotation response after grace and revokes only after direct successor use", async () => {
    const issued = await accountSession(state.identity!, database.db, "guest@example.test");
    await q().query("update sessions set created_at=clock_timestamp()-interval '2 days' where id=$1", [issued.session.id]);
    const lost = await proxy(request("/events", issued.cookie));
    await q().query("update sessions set rotated_at=clock_timestamp()-interval '31 seconds' where id=$1", [issued.session.id]);
    const recovered = await proxy(request("/events", issued.cookie));
    const sid = recovered.cookies.get("__Host-sid")!.value;
    expect(sid).toBe(lost.cookies.get("__Host-sid")!.value);
    expect(recovered.cookies.get("__Host-sid")).toMatchObject({ maxAge: SESSION_TTL_SECONDS });
    const successors = await q().query<{ id: string; delivered_at: Date | null; revoked_at: Date | null }>("select id,delivered_at,revoked_at from sessions where rotated_from=$1", [issued.session.id]);
    expect(successors).toEqual([{ id: expect.any(String), delivered_at: null, revoked_at: null }]);
    expect(await state.identity!.auth.requireGuest(sid)).toMatchObject({ sessionId: successors[0]!.id, accountId: issued.session.accountId });
    expect(await q().query("select delivered_at from sessions where id=$1", [successors[0]!.id])).toEqual([{ delivered_at: expect.any(Date) }]);
    const reused = await proxy(request("/events", issued.cookie));
    expect(reused.cookies.get("__Host-sid")).toMatchObject({ value: "", maxAge: 0 });
    expect(await state.identity!.sessions.resolve(issued.cookie)).toBeNull();
    expect(await state.identity!.sessions.resolve(sid)).toBeNull();
    expect(await q().query("select id from sessions where id in ($1,$2) and revoked_at is null", [issued.session.id, successors[0]!.id])).toHaveLength(0);
  });
  it("staff account enters admin, disabled or nonstaff account goes to forbidden, missing session preserves full next", async () => {
    const path = "/admin/events/example/guests?add=paste";
    expect((await proxy(request(path))).headers.get("location")).toBe(`${origin}/login?next=${encodeURIComponent(path)}`);
    expect((await proxy(request("/admin/forbidden"))).headers.get("location")).toBe(`${origin}/login?next=%2Fadmin%2Fforbidden`);
    const issued = await accountSession(state.identity!, database.db, "ops@didit.me");
    expect((await proxy(request(path, issued.cookie))).headers.get("location")).toBe(`${origin}/admin/forbidden?next=${encodeURIComponent(path)}`);
    await q().query("insert into staff(email,role) values('ops@didit.me','staff')");
    expect((await proxy(request(path, issued.cookie))).headers.get("location")).toBeNull();
    await q().query("update staff set disabled_at=clock_timestamp() where email=$1", ["ops@didit.me"]);
    expect((await proxy(request(path, issued.cookie))).headers.get("location")).toContain("/admin/forbidden?");
    expect(await state.identity!.auth.requireGuest(issued.cookie)).toBeTruthy();
    expect((await proxy(request("/admin/forbidden", issued.cookie))).headers.get("location")).toBeNull();
  });
  it("an onboarding deep link to an event's join modal is a real 307 (signed in or not, cookies still set); others render", async () => {
    const to = (path: string, sid?: string) => proxy(request(path, sid));
    const anonymous = await to(`/onboarding?returnTo=${encodeURIComponent("/e/ai-era?join=1")}`);
    expect(anonymous.status).toBe(307);
    expect(anonymous.headers.get("location")).toBe(`${origin}/e/ai-era?join=1`);
    expect(anonymous.headers.getSetCookie().some(c => c.startsWith("__Host-csrf="))).toBe(true);
    const issued = await accountSession(state.identity!, database.db, "ops@didit.me");
    expect((await to(`/onboarding?next=${encodeURIComponent("/e/ai-era/register")}`, issued.cookie)).headers.get("location")).toBe(`${origin}/e/ai-era?join=1`);
    for (const path of ["/onboarding", `/onboarding?returnTo=${encodeURIComponent("/me/events")}`, `/onboarding?returnTo=${encodeURIComponent("https://evil.test/e/x?join=1")}`]) {
      expect((await to(path, issued.cookie)).headers.get("location"), path).toBeNull();
    }
  });
});
