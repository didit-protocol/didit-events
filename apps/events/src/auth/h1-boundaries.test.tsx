import { accountSession } from "@didit-events/core/testing/account-session";
import { globSync, readFileSync } from "node:fs";
import ts from "typescript";
import type * as NextServer from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { identity, type Db } from "@didit-events/core";
import { queryable } from "@didit-events/core/db/tx";
import { resetDatabase, seed, testDatabase } from "@didit-events/core/testing/database";
import { skipPostgres } from "@didit-events/core/testing/postgres";
import { COOKIE_NAMES } from "@didit-events/core/http/policy";
import { randomToken, readToken, signToken } from "@didit-events/core/identity/shared";
import { staffPage, guestPage } from "./access";
import { adminModel } from "../server/b4-views";
import { csrfToken } from "./browser";
import { CsrfField } from "./CsrfField";
import RootLayout from "../../app/layout";
import { signInAction } from "../../app/login/actions";

/** The layout with every Suspense boundary resolved (the deletion banner is a lazy chunk behind a slot). */
const renderSettled = async (node: ReactNode) => new Response((await prerender(node)).prelude).text();

// Only Next's request/render plumbing is substituted. Guards, principals, services,
// redirects and all database reads/writes below use their production implementations.
const request = vi.hoisted(() => ({ jar: new Map<string, string>(), origin: "https://events.test", writes: [] as { name: string; value: string; options: Record<string, unknown> }[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => request.jar.has(name) ? { value: request.jar.get(name)! } : undefined,
    set: (name: string, value: string, options: Record<string, unknown>) => {
      request.writes.push({ name, value, options });
      if (options.maxAge === 0) request.jar.delete(name); else request.jar.set(name, value);
    },
  }),
  headers: async () => new Headers({ origin: request.origin, cookie: [...request.jar].map(([k, v]) => `${k}=${v}`).join("; "), "x-forwarded-for": "192.0.2.42" }),
}));
vi.mock("next/server", async original => ({ ...await original<typeof NextServer>(), connection: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@didit-events/ui/fonts", () => ({ inter: { variable: "font-test" } }));

const app = new URL("../../app/", import.meta.url);
const files = (pattern: string) => globSync(pattern, { cwd: app }).sort();
const ast = (file: string) => ts.createSourceFile(file, readFileSync(new URL(file, app), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const exportedFunctions = (file: string) => ast(file).statements.filter(ts.isFunctionDeclaration).filter(f => f.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword));
/** The capability helpers of src/auth/access.ts (and the door session guard); access.test.ts checks their capability argument. */
const GUARDS = ["requireEventAccess", "eventAccess", "findEventAccess", "requireGlobalAccess", "requireStaffAccess", "routeEventAccess", "routeGlobalAccess", "eventMutation", "globalMutation", "doorRequest", "doorPageSession", "adminPage", "requireStaff"];
function callsGuard(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && GUARDS.includes(node.expression.text)) return true;
  return node.getChildren().some(callsGuard);
}

it("every admin page and route has its own staff check; only the two sign-in screens are public", () => {
  const publicPages = new Set(["admin/login/page.tsx", "admin/forbidden/page.tsx"]);
  const entrypoints = [...files("admin/**/page.tsx"), ...files("admin/**/route.ts"), ...files("api/admin/**/route.ts"), ...files("api/door/**/route.ts")];
  expect(entrypoints.length).toBeGreaterThan(15);
  for (const file of entrypoints) {
    if (publicPages.delete(file)) continue;
    const functions = exportedFunctions(file).filter(f => f.body);
    expect(functions.length, file).toBeGreaterThan(0);
    for (const fn of functions) expect(callsGuard(fn.body!), `${file}: ${fn.name?.text}`).toBe(true);
  }
  expect([...publicPages]).toEqual([]);
});

it("delete and every profile page retain a client error boundary as a safety net", () => {
  for (const page of ["me/settings/delete/page.tsx", ...files("me/profile/**/page.tsx")]) {
    const source = readFileSync(new URL(page.replace("page.tsx", "error.tsx"), app), "utf8");
    expect(source).toContain('"use client"'); expect(source).toContain("FlowError"); expect(source).toContain("reset");
  }
});

type Adapter = (...args: never[]) => Promise<unknown>;
type Module = Record<string, Adapter>;
const modules = import.meta.glob("../../app/{admin,me}/**/{data,actions}.ts");
const pages = import.meta.glob("../../app/admin/**/page.tsx");
const load = async (file: string) => await modules[`../../app/${file}`]!() as Module;
const call = async (file: string, name: string, args: unknown[] = []) => (await load(file))[name]!(...args as never[]);
const secret = "h1-real-session-secret-longer-than-thirty-two-characters";
const tab = "admin/(events)/events/[id]/(tabs)/";
const adminData: Record<string, string[]> = {
  "admin/data.ts": ["adminUser", "requireStaff", "getSystemStatus"],
  "admin/(events)/(list)/data.ts": ["listEvents"],
  "admin/(events)/events/[id]/data.ts": ["getEvent", "resolveEventId", "requireEvent", "getEventHeader", "getEventTimeZone"],
  "admin/(events)/events/new/data.ts": ["getNewEventDefaults", "createEvent"],
  "admin/(events)/events/[id]/edit/data.ts": ["getEventForEdit", "updateEvent", "getEventEditor", "saveEventEditor"],
  [tab + "(overview)/data.ts"]: ["getOverview"],
  [tab + "guests/data.ts"]: ["allGuests", "listGuests", "existingEmails", "getGuestDetail", "addGuests", "changeStatus", "manualCheckIn", "undoCheckIn", "acceptVerifiedEmail", "requestReverification", "getApplicantDrawer"],
  [tab + "applicants/data.ts"]: ["listApplicants", "applicantsSummary", "getApplicantDetail", "existingEmails", "decide", "undoReject", "saveNote", "invite", "getShareLinks", "getRequirements", "saveRequirements", "reopenRequests", "getApplicantDrawer"],
  [tab + "settings/data.ts"]: ["getSettings", "setRequestForm", "saveWelcome", "saveLimits", "saveDetails", "endEvent", "deleteEvent"],
  [tab + "log/data.ts"]: ["getLogSummary", "getLogPage"],
  "admin/team/data.ts": ["getTeam", "findMember"],
  "admin/people/data.ts": ["listPeople", "getPerson"],
};
it("the direct-call inventory includes every private admin data adapter", () => {
  for (const file of files("admin/**/data.ts")) {
    if (file === "admin/forbidden/data.ts") continue; // Optional self-identity on the public denial screen.
    // getStaff: optional principal, tested below. addGuestProblem: a pure error-to-copy mapper, no data.
    const names = exportedFunctions(file).map(f => f.name!.text).filter(n => n !== "getStaff" && n !== "addGuestProblem");
    expect(adminData[file]?.slice().sort(), file).toEqual(names.sort());
  }
});

const guestData: [string, string, string][] = [
  ["me/events/data.ts", "getMyEvents", "/me/events"],
  ["me/events/[slug]/data.ts", "getMyEvent", "/me/events/private-event"],
  ["me/events/[slug]/data.ts", "renewSelfie", "/me/events/private-event"],
  ["me/events/[slug]/data.ts", "newVerificationLink", "/me/events/private-event"],
  ["me/events/[slug]/cancel/data.ts", "getCancelPage", "/me/events/private-event/cancel"],
  ["me/events/[slug]/cancel/data.ts", "cancelRegistration", "/me/events/private-event/cancel"],
  ["me/profile/data.ts", "getProfile", "/me/profile"],
  ["me/profile/edit/data.ts", "getEditableProfile", "/me/profile/edit"],
  ["me/profile/edit/data.ts", "saveProfile", "/me/profile/edit"],
  ["me/profile/edit/data.ts", "changeVerifiedName", "/me/profile/edit"],
  ["me/profile/photo/data.ts", "getPhotoOwner", "/me/profile/photo"],
  ["me/profile/photo/data.ts", "savePhoto", "/me/profile/photo"],
  ["me/profile/photo/data.ts", "removePhoto", "/me/profile/photo"],
  ["me/profile/verification/data.ts", "getVerification", "/me/profile/verification"],
  ["me/profile/verification/data.ts", "deleteVerificationData", "/me/profile/verification"],
  ["me/settings/data.ts", "getSettings", "/me/settings"],
  ["me/settings/data.ts", "signOut", "/me/settings"],
  ["me/settings/data.ts", "setMarketing", "/me/settings"],
  ["me/settings/data.ts", "disconnectGoogle", "/me/settings"],
  ["me/settings/delete/data.ts", "getDeletionImpact", "/me/settings/delete"],
  ["me/settings/delete/data.ts", "deleteAccount", "/me/settings/delete"],
];
const guestActions: [string, string, string, boolean][] = [
  ["me/events/[slug]/actions.ts", "renewAction", "/me/events/private-event", false],
  ["me/events/[slug]/actions.ts", "newLinkAction", "/me/events/private-event", false],
  ["me/events/[slug]/cancel/actions.ts", "cancelAction", "/me/events/private-event/cancel", true],
  ["me/profile/edit/actions.ts", "saveProfileAction", "/me/profile/edit", true],
  ["me/profile/edit/actions.ts", "changeNameAction", "/me/profile/edit", true],
  ["me/profile/photo/actions.ts", "uploadPhotoAction", "/me/profile/photo", true],
  ["me/profile/photo/actions.ts", "savePhotoAction", "/me/profile/photo", true],
  ["me/profile/photo/actions.ts", "removePhotoAction", "/me/profile/photo", true],
  ["me/profile/verification/actions.ts", "deleteVerificationAction", "/me/profile/verification", false],
  ["me/settings/actions.ts", "toggleMarketingAction", "/me/settings", false],
  ["me/settings/actions.ts", "disconnectGoogleAction", "/me/settings", false],
  ["me/settings/delete/actions.ts", "deleteAccountAction", "/me/settings/delete", true],
];
const loginDigest = (path: string, _staff = false) => ({ digest: `NEXT_REDIRECT;replace;/login?next=${encodeURIComponent(path)};307;` });
const form = (values: Record<string, string> = {}) => { const f = new FormData(); f.set("csrf", request.jar.get(COOKIE_NAMES.csrf) ?? ""); for (const [k, v] of Object.entries(values)) f.set(k, v); return f; };
const bind = (cookie?: string) => {
  request.jar.clear();
  const value = cookie ?? signToken(randomToken(), secret, "anonymous");
  request.jar.set(cookie ? COOKIE_NAMES.session : COOKIE_NAMES.anonymous, value);
  request.jar.set(COOKIE_NAMES.csrf, csrfToken(value, secret));
};

describe.skipIf(skipPostgres)("H1 real guards and real Postgres", () => {
  let db: Db, close: () => Promise<void>, ids: Awaited<ReturnType<typeof seed>>;
  let staff: Awaited<ReturnType<typeof identity.sessions.rotate>>, guest: typeof staff;
  const globalDb = globalThis as typeof globalThis & { __diditEventsDb?: Db };
  const q = () => queryable(db);
  beforeAll(async () => { ({ db, close } = await testDatabase("postgres")); globalDb.__diditEventsDb = db; }, 60_000);
  afterAll(async () => { delete globalDb.__diditEventsDb; await close?.(); });
  beforeEach(async () => {
    vi.stubEnv("SESSION_SECRET", secret); vi.stubEnv("APP_URL", "https://events.test");
    request.origin = "https://events.test"; request.writes = []; await resetDatabase(db); await q().query("truncate otp_challenges,otp_deliveries"); ids = await seed(db);
    await q().query("update events set slug='private-event',status='published',starts_at=clock_timestamp()+interval '2 days',ends_at=clock_timestamp()+interval '3 days'");
    await q().query("update accounts set email='private@example.test',first_name='Private',last_name='Person'");
    await q().query("insert into staff(email,role) values('owner@didit.me','owner')");
    staff = await accountSession(identity, db, "owner@didit.me");
    guest = await identity.sessions.rotate({ principal: "guest", accountId: ids.accountId, authenticatedAt: new Date(), authMethod: "email_otp" });
    bind();
  });
  afterEach(() => vi.unstubAllEnvs());

  async function sessionState(who: "guest" | "staff", state: string) {
    const session = who === "staff" ? staff : guest;
    bind(state === "missing" ? undefined : state === "wrong-principal" ? (who === "staff" ? guest.cookie : staff.cookie) : session.cookie);
    if (state === "expired") await q().query("update sessions set expires_at=clock_timestamp()-interval '1 second' where id=$1", [session.session.id]);
    if (state === "revoked") await identity.sessions.revoke(session.session.id);
    if (state === "idle") await q().query("update sessions set last_seen_at=clock_timestamp()-interval '31 days' where id=$1", [session.session.id]);
    if (state === "disabled") await q().query("update staff set disabled_at=clock_timestamp() where email='owner@didit.me'");
  }
  it.each(["missing", "expired", "revoked", "disabled", "wrong-principal"])("%s staff session cannot call any admin loader directly or return PII", async state => {
    await sessionState("staff", state);
    await expect(adminModel(ids.eventId)).rejects.toMatchObject(state === "disabled" || state === "wrong-principal" ? { digest: expect.stringContaining("/admin/forbidden?next=") } : loginDigest(`/admin/events/${ids.eventId}`, true));
    for (const [file, names] of Object.entries(adminData)) for (const name of names) {
      if (name === "adminUser") continue; // Formats an already authorized viewer.
      const args: unknown[] = [ids.eventId, ids.kioskId, "Door"];
      await expect(call(file, name, args), `${file}:${name}`).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;replace;\/(?:login|admin\/forbidden)\?next=/) });
    }
    expect(await call("admin/data.ts", "getStaff")).toBeNull();
    expect(await q().query("select id from outbox union all select id from audit")).toEqual([]);
  });

  it.each(["missing", "expired", "revoked", "disabled"])("%s staff session redirects every page segment without its layout and every staff action", async state => {
    await sessionState("staff", state);
    for (const [file, loadPage] of Object.entries(pages)) {
      if (/\/(login|forbidden)\//.test(file)) continue;
      const page = await loadPage() as { default: Adapter };
      const props = { params: Promise.resolve({ id: ids.eventId }), searchParams: Promise.resolve({ guest: ids.registrationId }) };
      await expect(page.default(props as never), file).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;replace;\/(?:login|admin\/forbidden)\?next=/) });
    }
    for (const file of files("admin/**/actions.ts")) for (const fn of exportedFunctions(file)) {
      const name = fn.name!.text;
      if (file === "admin/login/actions.ts" && ["signInAction", "switchAccountAction", "staffEmailSignInAction"].includes(name)) continue;
      const f = form({ id: ids.eventId, email: "disabled@didit.me", role: "staff" });
      const input: Record<string, unknown> = { form: f, _form: f, eventId: ids.eventId, email: "disabled@didit.me", csrf: request.jar.get(COOKIE_NAMES.csrf), _prev: {}, id: ids.registrationId };
      const args = fn.parameters.map(p => input[p.name.getText()] ?? "fixture");
      await expect(call(file, name, args), `${file}:${name}`).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;replace;\/(?:login|admin\/forbidden)\?next=/) });
      expect(callsGuard(fn.body!), `${file}:${name}`).toBe(true);
    }
    await expect(call("admin/team/actions.ts", "restoreStaffAction", [form({ email: "disabled@didit.me" })])).rejects.toMatchObject(state === "disabled" ? { digest: expect.stringContaining("/admin/forbidden?next=") } : loginDigest("/admin/team", true));
    expect(await q().query("select id from outbox union all select id from audit")).toEqual([]);
  });

  it.each(["missing", "expired", "revoked", "wrong-principal"])("%s staff session cannot export PII, stream or fetch a live snapshot", async state => {
    await sessionState("staff", state);
    const handlers = [
      await import("../../app/admin/(events)/events/[id]/(tabs)/guests/export/route"),
      await import("../../app/api/admin/events/[id]/live/route"),
      await import("../../app/api/admin/events/[id]/stream/route"),
    ];
    for (const handler of handlers) {
      const response = await handler.GET(new Request(`https://events.test/api/admin/events/${ids.eventId}/live`), { params: Promise.resolve({ id: ids.eventId }) });
      expect([401, 403]).toContain(response.status); expect(await response.text()).not.toMatch(/private@example.test|Private Person/);
    }
  });

  it.each(["missing", "expired", "revoked", "wrong-principal"])("%s staff session cannot import guests or recover verification through the API", async state => {
    await sessionState("staff", state);
    const imports = await import("../../app/api/admin/events/[id]/import/route");
    const recovery = await import("../../app/api/admin/verifications/[id]/recover/route");
    for (const [handler, contentType, body] of [
      [imports, "text/csv", "first,last,email\nNew,Guest,new@example.test"],
      [recovery, "application/json", JSON.stringify({ reason: "Fixture recovery" })],
    ] as const) {
      const req = new Request("https://events.test/api/admin", { method: "POST", headers: { origin: request.origin, "content-type": contentType, "x-csrf": request.jar.get(COOKIE_NAMES.csrf)!, cookie: [...request.jar].map(([k, v]) => `${k}=${v}`).join("; ") }, body });
      const response = await handler.POST(req, { params: Promise.resolve({ id: ids.eventId }) });
      expect([401, 403]).toContain(response.status); expect(await response.text()).not.toContain("private@example.test");
    }
    expect(await q().query("select id from audit union all select id from outbox union all select id from spend")).toEqual([]);
  });

  it("authenticated actions still reject wrong CSRF and foreign Origin without domain writes", async () => {
    bind(guest.cookie);
    for (const [file, name, , prev] of guestActions) {
      const f = form({ slug: "private-event", confirm: "DELETE", csrf: "wrong" });
      await expect(call(file, name, prev ? [{}, f] : [f]), name).rejects.toMatchObject({ status: 403 });
    }
    bind(staff.cookie);
    for (const origin of ["https://events.test", "https://evil.test"]) {
      request.origin = origin;
      const f = form({ email: "new@didit.me", role: "staff", ...(origin === "https://events.test" ? { csrf: "wrong" } : {}) });
      await expect(call("admin/team/actions.ts", "restoreStaffAction", [f])).rejects.toMatchObject({ status: 403 });
    }
    expect(await q().query("select id from deletions union all select id from outbox union all select id from audit")).toEqual([]);
  });

  it.each(["missing", "expired", "revoked"])("%s guest session redirects every private loader and action with its return path", async state => {
    await sessionState("guest", state);
    for (const [file, name, path] of guestData) {
      const args = name === "getCancelPage" ? ["private-event", new Date(), "cancel"] : ["private-event", "Not going", ""];
      await expect(call(file, name, args), `${file}:${name}`).rejects.toMatchObject(loginDigest(path));
    }
    await expect(call("me/events/[slug]/cancel/data.ts", "getCancelPage", ["private-event", new Date(), "withdraw"])).rejects.toMatchObject(loginDigest("/me/events/private-event/withdraw"));
    for (const [file, name, path, prev] of guestActions) {
      const f = form({ slug: "private-event", confirm: "DELETE" });
      await expect(call(file, name, prev ? [{}, f] : [f]), name).rejects.toMatchObject(loginDigest(path));
    }
    expect(await q().query("select id from deletions union all select id from audit union all select id from outbox")).toEqual([]);
    expect(await q().query("select admission from registrations")).toEqual([{ admission: "approved" }]);
  });

  it("valid staff can load real PII; privileged roles and routine renewal use distinct freshness rules", async () => {
    bind(staff.cookie);
    expect(await call(tab + "guests/data.ts", "getGuestDetail", [ids.eventId, ids.registrationId])).toMatchObject({ email: "private@example.test", name: "Private Person" });
    expect(await call("admin/(events)/events/[id]/data.ts", "getEventHeader", [ids.eventId])).toMatchObject({ guestCount: 1 });
    await q().query("update staff set role='staff' where email='owner@didit.me'");
    await expect(staffPage("/admin/team", ["owner", "admin"])).rejects.toMatchObject({ digest: expect.stringContaining("/admin/forbidden?next=") });
    bind(guest.cookie); await q().query("update sessions set authenticated_at=clock_timestamp()-interval '16 minutes' where id=$1", [guest.session.id]);
    expect(await guestPage("/me/events/private-event")).toMatchObject({accountId: ids.accountId});
    await expect(identity.auth.requireGuest(guest.cookie,900)).rejects.toThrow();
  });

  it.each(["//evil.test", "/\\evil.test", "/a/..//evil.test", "/\t/evil.test"])("redirect helpers normalize unsafe next %j", async next => {
    await expect(guestPage(next)).rejects.toMatchObject({ digest: "NEXT_REDIRECT;replace;/login;307;" });
    await expect(staffPage(next)).rejects.toMatchObject(loginDigest("/admin", true));
  });

  it("deleteAccountAction (v5 grace): this browser keeps an inert session, every page shows Keep my account, and keeping restores the place", async () => {
    bind(guest.cookie);
    await expect(call("me/settings/delete/actions.ts", "deleteAccountAction", [{}, form({ confirm: "DELETE" })])).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT;") });
    expect(request.jar.get(COOKIE_NAMES.session)).toBe(guest.cookie);
    expect(await q().query("select admission,reason from registrations")).toEqual([{ admission: "cancelled_by_guest", reason: "account deleted" }]);
    await expect(identity.auth.requireGuest(guest.cookie)).rejects.toThrow();
    const html = await renderSettled(await RootLayout({ children: <CsrfField /> }));
    expect(html).toContain("data-deletion-banner");
    // /me pages offer "Keep my account" instead of a sign-in that could never complete.
    await expect(guestPage("/me/events")).rejects.toMatchObject({ digest: expect.stringContaining("/me/deleting?next=%2Fme%2Fevents") });
    await expect(call("me/deleting/actions.ts", "keepAccountAction", [{}, form({ next: "/me/events" })])).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT;replace;/me/events") });
    expect(await guestPage("/me/events")).toMatchObject({ accountId: ids.accountId });
    expect(await q().query("select admission from registrations")).toEqual([{ admission: "approved" }]);
    expect(await q().query("select id from deletions")).toEqual([]);
    expect(await renderSettled(await RootLayout({ children: <CsrfField /> }))).not.toContain("data-deletion-banner");
    // A second keep (another tab) is refused calmly, never a crash.
    await expect(call("me/deleting/actions.ts", "keepAccountAction", [{}, form({})])).resolves.toMatchObject({ error: expect.any(String) });
  });

  it.each(["signOutAction", "disconnectGoogleAction"])("%s issues a fresh anonymous binding in the same response and the next rendered token submits successfully", async name => {
    bind(guest.cookie);
    await q().query("insert into account_identities(account_id,issuer,subject) values($1,'https://issuer.test','subject')", [ids.accountId]);
    const oldHtml = renderToStaticMarkup(await RootLayout({ children: <CsrfField /> }));
    const oldToken = /name="csrf" value="([^"]+)"/.exec(oldHtml)![1]!;
    const file = name === "deleteAccountAction" ? "me/settings/delete/actions.ts" : "me/settings/actions.ts";
    await expect(call(file, name, name === "deleteAccountAction" ? [{}, form({ confirm: "DELETE" })] : [form()])).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT;") });
    const anon = request.jar.get(COOKIE_NAMES.anonymous)!;
    expect(readToken(anon, secret, "anonymous")).toBeTruthy(); expect(request.jar.has(COOKIE_NAMES.session)).toBe(false);
    expect(request.jar.get(COOKIE_NAMES.csrf)).toBe(csrfToken(anon, secret));
    for (const cookie of [COOKIE_NAMES.anonymous, COOKIE_NAMES.csrf]) expect(request.writes.find(w => w.name === cookie)?.options).toMatchObject({ secure: true, path: "/", sameSite: "lax", maxAge: 3600, httpOnly: cookie !== COOKIE_NAMES.csrf });
    // No proxy or intervening GET bootstrap: render using the action's updated cookie jar.
    const html = renderToStaticMarkup(await RootLayout({ children: <CsrfField /> }));
    const token = /name="csrf" value="([^"]+)"/.exec(html)![1]!;
    expect(token).not.toBe(oldToken); expect(token).toBe(request.jar.get(COOKIE_NAMES.csrf));
    // The real OTP service intentionally gives deleting accounts a neutral sent state without a paid provider call.
    await q().query("update accounts set deleting_at=coalesce(deleting_at,clock_timestamp()) where id=$1", [ids.accountId]);
    await expect(signInAction({ step: "choose" }, form({ csrf: token, intent: "send", email: "private@example.test" }))).resolves.toMatchObject({ step: "code", status: "sent" });
    expect(await q().query("select synthetic from otp_challenges")).toEqual([{ synthetic: true }]);
    await expect(signInAction({ step: "choose" }, form({ csrf: oldToken, intent: "send", email: "private@example.test" }))).rejects.toMatchObject({ status: 403 });
  });
});
