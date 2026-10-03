import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import type { Db } from "../db/index.ts";
import { queryable } from "../db/tx.ts";
import { resetDatabase, testDatabase } from "../testing/database.ts";
import { bodyLimit, browserMutation, cookieAttributes, COOKIE_NAMES, serializeCookie, webhookAuth } from "./policy.ts";
import fixture from "../didit/fixtures/webhook.json";
let db: Db, close: () => Promise<void>;
beforeAll(async () => { ({ db, close } = await testDatabase("pglite")); }, 60_000);
beforeEach(() => resetDatabase(db)); afterAll(async () => { await close?.(); });
const browser = (headers: Record<string, string> = {}) => new Request("https://events.example.test/api/apply", { method: "POST", body: "{}", headers: { origin: "https://events.example.test", cookie: "__Host-sid=signed; __Host-csrf=random", "x-csrf": "random", ...headers } });
const origins = ["https://events.example.test"];
it("browser guard rejects nonbrowser callers, CSRF mismatch, suffix origin and duplicate cookies", async () => {
  expect((await browserMutation(browser(), { origins })).sessionCookie).toBe("signed");
  for (const headers of ([{ origin: "https://events.example.test.evil.test" }, { "x-csrf": "wrong" }, { origin: "null" }, { cookie: "__Host-csrf=random" }, { authorization: "Bearer token" }, { "x-signature-v2": "signature" }, { cookie: "__Host-sid=a; __Host-sid=b; __Host-csrf=random" }] as Record<string, string>[])) {
    await expect(browserMutation(browser(headers), { origins })).rejects.toMatchObject({ status: 403 });
  }
  await expect(browserMutation(new Request("https://events.example.test", { method: "POST", body: "{}" }), { origins })).rejects.toMatchObject({ status: 403 });
});
it("webhook auth persists before acknowledgment and deduplicates replay; wrong caller rejected", async () => {
  const req = (extra = {}) => new Request("https://events.example.test/api/webhooks/didit", { method: "POST", body: fixture.raw, headers: { "content-type": "application/json", "x-signature-v2": fixture.signatureV2, "x-timestamp": String(fixture.payload.timestamp), ...extra } });
  const options = { db, now: new Date(fixture.payload.timestamp * 1000) };
  expect((await webhookAuth(req(), fixture.secret, options)).duplicate).toBe(false);
  expect((await webhookAuth(req(), fixture.secret, options)).duplicate).toBe(true);
  expect(await queryable(db).query("select id from inbox")).toHaveLength(1);
  for (const extra of [{ cookie: "__Host-sid=x" }, { origin: "https://events.example.test" }, { "x-csrf": "browser-csrf" }, { authorization: "Bearer x" }, { "x-signature-v2": "invalid" }]) await expect(webhookAuth(req(extra), fixture.secret, options)).rejects.toMatchObject({ status: 401 });
});
it("body limits stream rather than trusting content-length and cookie attributes enforce __Host rules", async () => {
  await expect(bodyLimit(new Request("https://example.test", { method: "POST", body: "12345" }), 4)).rejects.toMatchObject({ status: 413 });
  expect(await bodyLimit(new Request("https://example.test", { method: "POST", body: "1234" }), 4)).toHaveLength(4);
  await expect(bodyLimit(new Request("https://example.test", { method: "POST", body: "x", headers: { "content-length": "999" } }), 4)).rejects.toMatchObject({ status: 413 });
  expect(cookieAttributes(COOKIE_NAMES.session, 300)).toEqual({ secure: true, httpOnly: true, sameSite: "lax", path: "/", maxAge: 300 });
  expect(cookieAttributes(COOKIE_NAMES.csrf, 300).httpOnly).toBe(false);
  expect(serializeCookie(COOKIE_NAMES.oidc, "state", 300)).toBe("__Host-oidc=state; Path=/; Secure; SameSite=Lax; Max-Age=300; HttpOnly");
});
