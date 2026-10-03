import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Children, type ReactElement, type ReactNode } from "react";
import { NextRequest } from "next/server";
import type * as NextServer from "next/server";
import { identity, type Db, type StaffPrincipal } from "@didit-events/core";
import { fakeDiditServer } from "@didit-events/core/didit/fake-server";
import { doorService } from "@didit-events/core/door/service";
import { queryable } from "@didit-events/core/db/tx";
import { COOKIE_NAMES } from "@didit-events/core/http/policy";
import { accountSession } from "@didit-events/core/testing/account-session";
import { resetDatabase, seed, testDatabase } from "@didit-events/core/testing/database";
import { csrfToken } from "../auth/browser";

// Real guards, routes, services and database; only Next's cookie/header plumbing and the Didit host are substituted.
const request = vi.hoisted(() => ({ jar: new Map<string, string>(), origin: "https://events.test" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => request.jar.has(name) ? { value: request.jar.get(name)! } : undefined,
    set: (name: string, value: string, options: { maxAge?: number }) => { if (options?.maxAge === 0) request.jar.delete(name); else request.jar.set(name, value); },
  }),
  headers: async () => new Headers({ origin: request.origin, cookie: [...request.jar].map(([k, v]) => `${k}=${v}`).join("; "), "x-forwarded-for": "192.0.2.42" }),
}));
vi.mock("next/server", async original => ({ ...await original<typeof NextServer>(), connection: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const secret = "door-routes-session-secret-longer-than-thirty-two";
const JPEG = new Uint8Array([255, 216, 255, 224, 1, 2, 3]);
const ORIGIN = "https://events.test";
type Cookies = Record<string, string>;
const cookieHeader = (c: Cookies) => Object.entries(c).map(([k, v]) => `${k}=${v}`).join("; ");
const setCookies = (res: Response) => Object.fromEntries(res.headers.getSetCookie().map(line => { const [pair] = line.split(";"); const i = pair!.indexOf("="); return [pair!.slice(0, i), decodeURIComponent(pair!.slice(i + 1))]; }));
const digestOf = (error: unknown) => (error as { digest?: string }).digest ?? String(error);

describe("door mode and event roles (real guards)", () => {
  let db: Db, close: () => Promise<void>, fake: Awaited<ReturnType<typeof fakeDiditServer>>, ids: Awaited<ReturnType<typeof seed>>, slug: string, otherSlug: string;
  const q = () => queryable(db);
  const globalDb = globalThis as typeof globalThis & { __diditEventsDb?: Db };
  beforeAll(async () => { ({ db, close } = await testDatabase(process.env.TEST_DATABASE_URL ? "postgres" : "pglite")); globalDb.__diditEventsDb = db; fake = await fakeDiditServer(); }, 60_000);
  afterAll(async () => { await fake?.close(); delete globalDb.__diditEventsDb; await close?.(); });
  afterEach(() => { vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv("SESSION_SECRET", secret); vi.stubEnv("APP_URL", ORIGIN); vi.stubEnv("DIDIT_API_KEY", "fixture-only"); vi.stubEnv("DIDIT_API_URL", fake.url);
    fake.state.matches = []; fake.state.calls = { search: 0, liveness: 0 }; fake.state.searchStatus = 200;
    await resetDatabase(db); request.jar.clear(); request.origin = ORIGIN;
    ids = await seed(db); const other = await seed(db);
    // The event is published and starts tomorrow: the door is closed, Test mode works.
    await q().query("update events set slug='doors-open',status='published',starts_at=clock_timestamp()+interval '1 day',ends_at=clock_timestamp()+interval '2 days' where id=$1", [ids.eventId]);
    await q().query("update events set slug='other-event' where id=$1", [other.eventId]);
    slug = "doors-open"; otherSlug = "other-event";
    await q().query("insert into staff(email,role) values('owner@didit.me','owner')");
  });
  async function member(role: "host" | "operator", eventId = ids.eventId) {
    const email = `${role}-${randomUUID().slice(0, 6)}@example.test`;
    const session = await accountSession(identity, db, email);
    await q().query("insert into event_members(event_id,email,role,invited_by) values($1,$2,$3,'owner@didit.me')", [eventId, email, role]);
    return { email, cookie: session.cookie, sessionId: session.session.id };
  }
  const browser = (cookies: Cookies, csrfBinding?: string) => ({ ...cookies, [COOKIE_NAMES.csrf]: csrfToken(csrfBinding ?? cookies[COOKIE_NAMES.session] ?? cookies[COOKIE_NAMES.door]!, secret) });
  const post = (path: string, cookies: Cookies, body: BodyInit, type: string, extra: Record<string, string> = {}) => new Request(`${ORIGIN}${path}`, { method: "POST", body, headers: { origin: ORIGIN, "content-type": type, cookie: cookieHeader(cookies), "x-csrf": cookies[COOKIE_NAMES.csrf] ?? "", ...extra } });
  const get = (path: string, cookies: Cookies, extra: Record<string, string> = {}) => new Request(`${ORIGIN}${path}`, { headers: { cookie: cookieHeader(cookies), "x-csrf": cookies[COOKIE_NAMES.csrf] ?? "", ...extra } });
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const routes = async () => ({
    start: await import("../../app/api/door/[id]/start/route"),
    context: await import("../../app/api/door/[id]/context/route"),
    scan: await import("../../app/api/door/[id]/scan/route"),
    exit: await import("../../app/api/door/[id]/exit/route"),
    signInExit: await import("../../app/admin/(door)/events/[id]/door/exit/route"),
  });
  async function startDoor(who: { cookie: string; sessionId: string }, station = "Main door") {
    const r = await routes();
    const res = await r.start.POST(post(`/api/door/${slug}/start`, browser({ [COOKIE_NAMES.session]: who.cookie }), JSON.stringify({ station }), "application/json"), params(slug));
    expect(res.status, await res.clone().text()).toBe(200);
    const set = setCookies(res);
    return { res, door: set[COOKIE_NAMES.door]!, set };
  }

  it("an operator starts door mode: the admin session is revoked and replaced by a door cookie that only opens this door", async () => {
    const operator = await member("operator"), r = await routes();
    const { door, set } = await startDoor(operator);
    expect(set[COOKIE_NAMES.session]).toBe("");
    expect(set[COOKIE_NAMES.csrf]).toBe(csrfToken(door, secret));
    expect(await q().query("select revoked_at is not null as revoked from sessions where id=$1", [operator.sessionId])).toEqual([{ revoked: true }]);
    const cookies = browser({ [COOKIE_NAMES.door]: door });
    const context = await (await r.context.GET(get(`/api/door/${slug}/context`, cookies), params(slug))).json();
    expect(context).toMatchObject({ state: "not_started", station: { name: "Main door" }, session: { startedBy: operator.email }, pinSet: false, build: expect.any(String) });
    // The door cookie is no admin session: every admin guard sends the browser to sign in.
    request.jar.set(COOKIE_NAMES.door, door);
    const list = await import("../../app/admin/(events)/(list)/data");
    await expect(list.listEvents()).rejects.toSatisfy((e: unknown) => digestOf(e).includes("/login?next="));
    const guests = await import("../../app/admin/(events)/events/[id]/(tabs)/guests/data");
    await expect(guests.allGuests(slug)).rejects.toSatisfy((e: unknown) => digestOf(e).includes("/login?next="));
    const live = await import("../../app/api/admin/events/[id]/live/route");
    expect((await live.GET(get(`/api/admin/events/${slug}/live`, cookies), params(slug))).status).toBe(401);
    // The proxy treats a door browser as signed out everywhere except the door.
    const { proxy } = await import("../../proxy");
    const admin = await proxy(new NextRequest(`${ORIGIN}/admin/events/${slug}/guests`, { headers: { cookie: cookieHeader(cookies) } }));
    expect(admin.headers.get("location")).toContain("/login?next=");
    const kiosk = await proxy(new NextRequest(`${ORIGIN}/admin/events/${slug}/door/kiosk`, { headers: { cookie: cookieHeader(cookies) } }));
    expect(kiosk.headers.get("location")).toBeNull();
    // The Door tab is an admin page: a door device that reloads on it (a door opened before the kiosk had its own
    // URL) is sent to its kiosk.
    const tab = await proxy(new NextRequest(`${ORIGIN}/admin/events/${slug}/door`, { headers: { cookie: cookieHeader(cookies) } }));
    expect(tab.headers.get("location")).toBe(`${ORIGIN}/admin/events/${slug}/door/kiosk`);
    // Another event's door, a foreign Origin or a missing CSRF header are refused.
    expect((await r.context.GET(get(`/api/door/${otherSlug}/context`, cookies), params(otherSlug))).status).toBe(403);
    expect((await r.scan.POST(post(`/api/door/${slug}/scan`, cookies, JPEG, "image/jpeg", { origin: "https://evil.test" }), params(slug))).status).toBe(403);
    expect((await r.scan.POST(post(`/api/door/${slug}/scan`, { [COOKIE_NAMES.door]: door }, JPEG, "image/jpeg"), params(slug))).status).toBe(403);
    // Another page opened in this browser re-binds __Host-csrf to an anonymous cookie: the door's own token (rendered
    // by the door page) still works; the re-bound cookie value is not a door token.
    const rebound = { [COOKIE_NAMES.door]: door, [COOKIE_NAMES.csrf]: csrfToken("anonymous-binding", secret) };
    expect((await r.context.GET(get(`/api/door/${slug}/context`, rebound, { "x-csrf": csrfToken(door, secret) }), params(slug))).status).toBe(200);
    expect((await r.context.GET(get(`/api/door/${slug}/context`, rebound), params(slug))).status).toBe(403);
    expect(fake.state.calls.search).toBe(0);
  });

  it("the Door tab is always the tab; the kiosk renders only at /door/kiosk with this device's live door session", async () => {
    const operator = await member("operator"), r = await routes();
    const tabPage = (await import("../../app/admin/(events)/events/[id]/(tabs)/door/page")).default;
    const kioskPage = (await import("../../app/admin/(door)/events/[id]/door/kiosk/page")).default;
    const { DoorRunningHere } = await import("./DoorAdmin"), { DoorLauncher } = await import("./DoorLauncher"), { LazyDoorApp } = await import("./LazyDoorApp");
    const { endDoorHereAction } = await import("../../app/admin/(door)/events/[id]/door/actions");
    const page = { params: Promise.resolve({ id: slug }), searchParams: Promise.resolve({}) };
    type Node = ReactElement<{ children?: ReactNode; station?: string; notice?: string }>;
    const first = async () => Children.toArray((await tabPage(page) as Node).props.children)[0] as Node;
    const signIn = async () => { const fresh = await accountSession(identity, db, operator.email); request.jar.set(COOKIE_NAMES.session, fresh.cookie); request.jar.set(COOKIE_NAMES.csrf, csrfToken(fresh.cookie, secret)); return fresh; };
    const redirected = (to: string) => (e: unknown) => digestOf(e).split(";")[2] === to;

    // No door cookie: the tab is the launcher, and the kiosk URL falls back to the tab.
    await signIn();
    expect((await first()).type).toBe(DoorLauncher);
    await expect(kioskPage(page)).rejects.toSatisfy(redirected(`/admin/events/${slug}/door`));

    // Start sends the device to the kiosk URL. Signed in again on that device, the Door tab is still the tab: it
    // says door mode runs here and offers Resume / End; only the kiosk URL renders the kiosk.
    request.jar.clear();
    const { res, door } = await startDoor(operator, "Main door");
    expect((await res.json()).door).toBe(`/admin/events/${slug}/door/kiosk`);
    request.jar.set(COOKIE_NAMES.door, door);
    const kiosk = await kioskPage(page) as Node;
    expect(kiosk.type).toBe(LazyDoorApp);
    const fresh = await signIn();
    const running = await first();
    expect([running.type, running.props.station]).toEqual([DoorRunningHere, "Main door"]);
    expect((await kioskPage(page) as Node).type).toBe(LazyDoorApp);
    // With the session, the proxy lets the tab through (no bounce to the kiosk).
    const { proxy } = await import("../../proxy");
    const through = await proxy(new NextRequest(`${ORIGIN}/admin/events/${slug}/door`, { headers: { cookie: cookieHeader({ [COOKIE_NAMES.door]: door, [COOKIE_NAMES.session]: fresh.cookie }) } }));
    expect(through.headers.get("location")).toBeNull();

    // "End door mode on this device": the session ends, the cookie goes, the tab is the launcher again.
    const form = new FormData(); form.set("csrf", request.jar.get(COOKIE_NAMES.csrf)!);
    expect(await endDoorHereAction(slug, form)).toEqual({ ok: true });
    expect(request.jar.has(COOKIE_NAMES.door)).toBe(false);
    expect((await r.context.GET(get(`/api/door/${slug}/context`, browser({ [COOKIE_NAMES.door]: door })), params(slug))).status).toBe(401);
    expect((await first()).type).toBe(DoorLauncher);

    // A door cookie whose session is over: the kiosk URL goes back to the tab, and the tab explains it on the
    // launcher. With nobody signed in on the device, the kiosk URL asks for the sign-in first (no redirect loop with
    // the proxy, which sends a signed-out door device from the tab to the kiosk).
    request.jar.set(COOKIE_NAMES.door, door);
    await expect(kioskPage(page)).rejects.toSatisfy(redirected(`/admin/events/${slug}/door`));
    request.jar.delete(COOKIE_NAMES.session);
    await expect(kioskPage(page)).rejects.toSatisfy((e: unknown) => digestOf(e).includes(`/login?next=${encodeURIComponent(`/admin/events/${slug}/door`)}`));
    await signIn();
    const ended = await first();
    expect([ended.type, ended.props.notice]).toEqual([DoorLauncher, "Door mode ended on this device."]);
  });

  it("Test mode before doors open runs recognition and checks nobody in; a real scan says the door is closed", async () => {
    const operator = await member("operator"), r = await routes();
    const { door } = await startDoor(operator);
    const cookies = browser({ [COOKIE_NAMES.door]: door });
    const real = await (await r.scan.POST(post(`/api/door/${slug}/scan`, cookies, JPEG, "image/jpeg"), params(slug))).json();
    // v5 compact result: the legacy `result` plus the AR-tag fields; never a photo.
    expect(real).toEqual({ result: "paused", test: false, outcome: "paused", firstName: null, displayName: null, verified: false, verifiedAt: null, photo: "none", trackId: null });
    expect(fake.state.calls.search).toBe(0);
    const tested = await (await r.scan.POST(post(`/api/door/${slug}/scan?test=1&track=12&face=90`, cookies, JPEG, "image/jpeg"), params(slug))).json();
    expect(tested).toMatchObject({ result: "unknown", test: true, outcome: "unknown", trackId: 12, displayName: null, verified: false, photo: "none" });
    expect(fake.state.calls.search).toBe(1);
    expect(await q().query("select result,test from scans")).toEqual([{ result: "paused", test: false }, { result: "unknown", test: true }].sort((a, b) => Number(a.test) - Number(b.test)));
    expect(await q().query("select count(*)::int n from checkins")).toEqual([{ n: 0 }]);
    // Non-JPEG bodies are refused before any provider call.
    expect((await r.scan.POST(post(`/api/door/${slug}/scan?test=1`, cookies, "nope", "text/plain"), params(slug))).status).toBe(415);
  });

  it("removing the operator from the team ends their door at the next request (re-auth prompt)", async () => {
    const operator = await member("operator"), r = await routes();
    const { door } = await startDoor(operator);
    await q().query("update event_members set revoked_at=clock_timestamp() where email=$1", [operator.email]);
    const res = await r.context.GET(get(`/api/door/${slug}/context`, browser({ [COOKIE_NAMES.door]: door })), params(slug));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "DoorAccessRevoked" });
  });

  it("leaving door mode: the PIN ends it (nobody signed in); sign-in exit needs door access on this event", async () => {
    const operator = await member("operator"), r = await routes();
    const owner = await accountSession(identity, db, "owner@didit.me");
    const ownerActor = await identity.auth.requireStaff(owner.cookie) as StaffPrincipal;
    await doorService.setPin(ownerActor, ids.eventId, "246810");
    const first = await startDoor(operator);
    const cookies = browser({ [COOKIE_NAMES.door]: first.door });
    const wrong = await r.exit.POST(post(`/api/door/${slug}/exit`, cookies, JSON.stringify({ pin: "1111" }), "application/json"), params(slug));
    expect([wrong.status, await wrong.json()]).toEqual([403, { error: "WrongPin" }]);
    const limited = await r.exit.POST(post(`/api/door/${slug}/exit`, cookies, JSON.stringify({ pin: "246810" }), "application/json"), params(slug));
    expect(limited.status).toBe(429); expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    await q().query("update counters set expires_at=clock_timestamp()-interval '1 second' where key like 'door:pin:cooldown:%'");
    const right = await r.exit.POST(post(`/api/door/${slug}/exit`, cookies, JSON.stringify({ pin: "246810" }), "application/json"), params(slug));
    expect(right.status).toBe(200);
    expect(setCookies(right)[COOKIE_NAMES.door]).toBe("");
    expect((await r.context.GET(get(`/api/door/${slug}/context`, cookies), params(slug))).status).toBe(401);

    // Sign-in exit: a stranger who signs in on the door laptop cannot end it; the operator (fresh session) can.
    const again = await member("operator");
    const second = await startDoor(again, "Side door");
    const stranger = await accountSession(identity, db, "stranger@example.test");
    const denied = await r.signInExit.GET(get(`/admin/events/${slug}/door/exit`, { [COOKIE_NAMES.door]: second.door, [COOKIE_NAMES.session]: stranger.cookie }, { "sec-fetch-site": "same-origin" }), params(slug));
    expect(denied.headers.get("location")).toContain("/admin/forbidden");
    expect((await r.context.GET(get(`/api/door/${slug}/context`, browser({ [COOKIE_NAMES.door]: second.door })), params(slug))).status).toBe(200);
    const fresh = await accountSession(identity, db, again.email);
    const path = `/admin/events/${slug}/door/exit`;
    const signedIn = browser({ [COOKIE_NAMES.door]: second.door, [COOKIE_NAMES.session]: fresh.cookie });
    const confirmation = await r.signInExit.GET(get(path, signedIn), params(slug));
    expect(confirmation.status).toBe(200);
    expect(confirmation.headers.get("cache-control")).toBe("private, no-store");
    expect(confirmation.headers.get("set-cookie")).toBeNull();
    const html = await confirmation.text();
    expect(html).toContain(`method="post" action="${path}"`);
    expect(html).toContain(`name="csrf" value="${signedIn[COOKIE_NAMES.csrf]}"`);
    const exit = (body: string, extra: Record<string, string> = {}, cookies = signedIn) =>
      r.signInExit.POST(post(path, cookies, body, "application/x-www-form-urlencoded", extra), params(slug));
    const proof = new URLSearchParams({ csrf: signedIn[COOKIE_NAMES.csrf] }).toString();
    expect((await exit("")).status).toBe(403);
    expect((await exit("csrf=wrong")).status).toBe(403);
    expect((await exit(proof, { origin: "https://attacker.test" })).status).toBe(403);
    expect((await exit(proof, { authorization: "Bearer attacker" })).status).toBe(403);
    expect((await exit("csrf=" + "x".repeat(4096))).status).toBe(413);
    const outsider = browser({ [COOKIE_NAMES.door]: second.door, [COOKIE_NAMES.session]: stranger.cookie });
    expect((await exit(new URLSearchParams({ csrf: outsider[COOKIE_NAMES.csrf] }).toString(), {}, outsider)).status).toBe(403);
    expect((await r.context.GET(get(`/api/door/${slug}/context`, browser({ [COOKIE_NAMES.door]: second.door })), params(slug))).status).toBe(200);
    const ok = await exit(proof);
    expect(ok.status).toBe(303); expect(ok.headers.get("location")).toBe(`${ORIGIN}/admin/events/${slug}/door`);
    expect(setCookies(ok)[COOKIE_NAMES.door]).toBe("");
    expect((await r.context.GET(get(`/api/door/${slug}/context`, browser({ [COOKIE_NAMES.door]: second.door })), params(slug))).status).toBe(401);
    expect(await q().query("select action from audit where action like 'door.%' order by created_at,id")).toEqual([{ action: "door.pin_set" }, { action: "door.start" }, { action: "door.end_pin" }, { action: "door.start" }, { action: "door.end" }]);
  });

  it("members see only their events and only what their role allows", async () => {
    const operator = await member("operator"), host = await member("host");
    await q().query("insert into event_members(event_id,email,role,invited_by) select id,$1,'operator','owner@didit.me' from events where slug=$2", ["nobody-else@example.test", otherSlug]);
    const as = (cookie: string) => { request.jar.clear(); request.jar.set(COOKIE_NAMES.session, cookie); request.jar.set(COOKIE_NAMES.csrf, csrfToken(cookie, secret)); };
    const list = await import("../../app/admin/(events)/(list)/data");
    as(operator.cookie);
    const mine = await list.listEvents();
    expect(mine.rows.map(e => e.id)).toEqual([ids.eventId]); expect(mine.canCreate).toBe(false);
    const team = await import("../../app/admin/team/data");
    await expect(team.getTeam()).rejects.toSatisfy((e: unknown) => digestOf(e).includes("403"));
    const settings = await import("../../app/admin/(events)/events/[id]/(tabs)/settings/data");
    await expect(settings.getSettings(slug)).rejects.toSatisfy((e: unknown) => digestOf(e).includes("403"));
    await expect(settings.getSettings(otherSlug)).rejects.toSatisfy((e: unknown) => digestOf(e).includes("403"));
    const header = await import("../../app/admin/(events)/events/[id]/data");
    expect((await header.getEventHeader(slug))?.tabs).toEqual(["overview", "guests", "applicants", "log", "door"]);
    await expect(header.getEventHeader(otherSlug)).rejects.toSatisfy((e: unknown) => digestOf(e).includes("403"));
    const guests = await import("../../app/admin/(events)/events/[id]/(tabs)/guests/data");
    const { parseGuestQuery } = await import("../admin/guests/query");
    expect((await guests.listGuests(slug, parseGuestQuery({})))?.page.total).toBe(1);
    await expect(guests.addGuests(slug, [{ first: "Walk", last: "In", email: "walk@example.test" }], false)).rejects.toSatisfy((e: unknown) => digestOf(e).includes("403"));
    const export_ = await import("../../app/admin/(events)/events/[id]/(tabs)/guests/export/route");
    expect((await export_.GET(get(`/admin/events/${slug}/guests/export`, { [COOKIE_NAMES.session]: operator.cookie }), params(slug))).status).toBe(403);
    const photo = await import("../../app/api/admin/events/[id]/applicants/[registrationId]/photo/route");
    expect((await photo.GET(get(`/api/admin/events/${ids.eventId}/applicants/${ids.registrationId}/photo`, { [COOKIE_NAMES.session]: operator.cookie }), { params: Promise.resolve({ id: ids.eventId, registrationId: ids.registrationId }) })).status).toBe(403);
    const selfie = await import("../../app/api/admin/events/[id]/applicants/[registrationId]/selfie/route");
    expect((await selfie.GET(get(`/api/admin/events/${ids.eventId}/applicants/${ids.registrationId}/selfie`, { [COOKIE_NAMES.session]: operator.cookie }), { params: Promise.resolve({ id: ids.eventId, registrationId: ids.registrationId }) })).status).toBe(403);

    as(host.cookie);
    expect((await header.getEventHeader(slug))?.tabs).toEqual(["overview", "guests", "applicants", "log", "door", "team", "settings"]);
    expect(await settings.getSettings(slug)).toMatchObject({ eventId: ids.eventId });
    const teamActions = await import("../../app/admin/(events)/events/[id]/(tabs)/team/actions");
    const form = new FormData(); form.set("csrf", request.jar.get(COOKIE_NAMES.csrf)!); form.set("email", "new-op@example.test"); form.set("role", "operator");
    expect(await teamActions.addMemberAction(slug, { status: "idle" }, form)).toMatchObject({ status: "saved", message: "Invitation sent to new-op@example.test." });
    expect(await q().query("select payload->>'to' as to from outbox where kind='email:M-27'")).toEqual([{ to: "new-op@example.test" }]);
    await expect(settings.endEvent(slug, 1)).rejects.toSatisfy((e: unknown) => digestOf(e).includes("403"));
  });

  it("hosts edit the event through the editor API but cannot change the door (kiosk, mode, threshold): event.limits", async () => {
    const host = await member("host"), cookies = browser({ [COOKIE_NAMES.session]: host.cookie });
    const editor = await import("../../app/api/admin/events/[id]/editor/route");
    await q().query(`update events set door='{"kiosk":true,"mode":"strict","match_threshold":90}'::jsonb where id=$1`, [ids.eventId]);
    const view = async () => (await (await editor.GET(get(`/api/admin/events/${ids.eventId}/editor`, cookies), params(ids.eventId))).json()).data as { editVersion: number; values: Record<string, unknown> };
    const patch = (body: unknown) => editor.PATCH(new Request(`${ORIGIN}/api/admin/events/${ids.eventId}/editor`, { method: "PATCH", body: JSON.stringify(body), headers: { origin: ORIGIN, "content-type": "application/json", cookie: cookieHeader(cookies), "x-csrf": cookies[COOKIE_NAMES.csrf]! } }), params(ids.eventId));
    const before = await view();
    for (const door of [{ kiosk: true, mode: "supervised", match_threshold: 90 }, { kiosk: true, mode: "strict", match_threshold: 60 }, { kiosk: false }]) {
      const res = await patch({ ...before.values, door, expectedVersion: before.editVersion });
      expect(res.status, JSON.stringify(door) + await res.clone().text()).toBe(403);
    }
    expect(await q().query("select door from events where id=$1", [ids.eventId])).toEqual([{ door: { kiosk: true, mode: "strict", match_threshold: 90 } }]);
    // Resending the same door with other edits is fine.
    const ok = await patch({ ...before.values, name: "Renamed by host", expectedVersion: before.editVersion });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await q().query("select name,door from events where id=$1", [ids.eventId])).toEqual([{ name: "Renamed by host", door: { kiosk: true, mode: "strict", match_threshold: 90 } }]);
  });
});
