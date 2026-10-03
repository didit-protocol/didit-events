import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { randomToken, signToken } from "@didit-events/core/identity/shared";
import { csrfToken, guardBrowser, navigationPolicy } from "./browser";
import { GET as devRoute } from "../../app/api/auth/dev/route";
const devLogin = vi.hoisted(() => vi.fn(async () => ({ cookie: "test-cookie" })));
vi.mock("./runtime", () => ({ identity: { devLogin, devStaffLogin: devLogin, sessions: { validCsrf: async () => false } } }));
const secret = "test-secret-that-is-longer-than-32-characters", origin = "https://events.test";
const sid = signToken(randomToken(), secret, "session"), anon = signToken(randomToken(), secret, "anonymous");
const csrf = csrfToken(sid, secret);
beforeEach(() => { vi.stubEnv("APP_URL", origin); vi.stubEnv("SESSION_SECRET", secret); });
afterEach(() => vi.unstubAllEnvs());
const req = (headers: Record<string, string> = {}, body = "{}") => new Request(`${origin}/action`, { method: "POST", body, headers: { origin, cookie: `__Host-sid=${sid}; __Host-csrf=${csrf}`, "x-csrf": csrf, ...headers } });
it("accepts a signed browser session and a token bound to that session", async () => {
  expect((await guardBrowser(req())).sessionCookie).toBe(sid);
});
it.each([
  ["missing token", { "x-csrf": "" }], ["mismatched token", { "x-csrf": "wrong" }], ["foreign Origin", { origin: "https://evil.test" }],
  ["missing Origin", { origin: "" }], ["null Origin", { origin: "null" }], ["bearer", { authorization: "Bearer nope" }],
  ["injected cookie/token pair", { cookie: `__Host-sid=${sid}; __Host-csrf=injected`, "x-csrf": "injected" }],
  ["invalid signed session", { cookie: `__Host-sid=forged; __Host-csrf=${csrf}` }],
  ["duplicate cookie", { cookie: `__Host-sid=${sid}; __Host-sid=forged; __Host-csrf=${csrf}` }],
])("rejects %s", async (_name, headers) => { await expect(guardBrowser(req(headers))).rejects.toMatchObject({ status: 403 }); });
it("anonymous bootstrap is explicit and never satisfies an authenticated mutation", async () => {
  const token = csrfToken(anon, secret), headers = { cookie: `__Host-anon=${anon}; __Host-csrf=${token}`, "x-csrf": token };
  await expect(guardBrowser(req(headers))).rejects.toMatchObject({ status: 403 });
  expect((await guardBrowser(req(headers), { anonymous: true })).sessionCookie).toBe("");
});
it("caps browser mutations before domain work", async () => {
  await expect(guardBrowser(req({}, "a".repeat(65537)))).rejects.toMatchObject({ status: 413 });
});
it("OIDC callback permits the provider return; dev bootstrap remains same-origin", () => {
  const req = new Request(`${origin}/api/auth/oidc/start`, { headers: { "sec-fetch-site": "cross-site" } });
  expect(() => navigationPolicy(req)).toThrow(); expect(() => navigationPolicy(req, true)).not.toThrow();
});
it("development route is a 404 in production even when the switch is set", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("DEV_AUTH", "1"); vi.stubEnv("APP_URL", "http://localhost:3000");
  expect((await devRoute(new Request(`${origin}/api/auth/dev?email=test@example.test`))).status).toBe(404);
});
it("every existing server action invokes the policy guard and a principal guard where required", () => {
  const anonymousActions = new Set([
    "login/actions.ts:signInAction",
    "admin/login/actions.ts:signInAction",
    "admin/login/actions.ts:switchAccountAction",
    "admin/login/actions.ts:staffEmailSignInAction",
    "e/[slug]/register/actions.ts:registerAction",
    "e/[slug]/actions.ts:requestAction",
    "e/[slug]/actions.ts:subscribeAction",
    "e/[slug]/actions.ts:verifyAction",
    "i/[token]/actions.ts:acceptInviteAction",
    "e/[slug]/v/[token]/actions.ts:startFromLinkAction",
  ]);
  const seenAnonymous = new Set<string>();
  const root = new URL("../../app/", import.meta.url);
  for (const file of globSync("**/*.{ts,tsx}", { cwd: root })) {
    const source = readFileSync(join(fileURLToPath(root), file), "utf8"); if (!source.startsWith('"use server"')) continue;
    const functions = source.split(/export async function /).slice(1);
    for (const fn of functions) {
      expect(fn, file).toContain("await guardAction(");
      const key = `${file}:${fn.slice(0, fn.indexOf("("))}`;
      if (anonymousActions.has(key)) {
        expect(fn, key).toContain("await guardAction(form, { anonymous: true })");
        expect(fn, key).not.toMatch(/await require(?:Guest|Staff)\(/);
        seenAnonymous.add(key);
      } else if (key === "me/deleting/actions.ts:keepAccountAction") {
        // v5: the deleting account has no live principal; the deletion's own session (by token) is the guard.
        expect(fn, key).toContain("await guardAction(form)");
        expect(fn, key).toContain("await identity.profile.keepAccount(");
      } else if (key === "me/settings/actions.ts:signOutAction") {
        expect(fn, key).toContain("await identity.sessions.resolve(");
        expect(fn, key).toContain("await identity.sessions.revoke(");
      } else {
        expect(fn, key).not.toMatch(/anonymous\s*:\s*true/);
        expect(fn, key).toMatch(file.startsWith("admin/") ? /await (?:requireStaff|getStaff|staffPage|requireEventAccess|requireStaffAccess|requireGlobalAccess|eventAccess)\(/ : /await (?:requireGuest|guestPage)\(/);
      }
    }
  }
  expect(seenAnonymous).toEqual(anonymousActions);
});

it.each(["", "https://events.test", "http://localhost.evil.test", "file://localhost", "http://localhost/path", "http://user@localhost", "invalid"])("refuses development login for APP_URL %s", async value => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("DEV_AUTH", "1"); vi.stubEnv("APP_URL", value);
  devLogin.mockClear();
  expect((await devRoute(new Request("http://localhost/api/auth/dev?email=test@example.test"))).status).toBe(404);
  expect(devLogin).not.toHaveBeenCalled();
});
it.each(["http://localhost:3000", "http://127.0.0.1:3000", "https://localhost"])("permits double-gated local dev auth at %s", async value => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("DEV_AUTH", "1"); vi.stubEnv("APP_URL", value);
  expect((await devRoute(new Request(`${value}/api/auth/dev?email=test@example.test`))).status).toBe(307);
  vi.stubEnv("DEV_AUTH", "0");
  expect((await devRoute(new Request(`${value}/api/auth/dev`))).status).toBe(404);
});
it.each([undefined, "http://localhost:3000"])("admin GET fails closed without APP_URL (Origin %s)", async origin => {
  vi.stubEnv("APP_URL", "");
  const { routeGlobalAccess } = await import("./access");
  await expect(routeGlobalAccess(new Request("http://localhost/api/admin/test", { headers: origin ? { origin } : {} }), "tokens.manage")).rejects.toMatchObject({ status: 503, message: "AppUrlRequired" });
});
